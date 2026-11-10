import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('loja de integrações do administrador', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let adminCookie = '';
  let operatorCookie = '';

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
      email: 'admin.loja@blingsync.local',
      name: 'Admin Loja',
      password: 'SenhaPessoal!2026',
      roles: ['admin'],
      mustChangePassword: false,
    });
    await createUser({
      email: 'op.loja@blingsync.local',
      name: 'Operador Loja',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const adminLogin = await request(app).post('/auth/login').send({
      email: 'admin.loja@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const operatorLogin = await request(app).post('/auth/login').send({
      email: 'op.loja@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    adminCookie = (Array.isArray(adminLogin.headers['set-cookie']) ? adminLogin.headers['set-cookie'][0] : adminLogin.headers['set-cookie']) ?? '';
    operatorCookie = (Array.isArray(operatorLogin.headers['set-cookie']) ? operatorLogin.headers['set-cookie'][0] : operatorLogin.headers['set-cookie']) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('agrupa o catálogo para o admin e recusa o operador', async () => {
    const denied = await request(app).get('/api/admin/integrations').set('Cookie', operatorCookie);
    expect(denied.status).toBe(403);

    const catalog = await request(app).get('/api/admin/integrations').set('Cookie', adminCookie);
    expect(catalog.status).toBe(200);
    expect(catalog.body.groups.map((group: { category: string }) => group.category)).toEqual([
      'Marketplace',
      'ERP',
      'Logística',
    ]);
    const shopee = catalog.body.groups
      .flatMap((group: { apps: Array<{ slug: string; health: string; isAvailable: boolean }> }) => group.apps)
      .find((app: { slug: string }) => app.slug === 'shopee');
    expect(shopee).toMatchObject({ health: 'soon', isAvailable: false });

    const requested = await request(app)
      .post('/api/admin/integrations/shopee/request')
      .set('Cookie', adminCookie);
    expect(requested.status).toBe(201);
    expect(requested.body.requested).toBe(true);
    const stored = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM integration_requests WHERE slug = 'shopee'`
    );
    expect(stored.rows[0]?.count).toBe(1);

    const operatorRequest = await request(app)
      .post('/api/admin/integrations/omie/request')
      .set('Cookie', operatorCookie);
    expect(operatorRequest.status).toBe(403);
  });

  it('trata o Bling com refresh token como autorizado mesmo com o access token vencido', async () => {
    await query(
      `INSERT INTO channel_app_credentials (provider, client_id, client_secret, redirect_uri, is_active)
       VALUES ('bling', 'bling-client', 'bling-secret', 'https://hub.exemplo/oauth/bling/callback', true)`
    );
    await query(
      `INSERT INTO oauth_tokens (provider, access_token_enc, refresh_token_enc, expires_at)
       VALUES ('bling', $1, $2, $3)`,
      [Buffer.from('access'), Buffer.from('refresh'), '2000-01-01T00:00:00.000Z']
    );

    const catalog = await request(app).get('/api/admin/integrations').set('Cookie', adminCookie);
    const bling = catalog.body.groups
      .flatMap((group: { apps: Array<{ slug: string; health: string; tokenValid: boolean }> }) => group.apps)
      .find((app: { slug: string }) => app.slug === 'bling');
    expect(bling).toMatchObject({ health: 'ok', tokenValid: true });
  });
});
