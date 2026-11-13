import { JobType, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { releaseStuckPublishJobs, StuckPublishJob } from './stuck-publish.js';

export const SYNC_FAILED_ALERT_MS = 60 * 60 * 1000;

export const OBSERVED_QUEUES = [
  { name: 'erp-sync-queue', label: 'Sync do ERP' },
  { name: 'enrichment-queue', label: 'Enriquecimento' },
  { name: 'publish-marketplace', label: 'Publicação' },
  { name: 'catalog-import', label: 'Importação' },
  { name: 'catalog-batch', label: 'Lote do catálogo' },
] as const;

export interface QueueMetric {
  queue: string;
  label: string;
  waiting: number;
  active: number;
  failed: number;
  latencyMs: number | null;
  available: boolean;
}

export interface SyncFailedAlert {
  failedForMs: number;
  message: string;
  error: string | null;
}

export interface QueueObservability {
  queues: QueueMetric[];
  syncAlert: SyncFailedAlert | null;
  stuckPublishes: StuckPublishJob[];
}

interface JobTiming {
  processedOn?: number | null;
  finishedOn?: number | null;
}

interface QueueProbe {
  getJobCounts(...types: JobType[]): Promise<Record<string, number>>;
  getJobs(types?: JobType | JobType[], start?: number, end?: number, asc?: boolean): Promise<JobTiming[]>;
}

let connection: Redis | null = null;
const probes = new Map<string, Queue>();

export function medianLatencyMs(samples: JobTiming[]): number | null {
  const values = samples
    .map((sample) => {
      const started = sample.processedOn;
      const finished = sample.finishedOn;
      if (started == null || finished == null || finished < started) return null;
      return finished - started;
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;
  return values[Math.floor((values.length - 1) / 2)] ?? null;
}

function failedForLabel(ms: number): string {
  const hours = Math.max(1, Math.floor(ms / SYNC_FAILED_ALERT_MS));
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

/** Alerta só quando o sync permanece failed por pelo menos uma hora. */
export function syncFailedAlert(
  row: { status: string; updatedAt: Date | string | null; error: string | null },
  now = Date.now()
): SyncFailedAlert | null {
  if (row.status !== 'failed' || row.updatedAt == null) return null;
  const updated = row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(row.updatedAt);
  if (!Number.isFinite(updated)) return null;
  const failedForMs = now - updated;
  if (failedForMs < SYNC_FAILED_ALERT_MS) return null;
  return {
    failedForMs,
    message: `A sincronização do ERP está em falha há ${failedForLabel(failedForMs)}.`,
    error: row.error,
  };
}

export async function readQueueSnapshot(name: string, label: string, probe: QueueProbe): Promise<QueueMetric> {
  const counts = await probe.getJobCounts('waiting', 'active', 'failed');
  const recent = await probe.getJobs(['completed', 'failed'], 0, 19);
  return {
    queue: name,
    label,
    waiting: Number(counts.waiting) || 0,
    active: Number(counts.active) || 0,
    failed: Number(counts.failed) || 0,
    latencyMs: medianLatencyMs(recent),
    available: true,
  };
}

function unavailable(name: string, label: string): QueueMetric {
  return { queue: name, label, waiting: 0, active: 0, failed: 0, latencyMs: null, available: false };
}

function queueProbe(name: string): Queue {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  }
  const existing = probes.get(name);
  if (existing) return existing;
  const created = new Queue(name, { connection });
  probes.set(name, created);
  return created;
}

export async function collectQueueObservability(now = Date.now()): Promise<QueueObservability> {
  const sync = await query<{ status: string; error_message: string | null; updated_at: Date }>(
    `SELECT status, error_message, updated_at FROM sync_status WHERE id = 1`
  );
  const row = sync.rows[0];
  const syncAlert = syncFailedAlert({
    status: row?.status ?? 'idle',
    updatedAt: row?.updated_at ?? null,
    error: row?.error_message ?? null,
  }, now);
  if (syncAlert) {
    logger.warn('Sync do ERP em falha há mais de 1 hora', { failedForMs: syncAlert.failedForMs });
  }
  const queues = await Promise.all(OBSERVED_QUEUES.map(async (item) => {
    try {
      return await readQueueSnapshot(item.name, item.label, queueProbe(item.name));
    } catch (error) {
      logger.warn('Métrica da fila indisponível', {
        queue: item.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return unavailable(item.name, item.label);
    }
  }));
  const stuckPublishes = await releaseStuckPublishJobs(now).catch((error: unknown) => {
    logger.warn('Detector de envios travados indisponível', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  });
  return { queues, syncAlert, stuckPublishes };
}
