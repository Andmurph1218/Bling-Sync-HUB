import crypto from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PoolClient } from 'pg';
import { recalculateCompleteness } from '../catalog/publish-preview.js';
import { env } from '../config/env.js';
import { loadConnectors } from '../connectors/load.js';
import { activeErpConnector } from '../connectors/strategy/factory.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { query, withTransaction } from '../db/pool.js';
import { enqueueProductImagesForSync, normalizeImageUrl } from '../engines/iqre.js';
import { formatNcmDisplay } from '../engines/nve.js';
import { logger } from '../lib/logger.js';
import { isFinalQueueAttempt, JITTERED_BACKOFF, jitteredBackoffStrategy } from './backoff.js';
import { holdQueueForBlingQuota } from './quota-pause.js';
import { recordDeadLetter } from './dead-letters.js';

export const ENRICHMENT_QUEUE_NAME = 'enrichment-queue';
export const ENRICHMENT_BATCH_SIZE = 50;

interface EnrichJob {
  afterErpId: string;
  runToken: string;
}

let queue: Queue<EnrichJob> | null = null;
let worker: Worker<EnrichJob> | null = null;

function redisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

function getEnrichmentQueue(): Queue<EnrichJob> {
  if (!queue) queue = new Queue<EnrichJob>(ENRICHMENT_QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

async function saveImages(client: PoolClient, productId: string, images: string[]): Promise<boolean> {
  const candidates: Array<{ source_url: string; source_platform: 'bling' }> = [];
  let saved = false;
  for (const [index, url] of images.entries()) {
    let normalized: string;
    try {
      normalized = normalizeImageUrl(url);
    } catch {
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform,
         is_cover_eligible, rights_status, position_bling
       ) VALUES ($1, $2, $3, 'bling', false, 'pending', $4)
       ON CONFLICT (master_product_id, url_normalized) DO NOTHING`,
      [productId, url, normalized, index + 1]
    );
    if ((inserted.rowCount ?? 0) > 0) saved = true;
    candidates.push({ source_url: url, source_platform: 'bling' });
  }
  if (candidates.length > 0) await enqueueProductImagesForSync(productId, candidates, client);
  return saved;
}

async function saveNcmAndCategory(client: PoolClient, productId: string, ncm: string, category: string): Promise<boolean> {
  const digits = ncm.replace(/\D/g, '');
  const label = category.trim();
  let saved = false;
  if (digits.length === 8) {
    const updated = await client.query(
      `UPDATE master_products
       SET ncm = $2, ncm_status = 'pending_approval', ncm_fiscal_risk = true, updated_at = now()
       WHERE id = $1
         AND (ncm IS NULL OR trim(ncm) = '')
         AND ncm_status IN ('unknown', 'invalid', 'pending_approval')`,
      [productId, digits]
    );
    saved = (updated.rowCount ?? 0) > 0;
    if (saved) {
      const open = await client.query(
        `SELECT 1 FROM ncm_manual_suggestions
         WHERE master_product_id = $1 AND status IN ('pending_first', 'pending_second')
         LIMIT 1`,
        [productId]
      );
      if (!open.rows[0]) {
        const expiresAt = new Date(Date.now() + 15 * 86_400_000).toISOString();
        await client.query(
          `INSERT INTO ncm_manual_suggestions (
             master_product_id, proposed_ncm, source_platform, status, expires_at
           ) VALUES ($1, $2, 'bling', 'pending_first', $3)`,
          [productId, formatNcmDisplay(digits), expiresAt]
        );
      }
    }
  }
  if (label) {
    const updated = await client.query(
      `UPDATE master_products
       SET category = $2, updated_at = now()
       WHERE id = $1 AND (category IS NULL OR trim(category) = '')`,
      [productId, label]
    );
    saved = saved || (updated.rowCount ?? 0) > 0;
  }
  return saved;
}

/**
 * Lê um lote de produtos sem capa ou sem NCM. A escrita fica no HUB.
 * O cursor evita repetir o mesmo lote quando o ERP não tem o dado.
 */
export async function processEnrichmentBatch(
  erp: ErpConnector,
  afterErpId = ''
): Promise<{ processed: number; enriched: number; nextCursor: string | null }> {
  const rows = await query<{ id: string; erp_id: string }>(
    `SELECT id, erp_id
     FROM master_products
     WHERE catalog_status = 'active'
       AND archived_at IS NULL
       AND trim(erp_id) <> ''
       AND erp_id > $1
       AND (
         ncm IS NULL OR trim(ncm) = ''
         OR (
           id NOT IN (SELECT master_product_id FROM product_images)
           AND id NOT IN (SELECT master_product_id FROM image_processing_queue)
         )
       )
     ORDER BY erp_id ASC
     LIMIT $2`,
    [afterErpId, ENRICHMENT_BATCH_SIZE]
  );
  let enriched = 0;
  const enrichedIds: string[] = [];
  for (const row of rows.rows) {
    try {
      const data = await erp.fetchProductEnrichmentData(row.erp_id);
      const wrote = await withTransaction(async (client) => {
        const imageSaved = data.images.length > 0 ? await saveImages(client, row.id, data.images) : false;
        const ncmSaved = await saveNcmAndCategory(client, row.id, data.ncm, data.category);
        return imageSaved || ncmSaved;
      });
      if (!wrote) continue;
      enriched += 1;
      enrichedIds.push(row.id);
    } catch (error) {
      logger.error('Enriquecimento do produto falhou', {
        erpId: row.erp_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (enrichedIds.length > 0) {
    const scored = await recalculateCompleteness(enrichedIds);
    for (const item of scored) {
      await query(`UPDATE master_products SET worst_score = $2, updated_at = now() WHERE id = $1`, [item.id, item.percent]);
    }
  }
  const last = rows.rows[rows.rows.length - 1]?.erp_id ?? null;
  return {
    processed: rows.rows.length,
    enriched,
    nextCursor: rows.rows.length === ENRICHMENT_BATCH_SIZE ? last : null,
  };
}

async function enqueueBatch(runToken: string, afterErpId: string): Promise<void> {
  const jobId = `enrich-${runToken}-${afterErpId || 'start'}`;
  const existing = await getEnrichmentQueue().getJob(jobId);
  if (existing) return;
  await getEnrichmentQueue().add(
    'batch',
    { afterErpId, runToken },
    { jobId, removeOnComplete: 50, removeOnFail: 20, attempts: 3, backoff: JITTERED_BACKOFF }
  );
}

/** Aceita o pedido e devolve o controle na hora. O worker lê o ERP em lotes de 50. */
export async function enqueueEnrichment(): Promise<{ accepted: true; status: 'processing' }> {
  const enrichment = getEnrichmentQueue();
  const counts = await enrichment.getJobCounts('waiting', 'active', 'delayed');
  const busy = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  if (busy > 0) return { accepted: true, status: 'processing' };
  await enqueueBatch(crypto.randomUUID(), '');
  return { accepted: true, status: 'processing' };
}

export function startEnrichmentWorker(): Worker<EnrichJob> {
  if (worker) return worker;
  worker = new Worker<EnrichJob>(
    ENRICHMENT_QUEUE_NAME,
    async (job, token) => {
      try {
        await loadConnectors();
        const erp = activeErpConnector();
        const report = await processEnrichmentBatch(erp, job.data.afterErpId);
        logger.info('enriquecimento lote', {
          afterErpId: job.data.afterErpId,
          processed: report.processed,
          enriched: report.enriched,
          nextCursor: report.nextCursor,
        });
        if (report.nextCursor) await enqueueBatch(job.data.runToken, report.nextCursor);
      } catch (error) {
        await holdQueueForBlingQuota(job, token, error);
      }
    },
    {
      connection: redisConnection(),
      concurrency: 1,
      lockDuration: 300_000,
      stalledInterval: 120_000,
      settings: { backoffStrategy: jitteredBackoffStrategy },
    }
  );
  worker.on('failed', (job, error) => {
    logger.error('Lote de enriquecimento falhou', { jobId: job?.id, error: error.message });
    if (!isFinalQueueAttempt(job?.attemptsMade, job?.opts.attempts)) return;
    void recordDeadLetter({ queue: ENRICHMENT_QUEUE_NAME, payload: job?.data ?? {}, error: error.message }).catch((recordError: unknown) => {
      logger.error('Não foi possível gravar a carta morta do enriquecimento', {
        error: recordError instanceof Error ? recordError.message : String(recordError),
      });
    });
  });
  return worker;
}
