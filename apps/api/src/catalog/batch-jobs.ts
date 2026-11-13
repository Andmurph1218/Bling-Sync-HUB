import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { enqueueReadyProducts, processPublishQueueItem } from '../queues/publish-queue.js';
import { recalculateCompleteness } from './publish-preview.js';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels.js';
import { ReprocessContext, reprocessProblemItem } from './problem-panel.js';
import { processWebhookEventById } from '../engines/wig.js';
import { enqueueErpSync } from '../queues/erp-sync-worker.js';
import { JITTERED_BACKOFF, jitteredBackoffStrategy } from '../queues/backoff.js';

export type BatchAction = 'arquivar' | 'completude' | 'envio' | 'problemas';

interface BatchPayload {
  id: string;
  action: BatchAction;
  ids: string[];
  allowErpSync?: boolean;
}

let queue: Queue<BatchPayload> | null = null;
let workerStarted = false;

function connection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function createBatchJob(
  userId: string | null,
  action: BatchAction,
  ids: string[],
  options: { allowErpSync?: boolean } = {}
): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO batch_jobs (user_id, action, status, total) VALUES ($1, $2, 'queued', $3) RETURNING id`,
    [userId, action, ids.length]
  );
  const id = inserted.rows[0]!.id;
  const payload: BatchPayload = { id, action, ids, allowErpSync: options.allowErpSync === true };
  if (process.env.VITEST) {
    setImmediate(() => {
      void runBatch(payload);
    });
    return id;
  }
  await getQueue().add('run', payload, { jobId: id, attempts: 5, backoff: JITTERED_BACKOFF });
  return id;
}

export function startBatchWorker(): void {
  if (workerStarted || process.env.VITEST) return;
  workerStarted = true;
  const worker = new Worker<BatchPayload>('catalog-batch', async (job) => runBatch(job.data), {
    connection: connection(),
    settings: { backoffStrategy: jitteredBackoffStrategy },
  });
  worker.on('failed', () => undefined);
}

function getQueue(): Queue<BatchPayload> {
  if (!queue) queue = new Queue<BatchPayload>('catalog-batch', { connection: connection() });
  return queue;
}

function problemContext(payload: BatchPayload): ReprocessContext {
  return {
    allowErpSync: payload.allowErpSync === true,
    erpSyncRequested: false,
    startErpSync: async () => {
      const started = await enqueueErpSync();
      return started.accepted;
    },
    recalculate: async (productId) => {
      await recalculateCompleteness([productId]);
    },
    republish: async (publishQueueId) => {
      await processPublishQueueItem(publishQueueId);
    },
    replayWebhook: async (webhookEventId) => {
      await processWebhookEventById(webhookEventId, 'problemas-reprocessar');
    },
  };
}

async function runBatch(payload: BatchPayload): Promise<void> {
  await query(`UPDATE batch_jobs SET status = 'running' WHERE id = $1`, [payload.id]);
  const errors: Array<{ id: string; message: string }> = [];
  const problems = payload.action === 'problemas' ? problemContext(payload) : null;
  let processed = 0;
  for (const id of payload.ids) {
    try {
      if (problems) {
        const failure = await reprocessProblemItem(id, problems);
        if (failure) errors.push({ id, message: failure });
      } else if (payload.action === 'arquivar') {
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
    if (processed % 25 === 0 || processed === payload.ids.length) {
      await query(
        `UPDATE batch_jobs SET processed = $2, rows_error = $3, errors = $4::jsonb WHERE id = $1`,
        [payload.id, processed, errors.length, JSON.stringify(errors.slice(0, 500))]
      );
    }
  }
  await query(
    `UPDATE batch_jobs SET status = 'done', finished_at = now(), processed = $2, rows_error = $3, errors = $4::jsonb WHERE id = $1`,
    [payload.id, processed, errors.length, JSON.stringify(errors.slice(0, 500))]
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
