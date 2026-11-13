import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { readBlingEnrichment } from '../connectors/bling/bling-erp.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { processEnrichmentBatch } from '../queues/enrichment-worker.js';

describe('enriquecimento do catálogo', () => {
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
      implementation: (value: string) => (value ? value.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('lê imagem, NCM e categoria do produto do Bling', () => {
    const data = readBlingEnrichment({
      tributacao: { ncm: '9405.10.99' },
      categoria: { descricao: 'Luminárias' },
      midia: { imagens: { internas: [{ link: 'https://orgbling.s3.amazonaws.com/capa.jpg' }] } },
      imagemURL: 'https://orgbling.s3.amazonaws.com/capa.jpg',
    });
    expect(data.ncm).toBe('94051099');
    expect(data.category).toBe('Luminárias');
    expect(data.images).toEqual(['https://orgbling.s3.amazonaws.com/capa.jpg']);
  });

  it('grava capa e NCM no HUB e recalcula a completude sem escrever no ERP', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm, ncm_status)
       VALUES ('erp-enrich', 'ENR-1', 'Sem foto', 'P', 'S', NULL, 'unknown')
       RETURNING id`
    );
    const productId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price)
       VALUES ($1, 'ENR-1', true, 10)`,
      [productId]
    );
    let writes = 0;
    const erp = {
      fetchProductEnrichmentData: async () => ({
        images: ['https://orgbling.s3.amazonaws.com/capa.jpg', 'https://orgbling.s3.amazonaws.com/galeria.jpg'],
        ncm: '94051099',
        category: 'Luminárias',
      }),
      createProduct: async () => {
        writes += 1;
        return { erp_id: '0', stockWarning: null };
      },
    } as unknown as ErpConnector;

    const report = await processEnrichmentBatch(erp, '');
    expect(report.enriched).toBe(1);
    expect(writes).toBe(0);

    const image = await query<{
      master_product_id: string;
      is_cover_eligible: boolean;
      rights_status: string;
      url_normalized: string;
      position_bling: number;
    }>(
      `SELECT master_product_id::text AS master_product_id, is_cover_eligible, rights_status, url_normalized, position_bling
       FROM product_images
       WHERE rights_status = 'pending'`
    );
    // O índice por produto do pg-mem não enxerga a linha depois de recriar o check de rights_status.
    const mine = image.rows
      .filter((row) => row.master_product_id === productId)
      .sort((a, b) => a.position_bling - b.position_bling);
    expect(mine[0]).toEqual({
      master_product_id: productId,
      is_cover_eligible: false,
      rights_status: 'pending',
      url_normalized: 'https://orgbling.s3.amazonaws.com/capa.jpg',
      position_bling: 1,
    });
    expect(mine.every((row) => row.rights_status === 'pending' && row.is_cover_eligible === false)).toBe(true);
    const queued = await query<{ master_product_id: string; stage: string }>(
      `SELECT master_product_id::text AS master_product_id, stage FROM image_processing_queue WHERE stage = 'queued'`
    );
    expect(queued.rows.filter((row) => row.master_product_id === productId)).toHaveLength(2);

    const product = await query<{ ncm: string; ncm_status: string; ncm_fiscal_risk: boolean; category: string; worst_score: number | null }>(
      `SELECT ncm, ncm_status, ncm_fiscal_risk, category, worst_score FROM master_products WHERE id = $1`,
      [productId]
    );
    expect(product.rows[0]?.ncm).toBe('94051099');
    expect(product.rows[0]?.ncm_status).toBe('pending_approval');
    expect(product.rows[0]?.ncm_fiscal_risk).toBe(true);
    expect(product.rows[0]?.category).toBe('Luminárias');
    expect(product.rows[0]?.worst_score).not.toBeNull();
    const suggestion = await query<{ status: string; source_platform: string; proposed_ncm: string }>(
      `SELECT status, source_platform, proposed_ncm FROM ncm_manual_suggestions WHERE master_product_id = $1`,
      [productId]
    );
    expect(suggestion.rows[0]).toEqual({
      status: 'pending_first',
      source_platform: 'bling',
      proposed_ncm: '9405.10.99',
    });
  });

  it('recupera de 429 transitório e isola falha individual sem derrubar o lote inteiro', async () => {
    await query(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm, ncm_status)
       VALUES ('erp-z-429', 'Z-429', 'Produto com 429', 'P', 'S', NULL, 'unknown'),
              ('erp-z-err', 'Z-ERR', 'Produto com erro isolado', 'P', 'S', NULL, 'unknown'),
              ('erp-z-ok',  'Z-OK',  'Produto seguinte ok', 'P', 'S', NULL, 'unknown')`
    );

    let attempts429 = 0;
    const erp = {
      fetchProductEnrichmentData: async (erpId: string) => {
        if (erpId === 'erp-z-429') {
          attempts429 += 1;
          if (attempts429 === 1) {
            throw new Error('bling /produtos/erp-z-429 -> 429 TOO_MANY_REQUESTS');
          }
          return { images: [], ncm: '85365090', category: 'Elétrica' };
        }
        if (erpId === 'erp-z-err') {
          throw new Error('falha isolada de cadastro');
        }
        return { images: [], ncm: '85369090', category: 'Elétrica' };
      },
    } as unknown as ErpConnector;

    const report = await processEnrichmentBatch(erp, 'erp-z-');
    expect(attempts429).toBe(2);
    expect(report.processed).toBe(3);
    expect(report.enriched).toBe(2);
  });
});
