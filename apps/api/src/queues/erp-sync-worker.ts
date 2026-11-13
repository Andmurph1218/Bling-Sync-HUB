import crypto from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { FullSyncHooks, runFullCatalogSync } from '../catalog/full-sync.js';
import { env } from '../config/env.js';
import { loadConnectors } from '../connectors/load.js';
import { createErpConnector } from '../connectors/strategy/factory.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { detectDuplicates } from '../services/duplicate-detector.service.js';

export const ERP_SYNC_QUEUE_NAME = 'erp-sync-queue';
export const ERP_SYNC_PAGE_SIZE = 50;
export const ERP_SYNC_DELAY_MS = 450;

export interface ErpSyncStatus {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  page: number;
  lastCompletedPage: number;
  runToken: string;
  errorMessage: string | null;
}

interface SyncRow {
  status: ErpSyncStatus['status'];
  total: number;
  processed: number;
  page: number;
  last_completed_page: number;
  run_token: string;
  error_message: string | null;
}

interface PageJob {
  page: number;
  runToken: string;
}

let queue: Queue<PageJob> | null = null;
let worker: Worker<PageJob> | null = null;

function redisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

function getErpSyncQueue(): Queue<PageJob> {
  if (!queue) queue = new Queue<PageJob>(ERP_SYNC_QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

function present(row: SyncRow): ErpSyncStatus {
  return {
    status: row.status,
    total: Number(row.total) || 0,
    processed: Number(row.processed) || 0,
    page: Number(row.page) || 1,
    lastCompletedPage: Number(row.last_completed_page) || 0,
    runToken: row.run_token ?? '',
    errorMessage: row.error_message,
  };
}

export async function readErpSyncStatus(): Promise<ErpSyncStatus> {
  const found = await query<SyncRow>(
    `SELECT status, total, processed, page, last_completed_page, run_token, error_message
     FROM sync_status WHERE id = 1`
  );
  const row = found.rows[0];
  if (!row) {
    return {
      status: 'idle',
      total: 0,
      processed: 0,
      page: 1,
      lastCompletedPage: 0,
      runToken: '',
      errorMessage: null,
    };
  }
  return present(row);
}

async function enqueuePage(runToken: string, page: number): Promise<void> {
  if (process.env.VITEST === 'true') return;
  const jobId = `erp-sync-${runToken}-page-${page}`;
  const existing = await getErpSyncQueue().getJob(jobId);
  if (existing) return;
  await getErpSyncQueue().add(
    'page',
    { page, runToken },
    { jobId, removeOnComplete: 200, removeOnFail: 50, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } }
  );
}

/** Aceita o pedido e devolve o controle na hora. O worker puxa o catálogo em páginas. */
export async function enqueueErpSync(): Promise<{ accepted: true; status: 'processing' }> {
  const current = await readErpSyncStatus();
  if (current.status === 'processing') {
    await enqueuePage(current.runToken, Math.max(1, current.lastCompletedPage + 1));
    return { accepted: true, status: 'processing' };
  }
  const resume = current.status === 'failed' && current.lastCompletedPage > 0;
  const token = resume && current.runToken ? current.runToken : crypto.randomUUID();
  const page = resume ? current.lastCompletedPage + 1 : 1;
  if (resume) {
    await query(
      `UPDATE sync_status
       SET status = 'processing', page = $2, run_token = $1, error_message = NULL, updated_at = now()
       WHERE id = 1`,
      [token, page]
    );
  } else {
    await query(
      `UPDATE sync_status
       SET status = 'processing', total = 0, processed = 0, page = 1, last_completed_page = 0,
           run_token = $1, error_message = NULL, updated_at = now()
       WHERE id = 1`,
      [token]
    );
  }
  await enqueuePage(token, page);
  return { accepted: true, status: 'processing' };
}

/**
 * Processa uma página e grava o checkpoint. Se o processo cair no meio,
 * a mesma página roda de novo; a página anterior não é recontada.
 */
export async function processErpSyncPage(
  erp: ErpConnector,
  page: number,
  options: { pageSize?: number; delayMs?: number; runToken?: string; hooks?: FullSyncHooks; throwOnPageFailure?: boolean } = {}
): Promise<void> {
  const current = await readErpSyncStatus();
  if (options.runToken && current.runToken && options.runToken !== current.runToken) return;
  if (current.lastCompletedPage >= page) {
    if (current.status !== 'completed') await enqueuePage(current.runToken, page + 1);
    return;
  }
  await query(
    `UPDATE sync_status SET status = 'processing', page = $1, updated_at = now() WHERE id = 1`,
    [page]
  );
  const report = await runFullCatalogSync(erp, {
    ...options.hooks,
    pageSize: options.pageSize ?? ERP_SYNC_PAGE_SIZE,
    startPage: page,
    maxPages: 1,
    delayMs: options.delayMs ?? 0,
    skipExisting: options.hooks?.skipExisting ?? true,
  });
  const catalog = await query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM master_products
     WHERE catalog_status = 'active' AND archived_at IS NULL`
  );
  const catalogActive = Number(catalog.rows[0]?.total ?? 0);
  const parentsOnPage = report.upserted + report.skippedExisting;
  logger.info('erp-sync página', {
    page,
    stopReason: report.stopReason,
    status: report.status,
    idsNaPagina: report.seen,
    pais: parentsOnPage,
    gravados: report.upserted,
    jaExistiam: report.skippedExisting,
    variacoesIgnoradas: report.skippedChild,
    variacoesArquivadas: report.archivedVariations,
    servicosIgnorados: report.skippedService,
    semPayload: report.skippedMissing,
    estoqueAtualizado: report.stockUpdated,
    falhas: report.failed,
    erros: report.errors,
    catalogoAtivo: catalogActive,
    totalInformadoPeloErp: report.catalogTotal,
  });
  if (report.status === 'failed') {
    const failureMsg = report.errors[report.errors.length - 1] ?? 'Falha ao ler o ERP.';
    logger.error('erp-sync paginação interrompida por erro', {
      page,
      stopReason: report.stopReason,
      erros: report.errors,
    });
    if (options.throwOnPageFailure) {
      throw new Error(failureMsg);
    }
    await query(
      `UPDATE sync_status SET status = 'failed', error_message = $1, updated_at = now() WHERE id = 1`,
      [failureMsg]
    );
    return;
  }
  const latest = await readErpSyncStatus();
  if (latest.lastCompletedPage >= page) return;
  const processed = latest.processed + parentsOnPage;
  const total = report.catalogTotal && report.catalogTotal > 0
    ? report.catalogTotal
    : report.catalogDone
      ? processed
      : Math.max(latest.total, processed);
  if (report.catalogDone) {
    logger.info('erp-sync contagem final', {
      stopReason: report.stopReason,
      paisNoErp: processed,
      catalogoAtivo: catalogActive,
      diferenca: catalogActive - processed,
      leitura: report.stopReason === 'pagina_vazia' || report.stopReason === 'ultima_pagina_curta'
        ? 'A lista do ERP terminou nesta página. A diferença são produtos do HUB que não voltaram na lista, como variação arquivada ou cadastro criado aqui.'
        : 'A lista parou antes do fim. Veja o motivo em stopReason.',
    });
  }
  await query(
    `UPDATE sync_status
     SET processed = $1, total = $2, last_completed_page = $3, page = $4,
         status = $5, updated_at = now()
     WHERE id = 1 AND last_completed_page < $3`,
    [processed, total, page, report.catalogDone ? page : page + 1, report.catalogDone ? 'completed' : 'processing']
  );
  if (!report.catalogDone) {
    await enqueuePage(latest.runToken, page + 1);
    return;
  }
  if (process.env.VITEST === 'true') return;
  void detectDuplicates().catch((error: unknown) => {
    logger.error('Detector de duplicidade falhou depois da sync', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function startErpSyncWorker(): Worker<PageJob> {
  if (worker) return worker;
  worker = new Worker<PageJob>(
    ERP_SYNC_QUEUE_NAME,
    async (job) => {
      await loadConnectors();
      const erp = createErpConnector('bling');
      const maxAttempts = job.opts.attempts ?? 1;
      const hasRetriesLeft = job.attemptsMade + 1 < maxAttempts;
      await processErpSyncPage(erp, job.data.page, {
        pageSize: ERP_SYNC_PAGE_SIZE,
        delayMs: ERP_SYNC_DELAY_MS,
        runToken: job.data.runToken,
        throwOnPageFailure: hasRetriesLeft,
      });
    },
    { connection: redisConnection(), concurrency: 1 }
  );
  worker.on('failed', (job, error) => {
    logger.error('Página da sync do ERP falhou', { jobId: job?.id, error: error.message });
  });
  void readErpSyncStatus()
    .then(async (current) => {
      if (current.status === 'processing' && current.runToken) {
        await enqueuePage(current.runToken, Math.max(1, current.lastCompletedPage + 1));
      }
    })
    .catch(() => undefined);
  return worker;
}
