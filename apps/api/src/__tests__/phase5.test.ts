import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  enqueueProductImagesForSync,
  finalizeProductImagesIqre,
  hammingDistance64,
  processQueuedImagesWorkerBatch,
} from '../engines/iqre.js';

describe('Fase 5 — Motor de Imagens IQRE (Enfileiramento Assíncrono, Worker SKIP LOCKED, Dedup sem Cruzar Produto, Direitos e Capa)', () => {
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
    const mem = newDb();

    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.trim() : ''),
    });

    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });

    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);

    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. A sync apenas enfileira as imagens em image_processing_queue (sem baixar na hora) e ignora URL normalizada duplicada do mesmo produto', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('5001', 'PROD-IMG-1', 'Garrafa Térmica Inox 1L', 'P', 'S')
       RETURNING id`
    );
    const prodId = prodRes.rows[0]!.id;

    const enqueueRes = await enqueueProductImagesForSync(prodId, [
      {
        source_url: 'http://http2.mlstatic.com/D_NQ_NP_1001.jpg# frag',
        source_platform: 'mercadolivre',
      },
      // Mesma URL após normalização (https + sem fragmento) -> não deve duplicar na fila
      {
        source_url: 'https://http2.mlstatic.com/D_NQ_NP_1001.jpg',
        source_platform: 'mercadolivre',
      },
      {
        source_url: 'https://d2r9epyceweg5n.cloudfront.net/stores/001/products/img2.webp',
        source_platform: 'nuvemshop',
      },
    ]);

    expect(enqueueRes.enqueuedCount).toBe(2);
    expect(enqueueRes.skippedDuplicatesCount).toBe(1);

    // Verifica que product_images ainda está vazio durante a sync (nenhum download síncrono ocorreu)
    const imagesBeforeWorker = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM product_images WHERE master_product_id = $1`,
      [prodId]
    );
    expect(imagesBeforeWorker.rows[0]?.count).toBe(0);

    // Tentativa de finalizar enquanto ainda há itens 'queued' retorna readyToFinalize = false
    const prematureFinalize = await finalizeProductImagesIqre(prodId);
    expect(prematureFinalize.readyToFinalize).toBe(false);
  });

  it('2. O fechamento (iqre.finalize) deduplica imagens com distância de Hamming <= 5 mantendo a maior resolução e NÃO cruza produtos diferentes', async () => {
    const prodARes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('5010', 'PROD-DEDUP-A', 'Mochila Executiva A', 'P', 'S')
       RETURNING id`
    );
    const prodAId = prodARes.rows[0]!.id;

    const prodBRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('5011', 'PROD-DEDUP-B', 'Mochila Executiva B', 'P', 'S')
       RETURNING id`
    );
    const prodBId = prodBRes.rows[0]!.id;

    // Produto A recebe 3 imagens:
    // - img1 (Bling, 600x600, hash 'f0f0f0f0f0f0f0f0')
    // - img2 (Mercado Livre, 1200x1200, hash 'f0f0f0f0f0f0f0f1' -> distância de Hamming = 1 <= 5 da img1!)
    // - img3 (Nuvemshop, 800x800, hash '00ff00ff00ff00ff' -> imagem de outro ângulo, distância > 5)
    await enqueueProductImagesForSync(prodAId, [
      {
        source_url: 'https://org.bling.com.br/imagens/prodA_low.jpg',
        source_platform: 'bling',
      },
      {
        source_url: 'https://http2.mlstatic.com/prodA_high.webp',
        source_platform: 'mercadolivre',
      },
      {
        source_url: 'https://acdn.mitiendanube.com/prodA_angle2.png',
        source_platform: 'nuvemshop',
      },
    ]);

    // Produto B recebe 1 imagem com o MESMO hash ('f0f0f0f0f0f0f0f0'):
    // NUNCA deve ser deduplicada/descartada por causa do Produto A!
    await enqueueProductImagesForSync(prodBId, [
      {
        source_url: 'https://org.bling.com.br/imagens/prodB_same_hash.jpg',
        source_platform: 'bling',
      },
    ]);

    expect(hammingDistance64('f0f0f0f0f0f0f0f0', 'f0f0f0f0f0f0f0f1')).toBe(1);

    // Limpa itens anteriores da fila do teste 1 para processar apenas estes 4
    await query(
      `DELETE FROM image_processing_queue WHERE master_product_id NOT IN ($1, $2)`,
      [prodAId, prodBId]
    );

    const workerRun = await processQueuedImagesWorkerBatch({
      workerId: 'worker-iqre-1',
      batchSize: 10,
      ourSellerIds: { mercadolivre: '88990011', nuvemshop: '441100' },
      fetcher: async (url: string) => {
        if (url.includes('prodA_low')) {
          return {
            buffer: Buffer.from('fake-img-a-low'),
            width: 600,
            height: 600,
            format: 'jpeg',
            averageHash: 'f0f0f0f0f0f0f0f0',
          };
        }
        if (url.includes('prodA_high')) {
          return {
            buffer: Buffer.from('fake-img-a-high'),
            width: 1200,
            height: 1200,
            format: 'webp',
            averageHash: 'f0f0f0f0f0f0f0f1',
            sellerId: '88990011',
          };
        }
        if (url.includes('prodA_angle2')) {
          return {
            buffer: Buffer.from('fake-img-a-angle2'),
            width: 800,
            height: 800,
            format: 'png',
            averageHash: '00ff00ff00ff00ff',
            sellerId: '441100',
          };
        }
        return {
          buffer: Buffer.from('fake-img-b-same-hash'),
          width: 700,
          height: 700,
          format: 'jpeg',
          averageHash: 'f0f0f0f0f0f0f0f0',
        };
      },
    });

    expect(workerRun.claimedCount).toBe(4);
    expect(workerRun.fetchedCount).toBe(4);

    // Finaliza Produto A: deve manter apenas 2 imagens (a de 1200x1200 vence a de 600x600 no cluster de Hamming <= 5)
    const finA = await finalizeProductImagesIqre(prodAId);
    expect(finA.readyToFinalize).toBe(true);
    expect(finA.keptImageIds).toHaveLength(2);
    expect(finA.deduplicatedDroppedImageIds).toHaveLength(1);
    expect(finA.coverImageId).not.toBeNull();

    // Verifica que a imagem mantida do par duplicado no Produto A é a de maior resolução (1200x1200)
    const keptWidthsA = await query<{ width: number; position_ml: number | null }>(
      `SELECT width, position_ml
       FROM product_images
       WHERE master_product_id = $1 AND position_ml IS NOT NULL
       ORDER BY position_ml ASC`,
      [prodAId]
    );
    expect(keptWidthsA.rows).toEqual([
      { width: 1200, position_ml: 1 },
      { width: 800, position_ml: 2 },
    ]);

    // Finaliza Produto B: sua imagem NÃO é descartada (dedup nunca cruza produto!), apenas gera alerta de revisão cross_product_similarity
    const finB = await finalizeProductImagesIqre(prodBId);
    expect(finB.readyToFinalize).toBe(true);
    expect(finB.keptImageIds).toHaveLength(1);
    expect(finB.deduplicatedDroppedImageIds).toHaveLength(0);
    expect(finB.crossProductSimilarityAlerts).toBe(1);
  });

  it('3. Direitos de terceiro (third_party_risk), marca d’água, capa >= 500x500 e falha após 4 tentativas sem bloquear o fechamento do produto', async () => {
    const prodCRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('5020', 'PROD-RIGHTS-C', 'Kit Ferramentas C', 'P', 'S')
       RETURNING id`
    );
    const prodCId = prodCRes.rows[0]!.id;

    await enqueueProductImagesForSync(prodCId, [
      // 1. Imagem de outro seller no ML -> third_party_risk (não publica sem aprovação)
      {
        source_url: 'https://http2.mlstatic.com/third_party_seller.jpg',
        source_platform: 'mercadolivre',
      },
      // 2. Imagem nossa pequena (300x300) -> entra na Nuvemshop (>=200) e Bling (>=100), mas NÃO entra no ML (<500) e NÃO pode ser capa (<500)
      {
        source_url: 'https://org.bling.com.br/imagens/small_300.jpg',
        source_platform: 'bling',
      },
      // 3. URL quebrada que vai falhar nas 4 tentativas -> vira 'failed' e não bloqueia o fechamento das outras
      {
        source_url: 'https://org.bling.com.br/imagens/broken_404.jpg',
        source_platform: 'bling',
      },
    ]);

    // Força a linha quebrada a já estar na 3ª tentativa para que a próxima falha seja a 4ª (terminal 'failed')
    await query(
      `UPDATE image_processing_queue
       SET attempts = 3
       WHERE master_product_id = $1 AND source_url LIKE '%broken_404%'`,
      [prodCId]
    );

    const batchRes = await processQueuedImagesWorkerBatch({
      workerId: 'worker-iqre-2',
      batchSize: 10,
      ourSellerIds: { mercadolivre: '88990011', nuvemshop: '441100' },
      fetcher: async (url: string) => {
        if (url.includes('broken_404')) {
          throw new Error('HTTP 404 Not Found');
        }
        if (url.includes('third_party_seller')) {
          return {
            buffer: Buffer.from('third-party-bytes'),
            width: 1000,
            height: 1000,
            format: 'jpeg',
            averageHash: 'aaaa0000aaaa0000',
            sellerId: '99999999', // Seller diferente do nosso ('88990011')
          };
        }
        return {
          buffer: Buffer.from('small-300-bytes'),
          width: 300,
          height: 300,
          format: 'png',
          averageHash: '1111222233334444',
        };
      },
    });

    expect(batchRes.fetchedCount).toBe(2);
    expect(batchRes.failedTerminalCount).toBe(1);

    // Mesmo com 1 imagem em stage = 'failed', o fechamento do produto roda normalmente!
    const finC = await finalizeProductImagesIqre(prodCId);
    expect(finC.readyToFinalize).toBe(true);
    // Nenhuma imagem é elegível para capa (uma é third_party_risk e a outra é 300x300 < 500x500)
    expect(finC.coverImageId).toBeNull();

    // Verifica que a imagem third_party_risk não recebeu posição em nenhum canal e foi para image_rights_review_queue
    const imgsC = await query<{
      rights_status: string;
      position_bling: number | null;
      position_ml: number | null;
      position_ns: number | null;
    }>(
      `SELECT rights_status, position_bling, position_ml, position_ns
       FROM product_images
       WHERE master_product_id = $1
       ORDER BY rights_status ASC`,
      [prodCId]
    );

    expect(imgsC.rows).toEqual([
      // owned 300x300: publica no Bling (>=100) e Nuvemshop (>=200), mas não no ML (mínimo 500x500)
      {
        rights_status: 'owned',
        position_bling: 1,
        position_ml: null,
        position_ns: 1,
      },
      // third_party_risk: bloqueada de publicação até aprovação humana
      {
        rights_status: 'third_party_risk',
        position_bling: null,
        position_ml: null,
        position_ns: null,
      },
    ]);

    const rightsQueue = await query<{ reason: string; status: string }>(
      `SELECT reason, status FROM image_rights_review_queue WHERE master_product_id = $1`,
      [prodCId]
    );
    expect(rightsQueue.rows).toEqual([{ reason: 'different_seller', status: 'pending' }]);
  });
});
