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

    const image = await query<{ is_cover_eligible: boolean; url_normalized: string }>(
      `SELECT is_cover_eligible, url_normalized FROM product_images WHERE master_product_id = $1`,
      [productId]
    );
    expect(image.rows[0]).toEqual({
      is_cover_eligible: true,
      url_normalized: 'https://orgbling.s3.amazonaws.com/capa.jpg',
    });

    const product = await query<{ ncm: string; ncm_status: string; category: string; worst_score: number | null }>(
      `SELECT ncm, ncm_status, category, worst_score FROM master_products WHERE id = $1`,
      [productId]
    );
    expect(product.rows[0]?.ncm).toBe('94051099');
    expect(product.rows[0]?.ncm_status).toBe('valid');
    expect(product.rows[0]?.category).toBe('Luminárias');
    expect(product.rows[0]?.worst_score).not.toBeNull();
  });
});
