import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('credenciais de aplicativo no banco', () => {
  const app = createApp();
  let pool: DbPoolLike;
  let adminCookie = '';

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
    const adapter = mem.adapters.createPg();
    pool = new adapter.Pool() as unknown as DbPoolLike;
    setPool(pool);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'admin.cred@blingsync.local',
      name: 'Admin Cred',
      password: 'SenhaPessoal!2026',
      roles: ['admin'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'admin.cred@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
  });

  afterAll(async () => {
    await pool.end();
    setPool(null);
  });

  it('autoriza o Mercado Livre e o Bling com o client id gravado no banco', async () => {
    const secret = 'segredo-somente-no-banco';
    const saved = await request(app)
      .post('/api/admin/integrations/mercadolivre/credentials')
      .set('Cookie', adminCookie)
      .send({ clientId: 'ml-app-do-banco', clientSecret: secret, redirectUri: 'https://hub.jhshopping.com.br/oauth/mercadolivre/callback' });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(secret);
    expect(saved.body.callbackUrl).toBe('https://hub.jhshopping.com.br/oauth/mercadolivre/callback');

    const ml = await request(app).get('/oauth/mercadolivre/authorize');
    expect(ml.status).toBe(302);
    const location = String(ml.headers.location);
    expect(location).toContain('client_id=ml-app-do-banco');
    expect(location).toContain(encodeURIComponent('https://hub.jhshopping.com.br/oauth/mercadolivre/callback'));
    expect(location).not.toContain(secret);

    await request(app)
      .put('/api/admin/integrations/bling/credentials')
      .set('Cookie', adminCookie)
      .send({ clientId: 'bling-app-do-banco', clientSecret: secret });
    const bling = await request(app).get('/oauth/bling/authorize');
    expect(bling.status).toBe(302);
    expect(String(bling.headers.location)).toContain('client_id=bling-app-do-banco');
    expect(String(bling.headers.location)).not.toContain(secret);
  });

  it('grava o token do aplicativo sob medida da Nuvemshop sem instalação', async () => {
    const token = 'token-sob-medida-que-nao-volta';
    const saved = await request(app)
      .put('/api/admin/integrations/nuvemshop/credentials')
      .set('Cookie', adminCookie)
      .send({ clientId: '6667412', accessToken: token });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(token);

    const catalog = await request(app).get('/api/admin/integrations').set('Cookie', adminCookie);
    const nuvemshop = catalog.body.groups
      .flatMap((group: { apps: Array<{ slug: string; tokenValid: boolean }> }) => group.apps)
      .find((app: { slug: string }) => app.slug === 'nuvemshop');
    expect(nuvemshop).toMatchObject({ tokenValid: true, hasToken: true });
  });
});
