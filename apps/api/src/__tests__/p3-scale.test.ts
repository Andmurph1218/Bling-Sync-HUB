import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('P3 — relatório e depósitos', () => {
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
      email: 'op.p3@blingsync.local',
      name: 'Operador P3',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.p3@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('devolve a série vazia com a fonte e o período', async () => {
    const response = await request(app).get('/api/reports/completeness?days=7').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.periodDays).toBe(7);
    expect(response.body.readiness.source).toBe('channel_readiness_history');
    expect(response.body.readiness.points).toEqual([]);
    expect(response.body.quality.source).toBe('quality_history');
  });

  it('esconde depósitos quando o anúncio não tem centros', async () => {
    const created = await request(app).get('/api/catalog/products/00000000-0000-4000-8000-000000000001/places').set('Cookie', cookie);
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ supported: false, places: [] });
  });
});
