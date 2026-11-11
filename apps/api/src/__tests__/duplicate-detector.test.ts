import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { RemoteListing } from '../connectors/strategy/types.js';
import { detectDuplicates } from '../services/duplicate-detector.service.js';

describe('detector de duplicidade', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';
  let keeperId = '';

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
      email: 'op.dup@blingsync.local',
      name: 'Operador Duplicidade',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.dup@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']) ?? '';

    const first = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm_status, ncm_fiscal_risk)
       VALUES ('erp-a', 'SKU-A', 'Lâmpada A', 'P', 'S', 'valid', false) RETURNING id`
    );
    const second = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm_status, ncm_fiscal_risk)
       VALUES ('erp-b', 'SKU-B', 'Lâmpada B', 'P', 'S', 'valid', false) RETURNING id`
    );
    keeperId = first.rows[0]!.id;
    const ready = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm_status, ncm_fiscal_risk)
       VALUES ('erp-c', 'SKU-ML', 'Lâmpada pronta', 'P', 'S', 'valid', false) RETURNING id`
    );
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock, ean, ean_status)
       VALUES ($1, 'SKU-A', true, 10, 1, '7891000000001', 'valid'), ($2, 'SKU-B', true, 10, 1, '7891000000001', 'duplicate')`,
      [first.rows[0]!.id, second.rows[0]!.id]
    );
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock, ean_status)
       VALUES ($1, 'SKU-ML', true, 10, 1, 'valid')`,
      [ready.rows[0]!.id]
    );
    await query(
      `INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible)
       VALUES ($1, 'https://img.local/ml.jpg', 'https://img.local/ml.jpg', 'bling', true)`,
      [ready.rows[0]!.id]
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('grava SKU repetido e anúncio ativo, e o operador arquiva o duplicado do ERP', async () => {
    const listings = new Map<string, RemoteListing[]>([
      ['SKU-ML', [{ id: 'MLB123', title: 'Já publicado', price: 10, status: 'Ativo' }]],
    ]);
    const found = await detectDuplicates(async (channel, input) => (
      channel === 'mercadolivre' ? listings.get(input.sku) ?? [] : []
    ));
    expect(found.erp).toBe(2);
    expect(found.marketplace).toBe(1);

    const list = await request(app).get('/api/duplicates').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);
    const marketplace = list.body.items.find((item: { conflictType: string }) => item.conflictType === 'marketplace');
    expect(marketplace.label).toBe('Já existe no Mercado Livre - MLB123');
    const erpAlert = list.body.items.find(
      (item: { conflictType: string; productId: string }) => item.conflictType === 'erp_ean' && item.productId !== keeperId
    );

    const archived = await request(app)
      .post(`/api/duplicates/${erpAlert.id}/resolve`)
      .set('Cookie', cookie)
      .send({ action: 'archive' });
    expect(archived.status).toBe(200);
    const product = await query<{ archived_at: string | null }>(
      `SELECT archived_at FROM master_products WHERE id = $1`,
      [erpAlert.productId]
    );
    expect(product.rows[0]?.archived_at).toBeTruthy();

    const linked = await request(app)
      .post(`/api/duplicates/${marketplace.id}/resolve`)
      .set('Cookie', cookie)
      .send({ action: 'link' });
    expect(linked.status).toBe(200);
    const link = await query<{ listing_id: string }>(
      `SELECT listing_id FROM channel_listing_links WHERE product_id = $1 AND channel = 'mercadolivre'`,
      [marketplace.productId]
    );
    expect(link.rows[0]?.listing_id).toBe('MLB123');

    const again = await detectDuplicates(async () => []);
    expect(again.marketplace).toBe(0);
    const open = await request(app).get('/api/duplicates').set('Cookie', cookie);
    expect(open.body.items.some((item: { id: string }) => item.id === erpAlert.id || item.id === marketplace.id)).toBe(false);
  });
});
