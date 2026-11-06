import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { ListingDraft } from '../connectors/strategy/types.js';
import { createMarketplaceConnector } from '../connectors/strategy/factory.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export const PUBLISH_QUEUE_NAME = 'publish-marketplace';
export const DRY_RUN_LOG = 'simulado com sucesso';

export interface PublishJobInput {
  productId: string;
  channel: 'mercadolivre' | 'nuvemshop' | 'shopee' | 'amazon' | 'tiktok';
  payload: ListingDraft;
}

interface PublishRow {
  id: string;
  product_id: string;
  channel: PublishJobInput['channel'];
  payload_json: ListingDraft;
}

let queue: Queue | null = null;
let worker: Worker | null = null;

/** Só a string exata "true" liga a publicação. Ausente ou qualquer outro valor permanece em simulação. */
export function isLivePublishingEnabled(): boolean {
  return process.env.ENABLE_LIVE_PUBLISHING === 'true';
}

function redisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function getPublishQueue(): Queue {
  if (!queue) {
    queue = new Queue(PUBLISH_QUEUE_NAME, { connection: redisConnection() });
  }
  return queue;
}

async function mark(
  id: string,
  status: 'processing' | 'success' | 'failed',
  errorMessage: string | null
): Promise<void> {
  await query(
    `UPDATE publish_queue
     SET status = $2, error_message = $3, updated_at = now()
     WHERE id = $1`,
    [id, status, errorMessage]
  );
}

/**
 * Consome um item da publish_queue.
 * Com a flag desligada, não chama createListing e portanto não há requisição ao marketplace.
 */
export async function processPublishQueueItem(
  id: string,
  hooks?: {
    live?: boolean;
    publish?: (channel: string, draft: ListingDraft) => Promise<void>;
  }
): Promise<void> {
  const found = await query<PublishRow>(
    `SELECT id, product_id, channel, payload_json
     FROM publish_queue
     WHERE id = $1`,
    [id]
  );
  const row = found.rows[0];
  if (!row) return;

  await mark(id, 'processing', null);
  try {
    const connector = createMarketplaceConnector(row.channel);
    const live = hooks?.live ?? isLivePublishingEnabled();
    if (!live) {
      await mark(id, 'success', DRY_RUN_LOG);
      return;
    }
    const draft = row.payload_json;
    if (hooks?.publish) {
      await hooks.publish(connector.id, draft);
    } else {
      const result = await connector.createListing(draft);
      if (!result.performed) {
        await mark(id, 'failed', result.reason);
        return;
      }
    }
    await mark(id, 'success', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mark(id, 'failed', message.slice(0, 500));
    throw error;
  }
}

export async function createPublishJobs(items: PublishJobInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const inserted = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, status, payload_json)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id`,
      [item.productId, item.channel, JSON.stringify(item.payload)]
    );
    const id = inserted.rows[0]!.id;
    ids.push(id);
    if (process.env.VITEST) {
      await processPublishQueueItem(id);
      continue;
    }
    try {
      await getPublishQueue().add('publish', { publishQueueId: id }, { jobId: id, removeOnComplete: 1000, removeOnFail: 500 });
    } catch (error) {
      logger.error('Não foi possível enfileirar a publicação. O item ficou pendente.', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return ids;
}

export function startPublishWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    PUBLISH_QUEUE_NAME,
    async (job: { data: { publishQueueId: string } }) => {
      await processPublishQueueItem(job.data.publishQueueId);
    },
    { connection: redisConnection(), concurrency: 2 }
  );
  worker.on('failed', (job, error) => {
    logger.error('Job de publicação falhou', { jobId: job?.id, error: error.message });
  });
  return worker;
}
