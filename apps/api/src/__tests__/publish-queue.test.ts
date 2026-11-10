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
import { CHECKLIST_BLOCKED_MESSAGE, DRY_RUN_LOG, processPublishQueueItem } from '../queues/publish-queue.js';

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
        `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
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
    expect(response.body.queued).toEqual([]);
    expect(response.body.jobs).toEqual([]);
    expect(response.body.skipped).toHaveLength(3);
    expect(response.body.skipped.every((item: { reason: string }) => item.reason.includes('NCM'))).toBe(true);

    const stored = await query<{ status: string }>(`SELECT status FROM publish_queue`);
    expect(stored.rows).toHaveLength(0);

    const blockedChannel = await request(app)
      .post('/api/admin/publish-queue')
      .set('Cookie', cookie)
      .send({
        jobs: [{ productId: products[0], channel: 'shopee', payload: { sku: 'PUB-0', price: 10, stock: 1, attributes: [] } }],
      });
    expect(blockedChannel.status).toBe(202);
    expect(blockedChannel.body.queued).toEqual([]);
    expect(blockedChannel.body.skipped[0].reason).toBe(CHECKLIST_BLOCKED_MESSAGE);
    const stillEmpty = await query<{ status: string }>(`SELECT status FROM publish_queue`);
    expect(stillEmpty.rows).toHaveLength(0);
  });

  it('falha a simulação quando o canal não tem checklist', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('pub-shopee', 'PUB-SHOPEE', 'Sem mapa', 'P', 'S')
       RETURNING id`
    );
    const inserted = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, payload_json)
       VALUES ($1, 'shopee', $2)
       RETURNING id`,
      [created.rows[0]!.id, JSON.stringify({ sku: 'PUB-SHOPEE', price: 10, stock: 1, attributes: [] })]
    );
    const calls: string[] = [];
    await processPublishQueueItem(inserted.rows[0]!.id, {
      live: false,
      publish: async (channel) => {
        calls.push(channel);
      },
    });
    expect(calls).toEqual([]);
    const stored = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [inserted.rows[0]!.id]
    );
    expect(stored.rows[0]).toEqual({ status: 'failed', error_message: CHECKLIST_BLOCKED_MESSAGE });
  });

  it('com a flag ligada chama a publicação e, desligada, não chama', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
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
    expect(dry.rows[0]?.status).toBe('failed');
    expect(dry.rows[0]?.error_message).toContain('NCM');

    await query(`UPDATE publish_queue SET status = 'pending', error_message = NULL WHERE id = $1`, [id]);
    await processPublishQueueItem(id, {
      live: true,
      publish: async (channel) => {
        calls.push(channel);
      },
    });
    expect(calls).toEqual([]);
    const blocked = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [id]
    );
    expect(blocked.rows[0]?.status).toBe('failed');
    expect(blocked.rows[0]?.error_message).toContain('NCM');
  });

  it('simula o JSON do Mercado Livre sem gravar publicação', async () => {
    const category = await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Simulação') RETURNING id`);
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, bling_tipo, product_format, hub_category_id)
       VALUES ('sim-1', 'SIM-1', 'Lâmpada LED', 'JHS', 'P', 'S', $1)
       RETURNING id`,
      [categoryId]
    );
    const productId = product.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock)
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
      .post(`/api/catalog/${productId}/simulate`)
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

    const blocked = await request(app)
      .post('/api/catalog/products/send-list')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(blocked.status).toBe(202);
    expect(blocked.body.queued).toEqual([]);
    expect(blocked.body.published).toBe(false);
    expect(blocked.body.skipped[0].reason).toContain('NCM');

    const batch = await request(app)
      .post('/api/catalog/publish/batch')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(batch.status).toBe(202);
    expect(batch.body.published).toBe(false);
    expect(batch.body.queued).toEqual([]);
    expect(batch.body.skipped[0].reason).toContain('NCM');
  });

  it('simula com sucesso só quando o checklist do canal está verde', async () => {
    const category = await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Verde') RETURNING id`);
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, bling_tipo, product_format)
       VALUES ('verde-1', 'VERDE-1', 'Produto verde', 'JHS', 'P', 'S')
       RETURNING id`
    );
    const productId = product.rows[0]!.id;
    await query(
      `UPDATE master_products
       SET hub_category_id = $2, ncm_status = 'valid', ncm_fiscal_risk = false
       WHERE id = $1`,
      [productId, categoryId]
    );
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock)
       VALUES ($1, 'VERDE-1', true, 'S', 10, 2)`,
      [productId]
    );
    await query(
      `INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible)
       VALUES ($1, 'https://example.com/verde.jpg', 'https://example.com/verde.jpg', 'bling', true)`,
      [productId]
    );
    await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/mercadolivre`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: 'MLB999001',
        channelCategoryName: 'Lâmpadas',
        attributes: [
          { channelAttributeId: 'BRAND', channelAttributeName: 'Marca', required: true, mode: 'fixed', fixedValue: 'JHS' },
        ],
      });

    const sent = await request(app)
      .post('/api/catalog/products/send-list')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(sent.status).toBe(202);
    expect(sent.body.queued).toHaveLength(1);
    expect(sent.body.skipped).toEqual([]);
    const stored = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [sent.body.queued[0]]
    );
    expect(stored.rows[0]).toMatchObject({ status: 'success', error_message: DRY_RUN_LOG });
  });

  it('agrega falha de envio, webhook e pendência de completude', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('prob-1', 'PROB-1', 'Produto com falha', 'P', 'S')
       RETURNING id`
    );
    await query(
      `INSERT INTO publish_queue (product_id, channel, status, payload_json, error_message)
       VALUES ($1, 'mercadolivre', 'failed', '{}', 'picture_too_small')`,
      [created.rows[0]!.id]
    );
    await query(
      `INSERT INTO webhook_events (source, event_type, resource_id, content_hash, idempotency_key, status, error_detail)
       VALUES ('bling', 'stock.updated', 'prob-1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'prob-stock-1', 'failed', 'saldo rejeitado')`
    );

    const response = await request(app).get('/api/problems').set('Cookie', cookie);
    expect(response.status).toBe(200);
    const anuncio = response.body.groups.find((group: { type: string }) => group.type === 'anuncio');
    expect(anuncio.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'PROB-1',
          channel: 'Mercado Livre',
          message: 'Rejeitado pelo Mercado Livre: imagem pequena.',
          source: 'publish_queue',
        }),
      ])
    );
    const estoque = response.body.groups.find((group: { type: string }) => group.type === 'estoque');
    expect(estoque.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'PROB-1', channel: 'ERP', message: 'saldo rejeitado', source: 'webhook_events' }),
      ])
    );
    expect(response.body.pendencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'hub_category', href: '/catalogo?status=completude&pendencia=hub_category' })])
    );
  });
});
