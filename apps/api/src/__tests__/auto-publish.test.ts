import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { recalculateCompleteness } from '../catalog/publish-preview.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';

describe('publicação automática ao completar o canal', () => {
  let poolInstance: DbPoolLike;
  let productId = '';

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
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });

    const category = await query<{ id: string }>(
      `INSERT INTO hub_categories (name) VALUES ('Lâmpadas') RETURNING id`
    );
    const categoryId = category.rows[0]!.id;
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (
         erp_id, erp_sku, name, bling_tipo, product_format, hub_category_id, ncm_status, ncm_fiscal_risk
       ) VALUES ('auto-1', 'AUTO-1', 'Lâmpada pronta', 'P', 'S', $1, 'valid', false)
       RETURNING id`,
      [categoryId]
    );
    productId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock, ean_status)
       VALUES ($1, 'AUTO-1', true, 0, 4, 'valid')`,
      [productId]
    );
    await query(
      `INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible)
       VALUES ($1, 'https://img.local/auto.jpg', 'https://img.local/auto.jpg', 'bling', true)`,
      [productId]
    );
    const map = await query<{ id: string }>(
      `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
       VALUES ($1, 'nuvemshop', 'ns-cat-lamps', 'Lâmpadas')
       RETURNING id`,
      [categoryId]
    );
    await query(
      `INSERT INTO channel_attribute_maps (
         channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value
       ) VALUES ($1, 'brand', 'Marca', false, 'fixed', 'JH')`,
      [map.rows[0]!.id]
    );
  });

  afterEach(() => {
    delete process.env.AUTO_PUBLISH_ENABLED;
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('não enfileira enquanto falta a última pendência, mesmo com a flag ligada', async () => {
    process.env.AUTO_PUBLISH_ENABLED = 'true';
    const scored = await recalculateCompleteness([productId]);
    expect(scored[0]?.percent).toBeLessThan(100);
    const jobs = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue WHERE product_id = $1`, [productId]);
    expect(jobs.rows[0]?.count).toBe(0);
  });

  it('cria um job pending ao corrigir o preço e não duplica no recálculo seguinte', async () => {
    await query(`UPDATE product_variants SET price = 19.9 WHERE master_product_id = $1`, [productId]);

    delete process.env.AUTO_PUBLISH_ENABLED;
    await recalculateCompleteness([productId]);
    const blocked = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM publish_queue WHERE product_id = $1`,
      [productId]
    );
    expect(blocked.rows[0]?.count).toBe(0);

    process.env.AUTO_PUBLISH_ENABLED = 'true';
    const scored = await recalculateCompleteness([productId]);
    expect(scored[0]).toMatchObject({ percent: 100, ready: true });
    await recalculateCompleteness([productId]);

    const jobs = await query<{ status: string; channel: string; sku: string }>(
      `SELECT status, channel, payload_json->>'sku' AS sku FROM publish_queue WHERE product_id = $1`,
      [productId]
    );
    expect(jobs.rows).toEqual([{ status: 'pending', channel: 'nuvemshop', sku: 'AUTO-1' }]);
  });
});
