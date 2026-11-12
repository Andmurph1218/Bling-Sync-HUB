import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCatalog } from '../catalog/list.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('canário: vínculo Bling/Nuvemshop com completude baixa', () => {
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
    mem.public.registerFunction({
      name: 'lower',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (value: string) => (value ? value.toLowerCase() : ''),
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
    setRedis(null);
  });

  it('preço de loja da Nuvemshop mostra integrado com pendência, não bloqueado', async () => {
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm_status)
       VALUES ('canary-fuse', '6664316281824188', 'Fusível Nh 1 Retardado 224a 500v 3na3 142', 'P', 'V', 'unknown')
       RETURNING id`
    );
    const productId = product.rows[0]!.id;
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'MLB10175885936', true, 'S', 111, 47, 47)
       RETURNING id`,
      [productId]
    );
    await query(
      `INSERT INTO variant_channel_prices (variant_id, platform, store_price)
       VALUES ($1, 'nuvemshop', 111)`,
      [variant.rows[0]!.id]
    );

    const listed = await listCatalog({
      tab: 'todos',
      sku: '6664316281824188',
      name: '',
      brand: '',
      page: 1,
      pageSize: 10,
    });
    const item = listed.items.find((row) => row.id === productId);
    expect(item?.checklist.percent).toBe(44);
    expect(item?.checklist.ready).toBe(false);
    const nuvemshop = item?.integrations.find((channel) => channel.platform === 'nuvemshop');
    expect(nuvemshop?.visual).toBe('attention');
    expect(nuvemshop?.label).toBe('Vinculado com Pendência');
    expect(nuvemshop?.ready).toBe(false);
  });
});
