import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { setListingSearchForTests } from '../connectors/strategy/marketplaces.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('vínculo de anúncio existente', () => {
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
      email: 'op.vinculo@blingsync.local',
      name: 'Operador Vínculo',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.vinculo@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
    setListingSearchForTests(async () => [
      { id: 'MLB999', title: 'Anúncio já publicado', price: 42.5, status: 'Ativo' },
    ]);
  });

  afterAll(async () => {
    setListingSearchForTests(null);
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('busca o produto do HUB e o anúncio, e vincular não enfileira publicação', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('vinc-1', 'SKU-VINC', 'Produto já no ML', 'P', 'S')
       RETURNING id`
    );
    const productId = created.rows[0]!.id;
    const before = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue`);

    const found = await request(app).get('/api/matching/search?sku=SKU-VINC').set('Cookie', cookie);
    expect(found.status).toBe(200);
    expect(found.body.published).toBe(false);
    expect(found.body.hub).toMatchObject({ id: productId, sku: 'SKU-VINC', status: 'Sem vínculo' });
    expect(found.body.listing).toMatchObject({ id: 'MLB999', title: 'Anúncio já publicado', price: 42.5, status: 'Ativo' });

    const linked = await request(app)
      .post('/api/matching/link')
      .set('Cookie', cookie)
      .send({ productId, listingId: 'MLB999', title: 'Anúncio já publicado', price: 42.5, status: 'Ativo' });
    expect(linked.status).toBe(200);
    expect(linked.body.status).toBe('Vinculado');
    expect(linked.body.published).toBe(false);
    expect(linked.body.queued).toBe(0);

    const after = await query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue`);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const row = await query<{ link_status: string; listing_id: string }>(
      `SELECT link_status, listing_id FROM channel_listing_links WHERE product_id = $1`,
      [productId]
    );
    expect(row.rows[0]).toMatchObject({ link_status: 'vinculado', listing_id: 'MLB999' });

    const again = await request(app).get('/api/matching/search?sku=SKU-VINC').set('Cookie', cookie);
    expect(again.body.hub.status).toBe('Vinculado');
  });
});
