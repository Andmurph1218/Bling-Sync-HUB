import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { MarketplaceListing } from '../connectors/strategy/types.js';
import { reconcileListings } from '../services/reconciliation.service.js';

describe('reconciliação do anúncio', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';
  let productId = '';
  let erpId = '';

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
      email: 'op.recon@blingsync.local',
      name: 'Operador Reconciliação',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.recon@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']) ?? '';
    const created = await query<{ id: string; erp_id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format, ncm_status)
       VALUES ('erp-recon', 'SKU-RECON', 'Lâmpada do ERP', 'P', 'S', 'valid')
       RETURNING id, erp_id`
    );
    productId = created.rows[0]!.id;
    erpId = created.rows[0]!.erp_id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock)
       VALUES ($1, 'SKU-RECON', true, 20, 10)`,
      [productId]
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('lista divergência e importa imagem sem alterar preço nem estoque do ERP', async () => {
    const listing: MarketplaceListing = {
      externalId: 'MLB123',
      title: 'Anúncio mais barato',
      price: 10,
      stock: 8,
      images: ['https://img.local/canal.jpg'],
      status: 'Ativo',
    };
    const result = await reconcileListings(async (channel) => (channel === 'mercadolivre' ? listing : null));
    expect(result.snapshots).toBe(1);
    expect(result.linked).toBe(1);

    const price = await query<{ price: string; stock: string }>(
      `SELECT price::text AS price, stock::text AS stock FROM product_variants WHERE master_product_id = $1`,
      [productId]
    );
    expect(price.rows[0]).toEqual({ price: '20', stock: '10' });

    const alerts = await request(app).get('/api/divergences').set('Cookie', cookie);
    expect(alerts.status).toBe(200);
    expect(alerts.body.items.map((item: { message: string }) => item.message)).toEqual(expect.arrayContaining([
      'Mercado Livre está R$ 10 mais barato que o Bling',
      'Estoque: Bling 10 x ML 8. Vendeu 2 no ML, estoque no Bling não baixou.',
      'O ML tem 1 imagem, o HUB tem 0',
    ]));
    expect(alerts.body.items[0].erpId).toBe(erpId);

    const imported = await request(app)
      .post(`/api/catalog/products/${productId}/images/import-channel`)
      .set('Cookie', cookie)
      .send({ marketplace: 'mercadolivre', url: 'https://img.local/canal.jpg' });
    expect(imported.status).toBe(201);
    const images = await query<{ url_normalized: string }>(
      `SELECT url_normalized FROM product_images WHERE master_product_id = $1`,
      [productId]
    );
    expect(images.rows[0]?.url_normalized).toBe('https://img.local/canal.jpg');
  });
});
