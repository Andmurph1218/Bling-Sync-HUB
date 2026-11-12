import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { NO_SELLER_WAREHOUSE_MESSAGE } from '../catalog/completeness.js';
import { listCatalog } from '../catalog/list.js';
import { checklistForChannel } from '../catalog/publish-preview.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { applyVariantStockBalancesFromBling } from '../orchestrator/pipeline.js';

describe('estoque publicável separado do estoque de exibição', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';
  let productId = '';
  let variantId = '';

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
    await createUser({
      email: 'admin.estoque@blingsync.local',
      name: 'Admin Estoque',
      password: 'SenhaPessoal!2026',
      roles: ['admin'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'admin.estoque@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';

    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push) VALUES
       ('W-VENDA', 'Loja', 'seller', true),
       ('W-FULL', 'Full ML', 'ml_full', false),
       ('W-AVARIA', 'Avaria', 'damaged', false)`
    );
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('erp-split', 'SKU-SPLIT', 'Lâmpada dividida', 'P', 'S')
       RETURNING id`
    );
    productId = created.rows[0]!.id;
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price)
       VALUES ($1, 'SKU-SPLIT', true, 'S', 10)
       RETURNING id`,
      [productId]
    );
    variantId = variant.rows[0]!.id;
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
    setRedis(null);
  });

  it('grava em stock só o depósito de venda e em catalog_stock a soma sem Full e sem avaria', async () => {
    const result = await applyVariantStockBalancesFromBling(variantId, {
      produto: { id: 1 },
      saldoFisicoTotal: 19,
      saldoVirtualTotal: 19,
      depositos: [
        { id: 'W-VENDA', saldoFisico: 5, saldoVirtual: 5 },
        { id: 'W-FULL', saldoFisico: 7, saldoVirtual: 7 },
        { id: 'W-AVARIA', saldoFisico: 3, saldoVirtual: 3 },
        { id: 'W-NOVO', saldoFisico: 4, saldoVirtual: 4 },
      ],
    });
    expect(result).toEqual({ variantStockColumn: 5, publishableFloor: 5 });

    const stored = await query<{ stock: string; catalog_stock: string }>(
      `SELECT stock::text AS stock, catalog_stock::text AS catalog_stock FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(Number(stored.rows[0]?.stock)).toBe(5);
    expect(Number(stored.rows[0]?.catalog_stock)).toBe(9);

    const created = await query<{ role: string; include_in_push: boolean }>(
      `SELECT role, include_in_push FROM stock_warehouses WHERE bling_warehouse_id = 'W-NOVO'`
    );
    expect(created.rows[0]).toEqual({ role: 'unclassified', include_in_push: false });
  });

  it('a coluna Estoque do catálogo mostra catalog_stock e o envio fica com stock', async () => {
    const listed = await listCatalog({ tab: 'todos', sku: 'SKU-SPLIT', name: '', brand: '', page: 1, pageSize: 10 });
    const item = listed.items.find((row) => row.id === productId);
    expect(item?.stock).toBe(9);
    expect(item?.publishableStock).toBe(5);
  });

  it('reclassificar o depósito recalcula os dois saldos sem chamar o ERP', async () => {
    const response = await request(app)
      .put('/admin/controls/warehouses/W-NOVO')
      .set('Cookie', cookie)
      .send({ name: 'Depósito novo', role: 'seller', include_in_push: true });
    expect(response.status).toBe(200);
    expect(response.body.recomputedVariants).toBe(1);

    const stored = await query<{ stock: string; catalog_stock: string }>(
      `SELECT stock::text AS stock, catalog_stock::text AS catalog_stock FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(Number(stored.rows[0]?.stock)).toBe(9);
    expect(Number(stored.rows[0]?.catalog_stock)).toBe(9);

    const asDamaged = await request(app)
      .put('/api/admin/warehouses/W-NOVO')
      .set('Cookie', cookie)
      .send({ name: 'Depósito novo', role: 'damaged', include_in_push: false });
    expect(asDamaged.status).toBe(200);
    const after = await query<{ stock: string; catalog_stock: string }>(
      `SELECT stock::text AS stock, catalog_stock::text AS catalog_stock FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(Number(after.rows[0]?.stock)).toBe(5);
    expect(Number(after.rows[0]?.catalog_stock)).toBe(5);

    const refused = await request(app)
      .put('/admin/controls/warehouses/W-NOVO')
      .set('Cookie', cookie)
      .send({ name: 'Depósito novo', role: 'damaged', include_in_push: true });
    expect(refused.status).toBe(400);
  });

  it('bloqueia o checklist de envio quando o produto não tem saldo em depósito de venda', async () => {
    const ready = await checklistForChannel(productId, 'nuvemshop');
    expect(ready?.items.find((item) => item.code === 'seller_warehouse')?.ok).toBe(true);

    await request(app)
      .put('/api/admin/warehouses/W-VENDA')
      .set('Cookie', cookie)
      .send({ name: 'Loja', role: 'unclassified', include_in_push: false });

    const blocked = await checklistForChannel(productId, 'nuvemshop');
    const item = blocked?.items.find((row) => row.code === 'seller_warehouse');
    expect(blocked?.ready).toBe(false);
    expect(item).toMatchObject({ ok: false, blocks: true, title: NO_SELLER_WAREHOUSE_MESSAGE, fixHref: '/canais/depositos' });
  });

  it('lista os depósitos com o total de saldo de cada um', async () => {
    const response = await request(app).get('/api/warehouses').set('Cookie', cookie);
    expect(response.status).toBe(200);
    const full = response.body.warehouses.find((row: { bling_warehouse_id: string }) => row.bling_warehouse_id === 'W-FULL');
    expect(full).toMatchObject({ role: 'ml_full', variants: 1, saldo_virtual: 7 });
  });
});
