import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  isStuckPublish,
  releaseStuckPublishJobs,
  STUCK_PUBLISH_MESSAGE,
  STUCK_PUBLISH_MS,
} from '../queues/stuck-publish.js';

describe('envios travados em processamento', () => {
  let poolInstance: DbPoolLike;
  const now = Date.parse('2026-11-12T05:00:00Z');

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
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await query(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('erp-stuck', 'SKU-STUCK', 'Produto travado', 'P', 'S')`
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('só considera travado o processing com 15 minutos ou mais', () => {
    expect(isStuckPublish('processing', new Date(now - STUCK_PUBLISH_MS + 1), now)).toBe(false);
    expect(isStuckPublish('processing', new Date(now - STUCK_PUBLISH_MS), now)).toBe(true);
    expect(isStuckPublish('pending', new Date(now - STUCK_PUBLISH_MS), now)).toBe(false);
    expect(isStuckPublish('failed', new Date(now - STUCK_PUBLISH_MS), now)).toBe(false);
  });

  it('marca o envio antigo como falha e deixa o recente em processamento', async () => {
    const product = await query<{ id: string }>(`SELECT id FROM master_products WHERE erp_sku = 'SKU-STUCK'`);
    const productId = product.rows[0]!.id;
    const oldJob = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, status, payload_json, updated_at)
       VALUES ($1, 'nuvemshop', 'processing', '{}', $2)
       RETURNING id`,
      [productId, new Date(now - STUCK_PUBLISH_MS - 60_000)]
    );
    const freshJob = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, status, payload_json, updated_at)
       VALUES ($1, 'nuvemshop', 'processing', '{}', $2)
       RETURNING id`,
      [productId, new Date(now - 60_000)]
    );

    const released = await releaseStuckPublishJobs(now);
    expect(released).toEqual([
      expect.objectContaining({ id: oldJob.rows[0]!.id, sku: 'SKU-STUCK', channel: 'nuvemshop' }),
    ]);

    const rows = await query<{ id: string; status: string; error_message: string | null }>(
      `SELECT id, status, error_message FROM publish_queue WHERE product_id = $1`,
      [productId]
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(oldJob.rows[0]!.id)).toMatchObject({ status: 'failed', error_message: STUCK_PUBLISH_MESSAGE });
    expect(byId.get(freshJob.rows[0]!.id)?.status).toBe('processing');
  });
});