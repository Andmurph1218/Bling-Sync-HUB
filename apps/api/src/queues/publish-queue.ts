import { DelayedError, Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { isRetryablePublishError } from '../connectors/strategy/nuvemshop-publish.js';
import { ListingDraft } from '../connectors/strategy/types.js';
import { getMarketplaceConnector } from '../connectors/strategy/factory.js';
import { query, withTransaction } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { getRedis } from '../lib/redis.js';
import { EXISTING_LISTING_MESSAGE } from '../catalog/completeness.js';
import { buildPublishPreview, checklistForChannel, linkedListingExternalId, PublishChannel } from '../catalog/publish-preview.js';
import { isFinalQueueAttempt, JITTERED_BACKOFF, jitteredBackoffStrategy } from './backoff.js';
import { recordDeadLetter } from './dead-letters.js';

export const PUBLISH_QUEUE_NAME = 'publish-marketplace';
export const DRY_RUN_LOG = 'simulado com sucesso';
export const CHECKLIST_BLOCKED_MESSAGE = 'Checklist não implementado para este canal. Publicação bloqueada.';
export const PAUSE_PUBLISHING_KEY = 'PAUSE_PUBLISHING';
export const PUBLISH_PAUSED_MESSAGE = 'Publicação pausada pelo botão de pânico.';

export class PublishPausedError extends Error {
  constructor() {
    super(PUBLISH_PAUSED_MESSAGE);
    this.name = 'PublishPausedError';
  }
}

/** SKUs autorizados no piloto. Lista vazia não publica ninguém. */
export function parseLivePublishAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
  );
}

export function isLiveSkuAllowed(sku: string): boolean {
  return parseLivePublishAllowlist(process.env.LIVE_PUBLISH_ALLOWLIST).has(sku.trim().toLowerCase());
}

interface PauseRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let memoryPause = false;

function pauseRedis(): PauseRedis | null {
  const client = getRedis() as Partial<PauseRedis>;
  if (typeof client.get !== 'function' || typeof client.set !== 'function' || typeof client.del !== 'function') return null;
  return client as PauseRedis;
}

export async function isPublishingPaused(): Promise<boolean> {
  const client = pauseRedis();
  if (!client) return memoryPause;
  try {
    return (await client.get(PAUSE_PUBLISHING_KEY)) === 'true';
  } catch (error) {
    logger.warn('Não foi possível ler a pausa da publicação. O processo segue com a memória local.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return memoryPause;
  }
}

export async function setPublishingPaused(paused: boolean): Promise<void> {
  const client = pauseRedis();
  if (client) {
    if (paused) await client.set(PAUSE_PUBLISHING_KEY, 'true');
    else await client.del(PAUSE_PUBLISHING_KEY);
  }
  memoryPause = paused;
  if (process.env.VITEST === 'true') {
    if (paused) await worker?.pause(true);
    else worker?.resume();
    return;
  }
  const publishQueue = getPublishQueue();
  if (paused) {
    await publishQueue.pause();
    await worker?.pause(true);
    return;
  }
  await publishQueue.resume();
  worker?.resume();
}

export function checklistChannel(channel: string): channel is PublishChannel {
  return channel === 'mercadolivre' || channel === 'nuvemshop';
}

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
  status: 'pending' | 'processing' | 'success' | 'failed',
  errorMessage: string | null
): Promise<void> {
  await query(
    `UPDATE publish_queue
     SET status = $2, error_message = $3, updated_at = now()
     WHERE id = $1`,
    [id, status, errorMessage]
  );
}

async function listingDraftNow(productId: string, channel: PublishChannel): Promise<ListingDraft | null> {
  const preview = await buildPublishPreview(productId, channel);
  if (!preview?.payload.seller_custom_field) return null;
  return {
    sku: preview.payload.seller_custom_field,
    title: preview.payload.title,
    price: preview.payload.price,
    stock: preview.payload.available_quantity,
    attributes: preview.payload.attributes,
  };
}

async function commitCreatedListing(
  id: string,
  productId: string,
  channel: string,
  draft: ListingDraft,
  externalId: string
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO channel_listing_links (product_id, channel, listing_id, listing_title, listing_price, listing_status, link_status)
       VALUES ($1, $2, $3, $4, $5, 'Ativo', 'vinculado')`,
      [productId, channel, externalId, draft.title ?? null, draft.price]
    );
    await client.query(
      `UPDATE publish_queue
       SET status = 'success', error_message = NULL, payload_json = $2, updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(draft)]
    );
  });
}

/**
 * Consome um item da publish_queue.
 * Com a flag desligada, não chama createListing e portanto não há requisição ao marketplace.
 * No envio real, preço, estoque e título são lidos de novo imediatamente antes do POST.
 */
export async function processPublishQueueItem(
  id: string,
  hooks?: {
    live?: boolean;
    publish?: (channel: string, draft: ListingDraft) => Promise<void>;
    attemptsMade?: number;
    maxAttempts?: number;
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

  try {
    if (await isPublishingPaused()) throw new PublishPausedError();
    await mark(id, 'processing', null);
    if (!checklistChannel(row.channel)) {
      await mark(id, 'failed', CHECKLIST_BLOCKED_MESSAGE);
      return;
    }
    const checklist = await checklistForChannel(row.product_id, row.channel);
    if (!checklist?.ready) {
      const pending = checklist?.items.filter((item) => !item.ok).map((item) => item.title).join('; ');
      await mark(id, 'failed', pending || 'Checklist incompleto no canal.');
      return;
    }
    const externalId = await linkedListingExternalId(row.product_id, row.channel);
    if (externalId) {
      await mark(id, 'failed', EXISTING_LISTING_MESSAGE);
      return;
    }
    const live = hooks?.live ?? isLivePublishingEnabled();
    if (!live) {
      await mark(id, 'success', DRY_RUN_LOG);
      return;
    }
    if (await isPublishingPaused()) {
      await mark(id, 'pending', PUBLISH_PAUSED_MESSAGE);
      throw new PublishPausedError();
    }
    const draft = await listingDraftNow(row.product_id, row.channel);
    if (!draft) {
      await mark(id, 'failed', 'Sem SKU — não sincroniza');
      return;
    }
    if (!isLiveSkuAllowed(draft.sku)) {
      await mark(id, 'success', DRY_RUN_LOG);
      return;
    }
    const connector = getMarketplaceConnector(row.channel);
    if (hooks?.publish) {
      await hooks.publish(connector.id, draft);
      await mark(id, 'success', null);
      return;
    }
    const result = await connector.createListing(draft);
    if (!result.performed || !result.externalId) {
      await mark(id, 'failed', result.reason || 'A Nuvemshop não devolveu o id do anúncio.');
      return;
    }
    await commitCreatedListing(id, row.product_id, row.channel, draft, result.externalId);
  } catch (error) {
    if (error instanceof PublishPausedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const made = (hooks?.attemptsMade ?? 0) + 1;
    const retry = isRetryablePublishError(error) && !isFinalQueueAttempt(made, hooks?.maxAttempts ?? 5);
    await mark(id, retry ? 'pending' : 'failed', message.slice(0, 500));
    if (retry) throw error;
    if (isRetryablePublishError(error)) throw error;
    throw new UnrecoverableError(message);
  }
}

export async function enqueueReadyProducts(ids: string[], channel: PublishChannel) {
  const queued: string[] = [];
  const skipped: Array<{ id: string; sku: string; reason: string }> = [];
  for (const id of ids) {
    const checklist = await checklistForChannel(id, channel);
    if (!checklist) {
      skipped.push({ id, sku: '', reason: 'Produto não encontrado.' });
      continue;
    }
    if (!checklist.ready) {
      const pending = checklist.items.filter((item) => !item.ok).map((item) => item.title);
      skipped.push({ id, sku: checklist.sku, reason: pending.join('; ') || 'Checklist incompleto.' });
      continue;
    }
    const preview = await buildPublishPreview(id, channel);
    if (!preview || !preview.payload.seller_custom_field) {
      skipped.push({ id, sku: checklist.sku, reason: 'Sem SKU — não sincroniza' });
      continue;
    }
    const [jobId] = await createPublishJobs([
      {
        productId: id,
        channel,
        payload: {
          sku: preview.payload.seller_custom_field,
          title: preview.payload.title,
          price: preview.payload.price,
          stock: preview.payload.available_quantity,
          attributes: preview.payload.attributes,
        },
      },
    ]);
    if (jobId) queued.push(jobId);
  }
  return { queued, skipped };
}

export async function enqueueCheckedJobs(
  jobs: Array<{ productId: string; channel: PublishJobInput['channel'] }>
) {
  const queued: string[] = [];
  const skipped: Array<{ id: string; sku: string; reason: string }> = [];
  const grouped = new Map<PublishChannel, string[]>();
  for (const job of jobs) {
    if (!checklistChannel(job.channel)) {
      skipped.push({ id: job.productId, sku: '', reason: CHECKLIST_BLOCKED_MESSAGE });
      continue;
    }
    const ids = grouped.get(job.channel) ?? [];
    ids.push(job.productId);
    grouped.set(job.channel, ids);
  }
  for (const [channel, ids] of grouped) {
    const result = await enqueueReadyProducts(ids, channel);
    queued.push(...result.queued);
    skipped.push(...result.skipped);
  }
  return { queued, skipped };
}

export async function createPublishJobs(items: PublishJobInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    if (!checklistChannel(item.channel)) continue;
    const checklist = await checklistForChannel(item.productId, item.channel);
    if (!checklist?.ready) continue;
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
      await getPublishQueue().add('publish', { publishQueueId: id }, { jobId: id, attempts: 5, backoff: JITTERED_BACKOFF, removeOnComplete: 1000, removeOnFail: 500 });
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
    async (job: { data: { publishQueueId: string }; attemptsMade?: number; opts: { attempts?: number }; moveToDelayed: (timestamp: number, token?: string) => Promise<void> }, token?: string) => {
      try {
        await processPublishQueueItem(job.data.publishQueueId, {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts,
        });
      } catch (error) {
        if (error instanceof PublishPausedError) {
          await job.moveToDelayed(Date.now() + 15_000, token);
          throw new DelayedError(PUBLISH_PAUSED_MESSAGE);
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: 2, settings: { backoffStrategy: jitteredBackoffStrategy } }
  );
  worker.on('failed', (job, error) => {
    logger.error('Job de publicação falhou', { jobId: job?.id, error: error.message });
    const terminal = error instanceof UnrecoverableError || isFinalQueueAttempt(job?.attemptsMade, job?.opts.attempts);
    if (!terminal) return;
    void recordDeadLetter({ queue: PUBLISH_QUEUE_NAME, payload: job?.data ?? {}, error: error.message }).catch((recordError: unknown) => {
      logger.error('Não foi possível gravar a carta morta da publicação', {
        error: recordError instanceof Error ? recordError.message : String(recordError),
      });
    });
  });
  void isPublishingPaused().then(async (paused) => {
    if (!paused || !worker) return;
    await worker.pause(true);
    if (process.env.VITEST === 'true') return;
    await getPublishQueue().pause();
  }).catch((error: unknown) => {
    logger.error('Não foi possível aplicar a pausa já gravada da publicação.', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return worker;
}
