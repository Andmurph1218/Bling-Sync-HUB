import { query } from '../db/pool.js';
import { replayFailedPushJobById } from '../orchestrator/pipeline.js';

export const PUBLISH_DEAD_LETTER_QUEUE = 'publish-marketplace';

export interface DeadLetter {
  id: string;
  queue: string;
  payload: string;
  error: string;
  attempts: number;
  status: string;
  updated_at: string | Date;
}

const QUEUE_LABEL: Record<string, string> = {
  'publish-marketplace': 'Publicação',
  'enrichment-queue': 'Enriquecimento',
  'erp-sync-queue': 'Sync do ERP',
  push_jobs: 'Envio ao canal',
};

export function deadLetterLabel(queue: string): string {
  return QUEUE_LABEL[queue] ?? queue;
}

export async function recordDeadLetter(input: { queue: string; payload: unknown; error: string }): Promise<void> {
  const payload = JSON.stringify(input.payload ?? {});
  const error = input.error.slice(0, 500);
  const existing = await query<{ id: string }>(
    `SELECT id FROM dead_letters WHERE queue = $1 AND payload = $2 AND status = 'open' LIMIT 1`,
    [input.queue, payload]
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE dead_letters SET attempts = attempts + 1, error = $2, updated_at = now() WHERE id = $1`,
      [existing.rows[0].id, error]
    );
    return;
  }
  await query(
    `INSERT INTO dead_letters (queue, payload, error, attempts) VALUES ($1, $2, $3, 1)`,
    [input.queue, payload, error]
  );
}

export async function listOpenDeadLetters(): Promise<Array<DeadLetter & { label: string }>> {
  const rows = await query<DeadLetter>(
    `SELECT id, queue, payload, error, attempts, status, updated_at
     FROM dead_letters
     WHERE status = 'open'
     ORDER BY updated_at DESC
     LIMIT 50`
  );
  return rows.rows.map((row) => ({
    ...row,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    label: deadLetterLabel(row.queue),
  }));
}

function payloadOf(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function replayDeadLetter(id: string): Promise<{ id: string; queue: string }> {
  const found = await query<DeadLetter>(
    `SELECT id, queue, payload, error, attempts, status, updated_at
     FROM dead_letters WHERE id = $1`,
    [id]
  );
  const letter = found.rows[0];
  if (!letter) throw new Error('Carta morta não encontrada.');
  if (letter.status !== 'open') throw new Error('Esta carta já foi reprocessada.');
  const payload = payloadOf(letter.payload);

  if (letter.queue === PUBLISH_DEAD_LETTER_QUEUE) {
    const publishQueueId = String(payload.publishQueueId ?? '');
    if (!publishQueueId) throw new Error('A carta de publicação não tem o item da fila.');
    await query(
      `UPDATE publish_queue SET status = 'pending', error_message = NULL, updated_at = now() WHERE id = $1`,
      [publishQueueId]
    );
    const { processPublishQueueItem } = await import('./publish-queue.js');
    await processPublishQueueItem(publishQueueId);
  } else if (letter.queue === 'enrichment-queue') {
    const { enqueueEnrichment } = await import('./enrichment-worker.js');
    await enqueueEnrichment();
  } else if (letter.queue === 'erp-sync-queue') {
    const { enqueueErpSync } = await import('./erp-sync-worker.js');
    await enqueueErpSync();
  } else if (letter.queue === 'push_jobs') {
    const pushJobId = String(payload.pushJobId ?? '');
    if (!pushJobId) throw new Error('A carta de envio não tem o job.');
    await replayFailedPushJobById(pushJobId);
  } else {
    throw new Error('Esta fila ainda não tem reprocessamento.');
  }

  await query(`UPDATE dead_letters SET status = 'replayed', updated_at = now() WHERE id = $1`, [id]);
  return { id, queue: letter.queue };
}
