import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { ERP_SYNC_DENIED } from '../catalog/problem-panel.js';

interface GroupRow {
  key: string;
  type: string;
  severity: string;
  source: string;
  count: number;
  groupMessage: string;
  action: string;
}

describe('Painel de exceções agrupado', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';

  const panel = async (): Promise<{ groups: GroupRow[]; counts: Record<string, number> }> => {
    const response = await request(app).get('/api/problems/panel').set('Cookie', cookie);
    expect(response.status).toBe(200);
    return response.body;
  };

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    for (const [name, impl] of [
      ['trim', (val: string) => (val ? val.trim() : '')],
      ['lower', (val: string) => (val ? val.toLowerCase() : '')],
    ] as const) {
      mem.public.registerFunction({ name, args: [DataType.text], returns: DataType.text, implementation: impl });
    }
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'operador.problemas@blingsync.local',
      name: 'Operador Problemas',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'operador.problemas@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';

    for (let index = 0; index < 120; index += 1) {
      await query(
        `INSERT INTO master_products (bling_id, bling_sku, name, ncm_status, bling_tipo, bling_formato)
         VALUES ($1, $2, $3, 'unknown', 'P', 'S')`,
        [`pp-${index}`, `PP-${String(index).padStart(3, '0')}`, `Produto ${index}`]
      );
    }
    const first = await query<{ id: string }>(`SELECT id FROM master_products WHERE bling_id = 'pp-0'`);
    for (let index = 0; index < 3; index += 1) {
      await query(
        `INSERT INTO publish_queue (product_id, channel, status, payload_json, error_message)
         VALUES ($1, 'nuvemshop', 'failed', '{}', 'picture_too_small')`,
        [first.rows[0]!.id]
      );
    }
    await query(
      `INSERT INTO webhook_events (source, event_type, resource_id, content_hash, idempotency_key, status, error_detail, raw_payload)
       VALUES ('bling', 'stock.updated', 'pp-1', $1, 'pp-stock-1', 'failed', 'saldo rejeitado', '{"saldo": -1}')`,
      ['a'.repeat(64)]
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('devolve uma linha por erro em vez de uma por produto', async () => {
    const body = await panel();
    const stock = body.groups.find((group) => group.key === 'gap:stock');
    expect(stock).toMatchObject({ count: 120, severity: 'critico', type: 'estoque', action: 'reprocess' });
    expect(stock?.groupMessage).toBe('120 produtos aguardando leitura de estoque do ERP');
    expect(body.groups.find((group) => group.key === 'gap:ncm')).toMatchObject({ count: 120, action: 'bling' });

    const publish = body.groups.filter((group) => group.source === 'publish_queue');
    expect(publish).toHaveLength(1);
    expect(publish[0]).toMatchObject({ count: 3, type: 'anuncio' });

    const webhook = body.groups.find((group) => group.source === 'webhook_events');
    expect(webhook).toMatchObject({ count: 1, type: 'estoque', severity: 'critico' });
    expect(body.counts.todos).toBe(body.groups.reduce((sum, group) => sum + group.count, 0));
  });

  it('expande um grupo paginado e abre o log técnico do item', async () => {
    const page = await request(app)
      .get(`/api/problems/groups/${encodeURIComponent('gap:stock')}/items?page=2&pageSize=50`)
      .set('Cookie', cookie);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(120);
    expect(page.body.items).toHaveLength(50);

    const { groups } = await panel();
    const webhook = groups.find((group) => group.source === 'webhook_events')!;
    const items = await request(app)
      .get(`/api/problems/groups/${encodeURIComponent(webhook.key)}/items`)
      .set('Cookie', cookie);
    expect(items.body.items[0]).toMatchObject({ sku: 'PP-001', message: 'saldo rejeitado' });

    const log = await request(app)
      .get(`/api/problems/items/${encodeURIComponent(items.body.items[0].id)}/log`)
      .set('Cookie', cookie);
    expect(log.status).toBe(200);
    expect(log.body.technical).toMatchObject({ origem: 'webhook_events', evento: 'stock.updated', payload: { saldo: -1 } });
  });

  it('exporta grupos e itens selecionados em CSV', async () => {
    const { groups } = await panel();
    const publish = groups.find((group) => group.source === 'publish_queue')!;
    const csv = await request(app)
      .post('/api/problems/export.csv')
      .set('Cookie', cookie)
      .send({ groupKeys: [publish.key], itemIds: [] });
    expect(csv.status).toBe(200);
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('gravidade;tipo;canal;sku;bling_id;produto;mensagem;data');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('Erro;Publicação;Nuvemshop;PP-000');
  });

  it('reprocessa em lote de forma assíncrona e só o admin força a leitura do Bling', async () => {
    const started = await request(app)
      .post('/api/problems/reprocess')
      .set('Cookie', cookie)
      .send({ groupKeys: ['gap:stock', 'gap:ncm'] });
    expect(started.status).toBe(202);
    expect(started.body.total).toBe(121);

    let job = { status: 'queued', errors: [] as Array<{ message: string }>, processed: 0 };
    for (let attempt = 0; attempt < 50 && job.status !== 'done'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const read = await request(app).get(`/api/catalog/batch-jobs/${started.body.batchJobId}`).set('Cookie', cookie);
      job = read.body;
    }
    expect(job.status).toBe('done');
    expect(job.processed).toBe(121);
    expect(job.errors).toEqual([expect.objectContaining({ message: ERP_SYNC_DENIED })]);
  });

  it('ignora um grupo inteiro e ele some do painel', async () => {
    const before = await panel();
    const publish = before.groups.find((group) => group.source === 'publish_queue')!;
    const webhook = before.groups.find((group) => group.source === 'webhook_events')!;
    const dismissed = await request(app)
      .post('/api/problems/dismiss')
      .set('Cookie', cookie)
      .send({ groupKeys: [publish.key, webhook.key, 'gap:ncm'] });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.dismissed).toBe(124);

    const after = await panel();
    expect(after.groups.find((group) => group.source === 'publish_queue')).toBeUndefined();
    expect(after.groups.find((group) => group.source === 'webhook_events')).toBeUndefined();
    expect(after.groups.find((group) => group.key === 'gap:ncm')).toBeUndefined();
    expect(after.groups.find((group) => group.key === 'gap:stock')?.count).toBe(120);
  });
});
