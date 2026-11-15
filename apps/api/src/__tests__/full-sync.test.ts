import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFullCatalogSync } from '../catalog/full-sync.js';
import { BlingProductPayload } from '../connectors/bling/fixtures.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { runFullProductCatalogPipeline } from '../orchestrator/pipeline.js';

function product(id: number, tipo: 'P' | 'S', extra: Record<string, unknown> = {}): BlingProductPayload {
  return {
    id,
    nome: `Produto ${id}`,
    codigo: `SKU-${id}`,
    preco: 10,
    tipo,
    situacao: 'A',
    formato: 'S',
    ...extra,
  } as BlingProductPayload;
}

describe('sync completo do ERP', () => {
  it('pagina em lote, ignora serviço e variação filha, e grava só o produto pai', async () => {
    const pages = [
      ['1', '2'],
      ['3'],
    ];
    const catalog = new Map<string, unknown>([
      ['1', product(1, 'S')],
      ['2', product(2, 'P', { variacao: { produtoPai: { id: 9 } } })],
      ['3', product(3, 'P')],
    ]);
    const listedPages: number[] = [];
    const upserted: string[] = [];
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => {
        listedPages.push(page);
        const externalIds = pages[page - 1] ?? [];
        return { page, pageSize, externalIds, done: externalIds.length < pageSize };
      },
      pullCatalogProduct: async (externalId: string) => catalog.get(externalId) ?? null,
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;

    const report = await runFullCatalogSync(erp, {
      pageSize: 2,
      upsertProduct: async (payload) => {
        upserted.push(payload.codigo);
        return { masterProductId: `id-${payload.id}`, variantIdsBySku: { [payload.codigo]: 'variant' } };
      },
      scoreProduct: async () => false,
    });

    expect(listedPages).toEqual([1, 2]);
    expect(upserted).toEqual(['SKU-3']);
    expect(report).toMatchObject({
      status: 'done',
      seen: 3,
      upserted: 1,
      variants: 1,
      skippedService: 1,
      skippedChild: 1,
      incomplete: 1,
      ready: 0,
      failed: 0,
    });
  });

  it('busca as variações de uma grade e não relê produto que já está no banco', async () => {
    const pulled: string[] = [];
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => ({
        page,
        pageSize,
        externalIds: page === 1 ? ['10', '11'] : [],
        done: page > 1,
      }),
      pullCatalogProduct: async (externalId: string) => {
        pulled.push(externalId);
        if (externalId === '11') return product(11, 'P', { formato: 'V', variacoes: [] });
        return product(12, 'P', { codigo: 'SKU-12', nome: 'Cor:Azul', variacao: { nome: 'Cor:Azul', ordem: 1 } });
      },
      listChildIds: async () => ['12'],
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;
    const saved: Array<{ codigo: string; variacoes: number }> = [];

    const report = await runFullCatalogSync(erp, {
      pageSize: 2,
      skipExisting: true,
      alreadyImported: async (externalId) => externalId === '10',
      upsertProduct: async (payload) => {
        saved.push({ codigo: payload.codigo, variacoes: payload.variacoes?.length ?? 0 });
        return { masterProductId: 'm', variantIdsBySku: { [payload.codigo]: 'v' } };
      },
      scoreProduct: async () => false,
    });

    expect(pulled).toEqual(['11', '12']);
    expect(saved).toEqual([{ codigo: 'SKU-11', variacoes: 1 }]);
    expect(report.skippedExisting).toBe(1);
    expect(report.upserted).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('ignora falso filho que pertence a outro pai (ou produto independente sem vínculo) e rebaixa pai órfão para formato S', async () => {
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => ({
        page,
        pageSize,
        externalIds: page === 1 ? ['50'] : [],
        done: true,
      }),
      pullCatalogProduct: async (externalId: string) => {
        if (externalId === '50') return product(50, 'P', { formato: 'V', variacoes: [] });
        return product(99, 'P', { codigo: 'SKU-OUTRO', variacao: { produtoPai: { id: 777 } } });
      },
      listChildIds: async () => ['99'],
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;

    const saved: Array<{ codigo: string; formato: string; variacoes: number }> = [];
    const report = await runFullCatalogSync(erp, {
      pageSize: 2,
      upsertProduct: async (payload) => {
        saved.push({ codigo: payload.codigo, formato: payload.formato, variacoes: payload.variacoes?.length ?? 0 });
        return { masterProductId: 'm50', variantIdsBySku: { [payload.codigo]: 'v50' } };
      },
      scoreProduct: async () => false,
    });

    expect(saved).toEqual([{ codigo: 'SKU-50', formato: 'S', variacoes: 0 }]);
    expect(report.failed).toBe(0);
  });
});

describe('sync completo com mídia do ERP', () => {
  let poolInstance: DbPoolLike;
  const imageUrl = 'https://orgbling.s3.amazonaws.com/capa-sync.jpg';

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

  it('enfileira a imagem do produto com source_platform erp e incrementa upserted', async () => {
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => ({
        page,
        pageSize,
        externalIds: page === 1 ? ['901'] : [],
        done: true,
      }),
      pullCatalogProduct: async () =>
        product(901, 'P', { midia: { imagens: { internas: [{ link: imageUrl }] } } }),
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;

    const report = await runFullCatalogSync(erp, { pageSize: 20 });

    expect(report.errors).toEqual([]);
    expect(report.failed).toBe(0);
    expect(report.upserted).toBe(1);

    const queue = await query<{ source_platform: string; source_url: string; stage: string }>(
      `SELECT source_platform, source_url, stage FROM image_processing_queue WHERE source_url = $1`,
      [imageUrl]
    );
    expect(queue.rows).toEqual([{ source_platform: 'erp', source_url: imageUrl, stage: 'queued' }]);
  });

  it('conta a imagem enfileirada pelo pipeline do ERP', async () => {
    const pipeline = await runFullProductCatalogPipeline({
      inboundPayload: product(902, 'P', {
        midia: { imagens: { internas: [{ link: 'https://orgbling.s3.amazonaws.com/capa-sync-2.jpg' }] } },
      }),
      stockBalancesBySku: {},
      imagesToEnqueue: [
        { source_url: 'https://orgbling.s3.amazonaws.com/capa-sync-2.jpg', source_platform: 'erp' },
      ],
    });
    expect(pipeline.enqueuedImagesCount).toBe(1);
  });

  it('reverte a constraint sem quebrar com imagem erp já enfileirada', async () => {
    const { DOWN_SQL } = await import('../db/migrations/1729080000034_image-queue-erp-source.js');
    await query(DOWN_SQL);

    const restored = await query<{ source_platform: string; master_product_id: string }>(
      `SELECT source_platform, master_product_id FROM image_processing_queue WHERE source_url = $1`,
      [imageUrl]
    );
    expect(restored.rows[0]?.source_platform).toBe('bling');

    await expect(
      query(
        `INSERT INTO image_processing_queue (master_product_id, source_url, url_normalized, source_platform)
         VALUES ($1, $2, $3, 'erp')`,
        [restored.rows[0]!.master_product_id, 'u-down', 'u-down']
      )
    ).rejects.toThrow(/check constraint/);
  });
});
