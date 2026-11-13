import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { listOpenDeadLetters, recordDeadLetter, replayDeadLetter } from '../queues/dead-letters.js';

describe('fila morta', () => {
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
      email: 'op.dead@blingsync.local',
      name: 'Operador Fila',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.dead@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('acumula tentativas e o reprocessamento tira a carta da lista aberta', async () => {
    const payload = { publishQueueId: '' };
    await recordDeadLetter({ queue: 'publish-marketplace', payload, error: 'timeout' });
    await recordDeadLetter({ queue: 'publish-marketplace', payload, error: 'timeout de novo' });
    const open = await listOpenDeadLetters();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ label: 'Publicação', attempts: 2, error: 'timeout de novo' });

    const product = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('erp-dead', 'DEAD-1', 'Sem checklist', 'P', 'S')
       RETURNING id`
    );
    const queued = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, status, payload_json, error_message)
       VALUES ($1, 'nuvemshop', 'failed', '{}', 'timeout de novo')
       RETURNING id`,
      [product.rows[0]!.id]
    );
    await query(`UPDATE dead_letters SET payload = $2 WHERE id = $1`, [
      open[0]!.id,
      JSON.stringify({ publishQueueId: queued.rows[0]!.id }),
    ]);

    await replayDeadLetter(open[0]!.id);
    const listed = await request(app).get('/api/dead-letters').set('Cookie', cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([]);
    const stored = await query<{ status: string }>(`SELECT status FROM publish_queue WHERE id = $1`, [queued.rows[0]!.id]);
    expect(stored.rows[0]?.status).toBe('failed');
  });
});
