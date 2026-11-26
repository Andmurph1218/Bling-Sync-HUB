import crypto from 'node:crypto';
import request from 'supertest';
import { DataType, newDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { loadConnectors } from '../connectors/load.js';
import { registerErpConnector } from '../connectors/strategy/factory.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { DbPoolLike, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

const app = createApp();
let pool: DbPoolLike;
let calls = 0;
const cookies = new Map<string, string>();
const previousErp = process.env.ACTIVE_ERP;

describe('API de auditoria de categorias', () => {
  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => crypto.randomUUID() });
    mem.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (v: string) => v?.trim() ?? '' });
    mem.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (v: string) => v?.length ?? 0 });
    const pg = mem.adapters.createPg();
    pool = new pg.Pool() as unknown as DbPoolLike;
    setPool(pool);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await loadConnectors();
    process.env.ACTIVE_ERP = 'test-category-erp';
    registerErpConnector('test-category-erp', () => ({ id: 'test-category-erp', fetchCategoryMappings: async () => {
      calls += 1;
      return [{ erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '123456' }];
    } } as ErpConnector));
    for (const role of ['admin', 'operator'] as const) {
      const email = `category-${role}@test.local`;
      await createUser({ email, name: role, password: 'Test-category!2026', roles: [role], mustChangePassword: false });
      const login = await request(app).post('/auth/login').send({ email, password: 'Test-category!2026' });
      const header = login.headers['set-cookie'];
      cookies.set(role, (Array.isArray(header) ? header[0] : header) ?? '');
    }
  });
  afterAll(async () => {
    if (previousErp === undefined) delete process.env.ACTIVE_ERP; else process.env.ACTIVE_ERP = previousErp;
    if (pool) await pool.end();
    setPool(null);
  });

  it('não chama o ERP sem autenticação ou sem papel admin', async () => {
    expect((await request(app).post('/api/admin/sync-category-mappings')).status).toBe(401);
    for (const role of ['operator']) {
      expect((await request(app).post('/api/admin/sync-category-mappings').set('Cookie', cookies.get(role)!)).status).toBe(403);
    }
    expect(calls).toBe(0);
  });

  it('permite leitura ao operador e sincroniza pelo contrato do ERP ativo somente como admin', async () => {
    expect((await request(app).get('/api/admin/category-mappings').set('Cookie', cookies.get('operator')!)).status).toBe(200);
    const sync = await request(app).post('/api/admin/sync-category-mappings').set('Cookie', cookies.get('admin')!);
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ provider: 'test-category-erp', mappings: 1 });
    expect(calls).toBe(1);
    const audit = await request(app).get('/api/admin/category-mappings').set('Cookie', cookies.get('operator')!);
    expect(audit.body.mappings).toEqual([expect.objectContaining({ erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '123456', status: 'connected' })]);
  });
});
