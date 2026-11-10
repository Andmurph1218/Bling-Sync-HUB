import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { enqueueReadyProducts } from '../queues/publish-queue.js';
import { recalculateCompleteness } from './publish-preview.js';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels.js';

interface BatchPayload {
  id: string;
  action: 'arquivar' | 'completude' | 'envio';
  ids: string[];
}

let queue: Queue<BatchPayload> | null = null;
let workerStarted = false;

function connection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function createBatchJob(
  userId: string | null,
  action: BatchPayload['action'],
  ids: string[]
): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO batch_jobs (user_id, action, status, total) VALUES ($1, $2, 'queued', $3) RETURNING id`,
    [userId, action, ids.length]
  );
  const id = inserted.rows[0]!.id;
  const payload: BatchPayload = { id, action, ids };
  if (process.env.VITEST) {
    setImmediate(() => {
      void runBatch(payload);
    });
    return id;
  }
  await getQueue().add('run', payload, { jobId: id });
  return id;
}

export function startBatchWorker(): void {
  if (workerStarted || process.env.VITEST) return;
  workerStarted = true;
  const worker = new Worker<BatchPayload>('catalog-batch', async (job) => runBatch(job.data), {
    connection: connection(),
  });
  worker.on('failed', () => undefined);
}

function getQueue(): Queue<BatchPayload> {
  if (!queue) queue = new Queue<BatchPayload>('catalog-batch', { connection: connection() });
  return queue;
}

async function runBatch(payload: BatchPayload): Promise<void> {
  await query(`UPDATE batch_jobs SET status = 'running' WHERE id = $1`, [payload.id]);
  const errors: Array<{ id: string; message: string }> = [];
  let processed = 0;
  for (const id of payload.ids) {
    try {
      if (payload.action === 'arquivar') {
        await query(`UPDATE master_products SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1`, [id]);
      } else if (payload.action === 'completude') {
        await recalculateCompleteness([id]);
      } else {
        const channel = MERCADO_LIVRE_ACTIVE ? 'mercadolivre' : 'nuvemshop';
        const result = await enqueueReadyProducts([id], channel);
        if (result.skipped.length > 0) {
          errors.push({ id, message: result.skipped.map((item) => item.reason).join('; ') });
        }
      }
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
    processed += 1;
    await query(
      `UPDATE batch_jobs SET processed = $2, rows_error = $3, errors = $4::jsonb WHERE id = $1`,
      [payload.id, processed, errors.length, JSON.stringify(errors)]
    );
  }
  await query(
    `UPDATE batch_jobs SET status = 'done', finished_at = now(), processed = $2, rows_error = $3, errors = $4::jsonb WHERE id = $1`,
    [payload.id, processed, errors.length, JSON.stringify(errors)]
  );
}

export async function readBatchJob(id: string) {
  const found = await query<{
    id: string;
    action: string;
    status: string;
    total: number;
    processed: number;
    rows_error: number;
    errors: Array<{ id: string; message: string }>;
  }>(
    `SELECT id, action, status, total, processed, rows_error, errors FROM batch_jobs WHERE id = $1`,
    [id]
  );
  return found.rows[0] ?? null;
}
