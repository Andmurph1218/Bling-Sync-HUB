import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export const STUCK_PUBLISH_MS = 15 * 60 * 1000;
export const STUCK_PUBLISH_MESSAGE = 'Envio travado em processamento por mais de 15 minutos.';

export interface StuckPublishJob {
  id: string;
  sku: string;
  channel: string;
  stuckForMs: number;
}

interface ProcessingRow {
  id: string;
  sku: string | null;
  channel: string;
  updated_at: Date | string;
}

export function isStuckPublish(status: string, updatedAt: Date | string | null, now = Date.now()): boolean {
  if (status !== 'processing' || updatedAt == null) return false;
  const updated = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return false;
  return now - updated >= STUCK_PUBLISH_MS;
}

function placeholders(count: number, start = 1): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(', ');
}

/** Marca como falha o envio que ficou em processing além de 15 minutos. */
export async function releaseStuckPublishJobs(now = Date.now()): Promise<StuckPublishJob[]> {
  const found = await query<ProcessingRow>(
    `SELECT q.id, q.channel, q.updated_at, mp.erp_sku AS sku
     FROM publish_queue q
     JOIN master_products mp ON mp.id = q.product_id
     WHERE q.status = 'processing'`
  );
  const stuck = found.rows.flatMap((row) => {
    if (!isStuckPublish('processing', row.updated_at, now)) return [];
    const updated = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row.updated_at));
    return [{
      id: row.id,
      sku: row.sku ?? '',
      channel: row.channel,
      stuckForMs: now - updated,
    }];
  });
  if (stuck.length === 0) return [];
  const released = await query<{ id: string }>(
    `UPDATE publish_queue
     SET status = 'failed', error_message = $1, updated_at = now()
     WHERE status = 'processing' AND id IN (${placeholders(stuck.length, 2)})
     RETURNING id`,
    [STUCK_PUBLISH_MESSAGE, ...stuck.map((job) => job.id)]
  );
  const releasedIds = new Set(released.rows.map((row) => row.id));
  const jobs = stuck.filter((job) => releasedIds.has(job.id));
  if (jobs.length > 0) {
    logger.warn('Envios travados em processamento foram marcados como falha', {
      count: jobs.length,
      ids: jobs.map((job) => job.id),
    });
  }
  return jobs;
}

export function startStuckPublishDetector(): void {
  const run = () => {
    void releaseStuckPublishJobs().catch((error: unknown) => {
      logger.error('Detector de envios travados falhou', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  run();
  setInterval(run, 60_000);
}
