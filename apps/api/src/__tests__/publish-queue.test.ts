import crypto from 'node:crypto';
import request from 'supertest';
import { UnrecoverableError } from 'bullmq';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { EXISTING_LISTING_MESSAGE, NO_SELLER_WAREHOUSE_MESSAGE } from '../catalog/completeness.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import { resetNuvemshopRateLimitForTests, setNuvemshopFetchForTests } from '../connectors/nuvemshop/nuvemshop-http.js';
import { NuvemshopPublishError } from '../connectors/nuvemshop/nuvemshop-publish.js';
import { ListingDraft } from '../connectors/strategy/types.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { CHECKLIST_BLOCKED_MESSAGE, DRY_RUN_LOG, processPublishQueueItem, PublishPausedError, setPublishingPaused } from '../queues/publish-queue.js';

async function importedCategory(productId: string, categoryId: string, channel: string, externalId: string): Promise<void> {
  await query(`UPDATE master_products SET erp_category_id = $2 WHERE id = $1`, [productId, categoryId]);
  await query(`INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id) VALUES ('bling', $1, $2, $3)`, [categoryId, channel, externalId]);
}

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

    await importedCategory(productId, categoryId, 'mercadolivre', 'MLB999001');
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
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'VERDE-1', true, 'S', 10, 2, 9)
       RETURNING id`,
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

    await importedCategory(productId, categoryId, 'mercadolivre', 'MLB999001');
    const withoutSeller = await request(app)
      .post('/api/catalog/products/send-list')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(withoutSeller.status).toBe(202);
    expect(withoutSeller.body.queued).toEqual([]);
    expect(withoutSeller.body.skipped[0].reason).toBe(NO_SELLER_WAREHOUSE_MESSAGE);

    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-VERDE', 'Loja', 'seller', true)`
    );
    await query(
      `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
       VALUES ($1, 'DEP-VERDE', 2, 2)`,
      [variant.rows[0]!.id]
    );

    const sent = await request(app)
      .post('/api/catalog/products/send-list')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(sent.status).toBe(202);
    expect(sent.body.queued).toHaveLength(1);
    expect(sent.body.skipped).toEqual([]);
    const stored = await query<{ status: string; error_message: string; payload_json: string }>(
      `SELECT status, error_message, payload_json FROM publish_queue WHERE id = $1`,
      [sent.body.queued[0]]
    );
    expect(stored.rows[0]).toMatchObject({ status: 'success', error_message: DRY_RUN_LOG });
    const payload = typeof stored.rows[0]!.payload_json === 'string'
      ? JSON.parse(stored.rows[0]!.payload_json)
      : stored.rows[0]!.payload_json;
    expect(payload.stock).toBe(2);

    await query(
      `INSERT INTO channel_listing_links (product_id, channel, listing_id, link_status)
       VALUES ($1, 'mercadolivre', 'MLB1578151393', 'vinculado')`,
      [productId]
    );
    const duplicate = await request(app)
      .post('/api/catalog/products/send-list')
      .set('Cookie', cookie)
      .send({ ids: [productId], channel: 'mercadolivre' });
    expect(duplicate.status).toBe(202);
    expect(duplicate.body.queued).toEqual([]);
    expect(duplicate.body.skipped[0].reason).toBe(EXISTING_LISTING_MESSAGE);

    const forced = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, payload_json)
       VALUES ($1, 'mercadolivre', $2)
       RETURNING id`,
      [productId, JSON.stringify({ sku: 'VERDE-1', price: 10, stock: 2, attributes: [] })]
    );
    const creates: string[] = [];
    await processPublishQueueItem(forced.rows[0]!.id, {
      live: true,
      publish: async (channel) => {
        creates.push(channel);
      },
    });
    expect(creates).toEqual([]);
    const blockedCreate = await query<{ status: string; error_message: string }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [forced.rows[0]!.id]
    );
    expect(blockedCreate.rows[0]).toEqual({ status: 'failed', error_message: EXISTING_LISTING_MESSAGE });
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

  it('o admin pausa e libera a fila de publicação', async () => {
    const paused = await request(app)
      .put('/api/admin/publish-pause')
      .set('Cookie', cookie)
      .send({ paused: true });
    expect(paused.status).toBe(200);
    expect(paused.body.paused).toBe(true);
    const read = await request(app).get('/api/admin/publish-pause').set('Cookie', cookie);
    expect(read.status).toBe(200);
    expect(read.body.paused).toBe(true);
    const resumed = await request(app)
      .put('/api/admin/publish-pause')
      .set('Cookie', cookie)
      .send({ paused: false });
    expect(resumed.status).toBe(200);
    expect(resumed.body.paused).toBe(false);
  });

  it('cria o anúncio na Nuvemshop uma vez, com o preço atual, e não repete o POST', async () => {
    const category = await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Nuvemshop') RETURNING id`);
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, bling_tipo, product_format)
       VALUES ('ns-novo', 'NS-NOVO', 'Produto Nuvemshop', 'JHS', 'P', 'S')
       RETURNING id`
    );
    const productId = product.rows[0]!.id;
    await query(
      `UPDATE master_products
       SET hub_category_id = $2, ncm_status = 'valid', ncm_fiscal_risk = false
       WHERE id = $1`,
      [productId, categoryId]
    );
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-NOVO', true, 'S', 10, 2, 2)
       RETURNING id`,
      [productId]
    );
    await query(
      `INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible)
       VALUES ($1, 'https://example.com/ns.jpg', 'https://example.com/ns.jpg', 'bling', true)`,
      [productId]
    );
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-NS', 'Loja Nuvemshop', 'seller', true)`
    );
    await query(
      `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
       VALUES ($1, 'DEP-NS', 2, 2)`,
      [variant.rows[0]!.id]
    );
    await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/nuvemshop`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: '123456',
        channelCategoryName: 'Casa',
        attributes: [
          { channelAttributeId: 'BRAND', channelAttributeName: 'Marca', required: true, mode: 'fixed', fixedValue: 'JHS' },
        ],
      });
    await importedCategory(productId, categoryId, 'nuvemshop', '123456');
    await query(
      `UPDATE product_variants SET price = 49.9, stock = 7 WHERE id = $1`,
      [variant.rows[0]!.id]
    );

    const previousStore = process.env.NUVEMSHOP_STORE_ID;
    const previousAllow = process.env.LIVE_PUBLISH_ALLOWLIST;
    process.env.NUVEMSHOP_STORE_ID = '998877';
    delete process.env.LIVE_PUBLISH_ALLOWLIST;
    resetNuvemshopRateLimitForTests();
    await new OAuthTokenManager().upsertToken({
      provider: 'nuvemshop',
      accessToken: 'token-de-teste',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const posts: string[] = [];
    const imagePosts: Array<{ src: string; position: number }> = [];
    let mode: 'retry' | 'reject' | 'create' | 'exists' = 'retry';
    setNuvemshopFetchForTests(async (url, init) => {
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
      });
      if (init?.method === 'POST' && url.includes('/images')) {
        imagePosts.push(JSON.parse(String(init.body)) as { src: string; position: number });
        return json(201, { id: imagePosts.length });
      }
      if (init?.method === 'POST') {
        posts.push(String(init.body ?? ''));
        if (mode === 'retry') return json(503, { message: 'indisponível' });
        if (mode === 'reject') return json(400, { description: 'nome inválido' });
        return json(201, { id: 88421 });
      }
      if (url.includes('/images')) {
        return json(200, imagePosts.map((image) => ({ src: image.src })));
      }
      if (url.includes('/products/sku/')) {
        if (mode === 'exists') return json(200, { product_id: 88421, sku: 'NS-NOVO', price: '49.90', stock: 7 });
        return json(404, {});
      }
      return json(200, []);
    });

    const enqueue = async () => {
      // A fila só permite um job aberto por produto e canal: fecha o anterior
      // antes de simular uma nova tentativa manual.
      await query(
        `UPDATE publish_queue
         SET status = 'failed'
         WHERE product_id = $1 AND channel = 'nuvemshop' AND status IN ('pending', 'processing')`,
        [productId]
      );
      const inserted = await query<{ id: string }>(
        `INSERT INTO publish_queue (product_id, channel, payload_json)
         VALUES ($1, 'nuvemshop', $2)
         RETURNING id`,
        [productId, JSON.stringify({ sku: 'NS-NOVO', title: 'Preço velho', price: 1, stock: 1, attributes: [] })]
      );
      return inserted.rows[0]!.id;
    };

    try {
      await setPublishingPaused(true);
      const heldId = await enqueue();
      await expect(processPublishQueueItem(heldId, { live: true })).rejects.toBeInstanceOf(PublishPausedError);
      const held = await query<{ status: string }>(`SELECT status FROM publish_queue WHERE id = $1`, [heldId]);
      expect(held.rows[0]?.status).toBe('pending');
      expect(posts).toHaveLength(0);
      await setPublishingPaused(false);

      const simulatedId = await enqueue();
      await processPublishQueueItem(simulatedId, { live: true });
      const simulated = await query<{ status: string; error_message: string }>(
        `SELECT status, error_message FROM publish_queue WHERE id = $1`,
        [simulatedId]
      );
      expect(simulated.rows[0]).toEqual({ status: 'success', error_message: DRY_RUN_LOG });
      expect(posts).toHaveLength(0);

      process.env.LIVE_PUBLISH_ALLOWLIST = 'NS-NOVO';
      const retryId = await enqueue();
      await expect(processPublishQueueItem(retryId, { live: true })).rejects.toBeInstanceOf(NuvemshopPublishError);
      const retryRow = await query<{ status: string }>(`SELECT status FROM publish_queue WHERE id = $1`, [retryId]);
      expect(retryRow.rows[0]?.status).toBe('pending');
      expect(posts).toHaveLength(1);

      mode = 'reject';
      const rejectedId = await enqueue();
      await expect(processPublishQueueItem(rejectedId, { live: true })).rejects.toBeInstanceOf(UnrecoverableError);
      const rejected = await query<{ status: string; error_message: string }>(
        `SELECT status, error_message FROM publish_queue WHERE id = $1`,
        [rejectedId]
      );
      expect(rejected.rows[0]?.status).toBe('failed');
      expect(rejected.rows[0]?.error_message).toContain('400');
      expect(posts).toHaveLength(2);

      mode = 'create';
      const createdId = await enqueue();
      await processPublishQueueItem(createdId, { live: true });
      expect(posts).toHaveLength(3);
      const sent = JSON.parse(posts[2]!) as { name: { pt: string }; variants: Array<{ price: string; stock: number; sku: string }> };
      expect(sent.name.pt).toBe('Produto Nuvemshop');
      expect(sent.variants[0]).toMatchObject({ price: '49.90', stock: 7, sku: 'NS-NOVO' });
      const stored = await query<{ status: string; payload_json: { price: number } | string }>(
        `SELECT status, payload_json FROM publish_queue WHERE id = $1`,
        [createdId]
      );
      const saved = stored.rows[0]?.payload_json;
      const savedPayload = typeof saved === 'string' ? JSON.parse(saved) as { price: number } : saved;
      expect(stored.rows[0]?.status).toBe('success');
      expect(savedPayload?.price).toBe(49.9);
      const link = await query<{ listing_id: string }>(
        `SELECT listing_id FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
        [productId]
      );
      expect(link.rows).toEqual([{ listing_id: '88421' }]);

      const duplicateId = await enqueue();
      await processPublishQueueItem(duplicateId, { live: true });
      expect(posts).toHaveLength(3);
      const duplicate = await query<{ status: string; error_message: string }>(
        `SELECT status, error_message FROM publish_queue WHERE id = $1`,
        [duplicateId]
      );
      expect(duplicate.rows[0]).toEqual({ status: 'failed', error_message: EXISTING_LISTING_MESSAGE });

      await query(`DELETE FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`, [productId]);
      mode = 'exists';
      const replayId = await enqueue();
      await processPublishQueueItem(replayId, { live: true });
      expect(posts).toHaveLength(3);
      const rebound = await query<{ listing_id: string }>(
        `SELECT listing_id FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
        [productId]
      );
      expect(rebound.rows).toEqual([{ listing_id: '88421' }]);
    } finally {
      setNuvemshopFetchForTests(null);
      resetNuvemshopRateLimitForTests();
      if (previousStore === undefined) delete process.env.NUVEMSHOP_STORE_ID;
      else process.env.NUVEMSHOP_STORE_ID = previousStore;
      if (previousAllow === undefined) delete process.env.LIVE_PUBLISH_ALLOWLIST;
      else process.env.LIVE_PUBLISH_ALLOWLIST = previousAllow;
      await setPublishingPaused(false);
    }
  });

  it('publica produto variável com HTML, categoria, marca, atributos e imagens na ordem', async () => {
    const category = await query<{ id: string }>(
      `INSERT INTO hub_categories (name) VALUES ('Nuvemshop Variável') RETURNING id`
    );
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (
         erp_id, erp_sku, name, brand, description, bling_tipo, product_format,
         hub_category_id, ncm_status, ncm_fiscal_risk
       ) VALUES ('ns-var', 'NS-VAR', 'Camiseta Dry Fit', 'JHS', $2, 'P', 'V', $1, 'valid', false)
       RETURNING id`,
      [categoryId, 'Linha 1\n\nLinha 2']
    );
    const productId = product.rows[0]!.id;

    const axes = await query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM attribute_axes WHERE canonical_name IN ('cor', 'tamanho')`
    );
    for (const axis of axes.rows) {
      await query(
        `INSERT INTO product_axes (master_product_id, axis_id, sort_order) VALUES ($1, $2, $3)`,
        [productId, axis.id, axis.canonical_name === 'cor' ? 1 : 2]
      );
    }

    const first = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-AZ-M', false, 'S', 49.9, 3, 3) RETURNING id`,
      [productId]
    );
    const second = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-PT-G', false, 'S', 54.9, 4, 4) RETURNING id`,
      [productId]
    );
    const axisId = new Map(axes.rows.map((axis) => [axis.canonical_name, axis.id]));
    const entries: Array<[string, string, string]> = [
      [first.rows[0]!.id, axisId.get('cor')!, 'Azul'],
      [first.rows[0]!.id, axisId.get('tamanho')!, 'M'],
      [second.rows[0]!.id, axisId.get('cor')!, 'Preto'],
      [second.rows[0]!.id, axisId.get('tamanho')!, 'G'],
    ];
    for (const [variantId, axis, value] of entries) {
      await query(
        `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order) VALUES ($1, $2, $3, 0)`,
        [variantId, axis, value]
      );
    }
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-VAR', 'Loja Variável', 'seller', true)`
    );
    for (const variantId of [first.rows[0]!.id, second.rows[0]!.id]) {
      await query(
        `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
         VALUES ($1, 'DEP-VAR', 3, 3)`,
        [variantId]
      );
    }
    await query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform,
         sha256_hash, format, is_cover_eligible, position_ns
       ) VALUES
         ($1, 'https://bling.test/sec.jpg', 'https://bling.test/sec.jpg', 'bling', NULL, 'jpeg', false, 2),
         ($1, 'https://bling.test/capa.jpg', 'https://bling.test/capa.jpg', 'bling', $2, 'jpeg', true, 1)`,
      [productId, 'b'.repeat(64)]
    );

    await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/nuvemshop`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: '123456',
        channelCategoryName: 'Camisetas',
        attributes: [
          { channelAttributeId: 'BRAND', channelAttributeName: 'Marca', required: true, mode: 'fixed', fixedValue: 'JHS' },
        ],
      });

    await importedCategory(productId, categoryId, 'nuvemshop', '123456');
    const previousBase = process.env.PUBLIC_BASE_URL;
    const previousStore = process.env.NUVEMSHOP_STORE_ID;
    process.env.PUBLIC_BASE_URL = 'https://hub.test';
    process.env.NUVEMSHOP_STORE_ID = '998877';
    process.env.LIVE_PUBLISH_ALLOWLIST = 'NS-VAR';
    resetNuvemshopRateLimitForTests();
    await new OAuthTokenManager().upsertToken({
      provider: 'nuvemshop',
      accessToken: 'token-de-teste',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const productPosts: Array<Record<string, unknown>> = [];
    const imagePosts: Array<{ src: string; position: number }> = [];
    let createdProductId: number | null = null;
    let imageAttempts = 0;

    setNuvemshopFetchForTests(async (url, init) => {
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
      });

      if (init?.method === 'POST' && url.includes('/images')) {
        imageAttempts += 1;
        // A capa entra; a segunda imagem falha para forçar retry parcial.
        if (imageAttempts === 2) return json(503, { message: 'indisponível' });
        const body = JSON.parse(String(init.body)) as { src: string; position: number };
        imagePosts.push(body);
        return json(201, { id: imagePosts.length, src: body.src });
      }
      if (init?.method === 'POST') {
        productPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        createdProductId = 88422;
        return json(201, { id: createdProductId });
      }
      if (url.includes('/products/') && url.includes('/images')) {
        return json(200, imagePosts.map((post) => ({ src: post.src })));
      }
      if (url.includes('/products/sku/')) {
        if (createdProductId === null) return json(404, {});
        const sku = decodeURIComponent(url.split('/products/sku/')[1]!.split('?')[0]!);
        return json(200, { product_id: createdProductId, sku, price: '49.90', stock: 3 });
      }
      return json(200, []);
    });

    const enqueue = async () => {
      await query(
        `UPDATE publish_queue SET status = 'failed'
         WHERE product_id = $1 AND channel = 'nuvemshop' AND status IN ('pending', 'processing')`,
        [productId]
      );
      const inserted = await query<{ id: string }>(
        `INSERT INTO publish_queue (product_id, channel, payload_json)
         VALUES ($1, 'nuvemshop', '{}') RETURNING id`,
        [productId]
      );
      return inserted.rows[0]!.id;
    };

    try {
      const retryId = await enqueue();
      await expect(processPublishQueueItem(retryId, { live: true })).rejects.toBeInstanceOf(NuvemshopPublishError);
      expect(productPosts).toHaveLength(1);
      expect(await query<{ status: string }>(`SELECT status FROM publish_queue WHERE id = $1`, [retryId]))
        .toMatchObject({ rows: [{ status: 'pending' }] });
      expect(imagePosts).toEqual([
        { src: `https://hub.test/api/media/${'b'.repeat(64)}.jpg`, position: 1 },
      ]);

      const createdId = await enqueue();
      await processPublishQueueItem(createdId, { live: true });

      // Retry não repete o POST do produto: o lookup por SKU achou 88422.
      expect(productPosts).toHaveLength(1);
      const body = productPosts[0] as {
        name: { pt: string };
        description: { pt: string };
        categories: number[];
        brand: string;
        attributes: Array<{ pt: string }>;
        variants: Array<{ sku: string; price: string; stock: number; values: Array<{ pt: string }> }>;
      };
      expect(body.name).toEqual({ pt: 'Camiseta Dry Fit' });
      expect(body.description).toEqual({ pt: '<p>Linha 1</p><p>Linha 2</p>' });
      expect(body.categories).toEqual([123456]);
      expect(body.brand).toBe('JHS');
      expect(body.attributes).toEqual([{ pt: 'Cor' }, { pt: 'Tamanho' }]);
      expect(body.variants).toHaveLength(2);
      expect(body.variants.find((variant) => variant.sku === 'NS-AZ-M')).toMatchObject({
        price: '49.90',
        stock: 3,
        values: [{ pt: 'Azul' }, { pt: 'M' }],
      });
      expect(body.variants.find((variant) => variant.sku === 'NS-PT-G')).toMatchObject({
        price: '54.90',
        stock: 4,
        values: [{ pt: 'Preto' }, { pt: 'G' }],
      });

      // O retry reconciliou: a capa já estava no anúncio e só a secundária subiu, na posição 2.
      expect(imagePosts).toEqual([
        { src: `https://hub.test/api/media/${'b'.repeat(64)}.jpg`, position: 1 },
        { src: 'https://bling.test/sec.jpg', position: 2 },
      ]);

      const link = await query<{ listing_id: string }>(
        `SELECT listing_id FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
        [productId]
      );
      expect(link.rows).toEqual([{ listing_id: '88422' }]);
    } finally {
      setNuvemshopFetchForTests(null);
      resetNuvemshopRateLimitForTests();
      if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previousBase;
      if (previousStore === undefined) delete process.env.NUVEMSHOP_STORE_ID;
      else process.env.NUVEMSHOP_STORE_ID = previousStore;
      delete process.env.LIVE_PUBLISH_ALLOWLIST;
    }
  });
});
