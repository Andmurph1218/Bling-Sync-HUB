import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { importCatalogWorkbook, openImportSheet, shouldRunImportInBackground } from './spreadsheet.js';

interface ImportPayload {
  id: string;
}

const files = new Map<string, Buffer>();
let queue: Queue<ImportPayload> | null = null;
let workerStarted = false;

function connection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

function getQueue(): Queue<ImportPayload> {
  if (!queue) queue = new Queue<ImportPayload>('catalog-import', { connection: connection() });
  return queue;
}

export function startImportWorker(): void {
  if (workerStarted || process.env.VITEST) return;
  workerStarted = true;
  const worker = new Worker<ImportPayload>('catalog-import', async (job) => runImportJob(job.data.id), {
    connection: connection(),
  });
  worker.on('failed', () => undefined);
}

async function insertJob(
  userId: string | null,
  fileName: string,
  status: 'running' | 'done' | 'failed',
  total: number,
  processed: number,
  rowsError: number,
  errors: unknown[]
): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO import_jobs (user_id, file_name, status, total, rows_processed, rows_error, error_log, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CASE WHEN $3 = 'running' THEN NULL ELSE now() END)
     RETURNING id`,
    [userId, fileName, status, total, processed, rowsError, JSON.stringify(errors)]
  );
  return inserted.rows[0]!.id;
}

export async function runImportJob(id: string): Promise<void> {
  const file = files.get(id);
  if (!file) {
    await query(
      `UPDATE import_jobs SET status = 'failed', finished_at = now(), error_log = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify([{ line: 1, sku: '', status: 'erro', message: 'Arquivo da importação não está mais disponível.' }])]
    );
    return;
  }
  try {
    const report = await importCatalogWorkbook(file, {
      onProgress: async (processed, errors) => {
        await query(`UPDATE import_jobs SET rows_processed = $2, rows_error = $3 WHERE id = $1`, [id, processed, errors]);
      },
    });
    const errors = report.lines.filter((line) => line.status === 'erro');
    const failed = report.lines.length === 1 && report.lines[0]?.line === 1 && errors.length === 1;
    await query(
      `UPDATE import_jobs
       SET status = $2, rows_processed = $3, rows_error = $4, error_log = $5::jsonb, finished_at = now()
       WHERE id = $1`,
      [id, failed ? 'failed' : 'done', report.lines.length, errors.length, JSON.stringify(errors)]
    );
  } catch (error) {
    await query(
      `UPDATE import_jobs SET status = 'failed', finished_at = now(), error_log = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify([{ line: 1, sku: '', status: 'erro', message: error instanceof Error ? error.message : 'Falha na importação.' }])]
    );
  } finally {
    files.delete(id);
  }
}

export async function acceptCatalogImport(input: {
  userId: string | null;
  fileName: string;
  file: Buffer;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const fileName = input.fileName.trim() || 'catalogo.xlsx';
  const sheet = await openImportSheet(input.file);
  const total = sheet ? Math.max(sheet.rowCount - 1, 0) : 0;
  if (!shouldRunImportInBackground(total)) {
    const report = await importCatalogWorkbook(input.file);
    const errors = report.lines.filter((line) => line.status === 'erro');
    const failed = report.lines.length === 1 && errors.length === 1 && report.lines[0]?.line === 1;
    const jobId = await insertJob(input.userId, fileName, failed ? 'failed' : 'done', total, report.lines.length, errors.length, errors);
    return { status: 200, body: { ...report, jobId } };
  }
  const jobId = await insertJob(input.userId, fileName, 'running', total, 0, 0, []);
  files.set(jobId, input.file);
  try {
    await getQueue().add('run', { id: jobId }, { jobId });
  } catch {
    await runImportJob(jobId);
  }
  return { status: 202, body: { jobId, total, queued: true } };
}

export function buildImportErrorCsv(errors: Array<{ sku?: string; message?: string; cells?: Record<string, string> }>): string {
  const keys = [...new Set(errors.flatMap((row) => Object.keys(row.cells ?? {})))];
  const header = [...(keys.length > 0 ? keys : ['sku']), 'Motivo do Erro'];
  const cell = (value: string) => (/[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [header.join(';')];
  for (const row of errors) {
    const values = keys.length > 0 ? keys.map((key) => row.cells?.[key] ?? '') : [row.sku ?? ''];
    lines.push([...values, row.message ?? ''].map(cell).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
