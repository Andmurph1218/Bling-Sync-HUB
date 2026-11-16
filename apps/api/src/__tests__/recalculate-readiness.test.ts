import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('recalcular prontidão do produto', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';
  let productId = '';
  const erpId = 'REC-1';

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
    mem.public.registerFunction({
      name: 'lower',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.toLowerCase() : ''),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });

    await createUser({
      email: 'operador.recalc@blingsync.local',
      name: 'Operador Recalc',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'operador.recalc@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';

    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, bling_tipo, product_format, ncm_status)
       VALUES ($1, 'REC-SKU', 'Produto Recálculo', 'JHS', 'P', 'S', 'valid')
       RETURNING id`,
      [erpId]
    );
    productId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock, ean, ean_status)
       VALUES ($1, 'REC-SKU', true, 'S', 49.9, 3, 3, '7891234567895', 'valid')`,
      [productId]
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('recalcula sem chamar marketplace e sem enfileirar publicação', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error(`fetch externo inesperado: ${String(input)}`);
    }) as typeof globalThis.fetch;

    try {
      const res = await request(app)
        .post(`/api/catalog/products/${productId}/recalculate-readiness`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(calls).toEqual([]);
      expect(res.body.item.id).toBe(productId);
      expect(typeof res.body.item.checklist.percent).toBe('number');
      expect(res.body.item.integrations.some((row: { platform: string }) => row.platform === 'nuvemshop')).toBe(true);
      expect(res.body.readiness).toHaveLength(1);
      expect(res.body.readiness[0].score_bling).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const queue = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue`);
    expect(queue.rows[0]?.count).toBe(0);
  });

  it('grava a nota em channel_readiness_scores e aceita erp_id no lugar do uuid', async () => {
    const res = await request(app)
      .post(`/api/catalog/products/${erpId}/recalculate-readiness`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    const score = await query<{ score_ns: number }>(
      `SELECT score_ns FROM channel_readiness_scores WHERE master_product_id = $1`,
      [productId]
    );
    expect(score.rows).toHaveLength(1);
    expect(res.body.readiness[0].score_ns).toBe(score.rows[0]!.score_ns);
  });

  it('devolve 404 para produto inexistente', async () => {
    const res = await request(app)
      .post('/api/catalog/products/nao-existe/recalculate-readiness')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('exige sessão', async () => {
    const res = await request(app).post(`/api/catalog/products/${productId}/recalculate-readiness`);
    expect(res.status).toBe(401);
  });
});
