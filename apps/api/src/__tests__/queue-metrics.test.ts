import { describe, expect, it } from 'vitest';
import { medianLatencyMs, readQueueSnapshot, syncFailedAlert, SYNC_FAILED_ALERT_MS } from '../queues/metrics.js';

describe('observabilidade das filas', () => {
  const now = Date.parse('2026-11-12T04:00:00Z');

  it('alerta só depois de uma hora com o sync em failed', () => {
    expect(syncFailedAlert({
      status: 'failed',
      updatedAt: new Date(now - SYNC_FAILED_ALERT_MS + 1),
      error: 'timeout',
    }, now)).toBeNull();
    expect(syncFailedAlert({
      status: 'processing',
      updatedAt: new Date(now - 2 * SYNC_FAILED_ALERT_MS),
      error: null,
    }, now)).toBeNull();
    expect(syncFailedAlert({
      status: 'failed',
      updatedAt: new Date(now - SYNC_FAILED_ALERT_MS),
      error: 'timeout do Bling',
    }, now)).toEqual({
      failedForMs: SYNC_FAILED_ALERT_MS,
      message: 'A sincronização do ERP está em falha há 1 hora.',
      error: 'timeout do Bling',
    });
    expect(syncFailedAlert({
      status: 'failed',
      updatedAt: new Date(now - 3 * SYNC_FAILED_ALERT_MS),
      error: null,
    }, now)?.message).toBe('A sincronização do ERP está em falha há 3 horas.');
  });

  it('usa a mediana dos jobs que já terminaram', () => {
    expect(medianLatencyMs([
      { processedOn: 1_000, finishedOn: 1_500 },
      { processedOn: 1_000, finishedOn: 4_000 },
      { processedOn: 1_000, finishedOn: 2_000 },
    ])).toBe(1_000);
    expect(medianLatencyMs([])).toBeNull();
    expect(medianLatencyMs([{ processedOn: 10, finishedOn: 5 }])).toBeNull();
  });

  it('lê aguardando, ativos, falhos e a latência de uma fila', async () => {
    const snapshot = await readQueueSnapshot('erp-sync-queue', 'Sync do ERP', {
      getJobCounts: async () => ({ waiting: 2, active: 1, failed: 4 }),
      getJobs: async () => [{ processedOn: 10, finishedOn: 40 }],
    });
    expect(snapshot).toEqual({
      queue: 'erp-sync-queue',
      label: 'Sync do ERP',
      waiting: 2,
      active: 1,
      failed: 4,
      latencyMs: 30,
      available: true,
    });
  });
});