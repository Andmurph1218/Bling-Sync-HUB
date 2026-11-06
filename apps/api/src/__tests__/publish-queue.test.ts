import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { ListingDraft } from '../connectors/strategy/types.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { DRY_RUN_LOG, processPublishQueueItem } from '../queues/publish-queue.js';

describe('P2 — fila de publicação', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';

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
      email: 'admin.p2@blingsync.local',
      name: 'Admin P2',
      password: 'SenhaPessoal!2026',
      roles: ['admin'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'admin.p2@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('enfileira 3 jobs e o worker simula sem chamar o marketplace', async () => {
    const products = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await query<{ id: string }>(
        `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
         VALUES ($1, $2, $3, 'P', 'S')
         RETURNING id`,
        [`pub-${index}`, `PUB-${index}`, `Produto ${index}`]
      );
      products.push(created.rows[0]!.id);
    }

    const previous = process.env.ENABLE_LIVE_PUBLISHING;
    process.env.ENABLE_LIVE_PUBLISHING = 'false';
    const response = await request(app)
      .post('/api/admin/publish-queue')
      .set('Cookie', cookie)
      .send({
        jobs: products.map((productId, index) => ({
          productId,
          channel: index === 1 ? 'nuvemshop' : 'mercadolivre',
          payload: { sku: `PUB-${index}`, price: 10 + index, stock: index, attributes: [] },
        })),
      });
    process.env.ENABLE_LIVE_PUBLISHING = previous;

    expect(response.status).toBe(202);
    expect(response.body.livePublishing).toBe(false);
    expect(response.body.jobs).toHaveLength(3);
    expect(response.body.jobs.every((job: { status: string; error_message: string }) => job.status === 'success' && job.error_message === DRY_RUN_LOG)).toBe(true);

    const stored = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue ORDER BY created_at`
    );
    expect(stored.rows).toHaveLength(3);
    expect(stored.rows.every((row) => row.status === 'success' && row.error_message === 'simulado com sucesso')).toBe(true);
  });

  it('com a flag ligada chama a publicação e, desligada, não chama', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('pub-flag', 'PUB-FLAG', 'Flag', 'P', 'S')
       RETURNING id`
    );
    const productId = created.rows[0]!.id;
    const draft: ListingDraft = { sku: 'PUB-FLAG', price: 12, stock: 1, attributes: [] };
    const inserted = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, payload_json)
       VALUES ($1, 'mercadolivre', $2)
       RETURNING id`,
      [productId, JSON.stringify(draft)]
    );
    const id = inserted.rows[0]!.id;
    const calls: string[] = [];

    await processPublishQueueItem(id, {
      live: false,
      publish: async (channel) => {
        calls.push(channel);
      },
    });
    expect(calls).toEqual([]);
    const dry = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [id]
    );
    expect(dry.rows[0]).toMatchObject({ status: 'success', error_message: 'simulado com sucesso' });

    await query(`UPDATE publish_queue SET status = 'pending', error_message = NULL WHERE id = $1`, [id]);
    await processPublishQueueItem(id, {
      live: true,
      publish: async (channel) => {
        calls.push(channel);
      },
    });
    expect(calls).toEqual(['mercadolivre']);
  });

  it('simula o JSON do Mercado Livre sem gravar publicação', async () => {
    const category = await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Simulação') RETURNING id`);
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, brand, bling_tipo, bling_formato, hub_category_id)
       VALUES ('sim-1', 'SIM-1', 'Lâmpada LED', 'JHS', 'P', 'S', $1)
       RETURNING id`,
      [categoryId]
    );
    const productId = product.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, stock)
       VALUES ($1, 'SIM-1', true, 'S', 19.9, 3)`,
      [productId]
    );
    await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/mercadolivre`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: 'MLB999001',
        channelCategoryName: 'Lâmpadas',
        attributes: [
          { channelAttributeId: 'BRAND', channelAttributeName: 'Marca', required: true, mode: 'dynamic', sourceField: 'brand' },
          { channelAttributeId: 'COLOR', channelAttributeName: 'Cor', required: true, mode: 'fixed', fixedValue: 'Branco' },
        ],
      });

    const before = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue`);
    const response = await request(app)
      .post(`/api/catalog/products/${productId}/simulate-publish?channel=mercadolivre`)
      .set('Cookie', cookie);
    const after = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue`);

    expect(response.status).toBe(200);
    expect(response.body.published).toBe(false);
    expect(response.body.performed).toBe(false);
    expect(response.body.payload).toMatchObject({
      title: 'Lâmpada LED',
      category_id: 'MLB999001',
      price: 19.9,
      currency_id: 'BRL',
      available_quantity: 3,
      seller_custom_field: 'SIM-1',
      attributes: [
        { id: 'BRAND', value_name: 'JHS' },
        { id: 'COLOR', value_name: 'Branco' },
      ],
    });
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
