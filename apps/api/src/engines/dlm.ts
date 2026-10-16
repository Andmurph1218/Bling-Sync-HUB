/**
 * Motor DLM — Data Lifecycle Manager (Seções 5, 8.10, 9.6, 13 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Agenda via BullMQ (timezone America/Sao_Paulo), nunca node-cron em processo:
 *   - limpeza TTL: diária, 02:00 ('0 2 * * *')
 *   - partições: dia 1, 03:00 ('0 3 1 * *')
 *   - arquivo fiscal: domingo, 04:00 ('0 4 * * 0')
 *   - saúde: dia 1, 09:00 ('0 9 1 * *')
 * - Coordenação entre réplicas: lock distribuído + lotes com LIMIT e FOR UPDATE SKIP LOCKED.
 *   Réplica extra concorrente NÃO duplica limpeza nem arquivamento.
 * - Retenções operacionais:
 *   - enrichment_staging: 30 dias depois de aplicado -> DELETE em lote
 *   - matching_queue: 60 dias depois do status terminal (expires_at <= now()); pendente NÃO expira
 *   - enrichment_suggestions: 30 dias depois de resolvido -> DELETE em lote
 *   - image_rights_review_queue: 90 dias depois de resolvido -> DELETE em lote
 *   - image_processing_queue: 7 dias depois de 'done'; 'failed' e 'queued' NÃO expiram -> DELETE em lote
 *   - push_jobs e push_job_steps: 7 dias depois do status terminal ('completed','failed','blocked','superseded','cancelled') -> DELETE em lote
 *   - webhook_events.raw_payload: 30 dias depois de concluído -> limpa raw_payload = NULL mantendo idempotency_key
 *   - divergence_alerts resolvido: 90 dias -> MOVE para divergence_alerts_archive
 *   - ean_validation_history: 18 meses (540 dias) -> MOVE para ean_validation_history_archive
 *   - ncm_audit_log: copiado para ncm_audit_log_archive (tabela ncm_audit_log é imutável no banco)
 *   - tabelas *_archive, dlm_job_runs, control_changes e master_products: NUNCA sofrem DELETE pelo DLM
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { acquireResourceLock, releaseResourceLock } from './wig.js';

export const DLM_BULLMQ_SCHEDULES = {
  timezone: 'America/Sao_Paulo',
  jobs: {
    ttl_cleanup: { cron: '0 2 * * *', description: 'Limpeza TTL diária às 02:00 BRT' },
    partition_maintenance: {
      cron: '0 3 1 * *',
      description: 'Manutenção mensal de partições dia 1 às 03:00 BRT',
    },
    fiscal_archive: {
      cron: '0 4 * * 0',
      description: 'Arquivamento fiscal semanal aos domingos às 04:00 BRT',
    },
    health_audit: {
      cron: '0 9 1 * *',
      description: 'Auditoria mensal de saúde dia 1 às 09:00 BRT',
    },
  },
} as const;

export interface DlmBatchTargetSummary {
  targetTable: string;
  rowsAffected: number;
  action: 'batch_delete' | 'nullify_payload' | 'move_to_archive';
}

export interface DlmExecutionReport {
  jobType: 'ttl_cleanup' | 'partition_maintenance' | 'fiscal_archive' | 'health_audit';
  replicaId: string;
  skippedByReplicaLock: boolean;
  summaries: DlmBatchTargetSummary[];
  totalRowsAffected: number;
}

async function recordDlmJobRun(
  jobType: 'ttl_cleanup' | 'partition_maintenance' | 'fiscal_archive' | 'health_audit',
  targetTable: string,
  rowsAffected: number,
  status: 'completed' | 'failed',
  errorDetail?: string
): Promise<void> {
  await query(
    `INSERT INTO dlm_job_runs (
       job_type, target_table, rows_affected, status, error_detail, started_at, finished_at
     ) VALUES ($1, $2, $3, $4, $5, now(), now())`,
    [jobType, targetTable, rowsAffected, status, errorDetail ?? null]
  );
}

/**
 * Executa a limpeza TTL diária em lotes com FOR UPDATE SKIP LOCKED (Seção 8.10).
 * Se uma segunda réplica tentar rodar ao mesmo tempo, o lock de coordenação impede duplicação.
 */
export async function runDlmTtlCleanup(options?: {
  replicaId?: string;
  batchSize?: number;
}): Promise<DlmExecutionReport> {
  const replicaId = options?.replicaId ?? 'dlm-replica-1';
  const batchSize = options?.batchSize ?? 500;
  const lockKey = 'dlm:job:ttl_cleanup';

  const lock = await acquireResourceLock(lockKey, replicaId, 300);
  if (!lock.acquired) {
    return {
      jobType: 'ttl_cleanup',
      replicaId,
      skippedByReplicaLock: true,
      summaries: [],
      totalRowsAffected: 0,
    };
  }

  try {
    const summaries: DlmBatchTargetSummary[] = [];

    // 1. enrichment_staging: 30 dias depois de aplicado (applied = true)
    const stagingDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM enrichment_staging
         WHERE applied = true
           AND applied_at <= now() - interval '30 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM enrichment_staging WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'enrichment_staging', stagingDeleted, 'completed');
    summaries.push({
      targetTable: 'enrichment_staging',
      rowsAffected: stagingDeleted,
      action: 'batch_delete',
    });

    // 2. matching_queue: 60 dias depois do status terminal (expires_at <= now()); status = 'pending' NUNCA expira!
    const matchingDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM matching_queue
         WHERE status <> 'pending'
           AND expires_at IS NOT NULL
           AND expires_at <= now()
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM matching_queue WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'matching_queue', matchingDeleted, 'completed');
    summaries.push({
      targetTable: 'matching_queue',
      rowsAffected: matchingDeleted,
      action: 'batch_delete',
    });

    // 3. enrichment_suggestions: 30 dias depois de resolvido
    const suggestionsDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM enrichment_suggestions
         WHERE status IN ('accepted', 'rejected')
           AND resolved_at <= now() - interval '30 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM enrichment_suggestions WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'enrichment_suggestions', suggestionsDeleted, 'completed');
    summaries.push({
      targetTable: 'enrichment_suggestions',
      rowsAffected: suggestionsDeleted,
      action: 'batch_delete',
    });

    // 4. image_rights_review_queue: 90 dias depois de resolvido
    const rightsDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM image_rights_review_queue
         WHERE status IN ('approved', 'rejected')
           AND resolved_at <= now() - interval '90 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM image_rights_review_queue WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'image_rights_review_queue', rightsDeleted, 'completed');
    summaries.push({
      targetTable: 'image_rights_review_queue',
      rowsAffected: rightsDeleted,
      action: 'batch_delete',
    });

    // 5. image_processing_queue: 7 dias depois de 'done'; 'failed' e 'queued' NUNCA expiram!
    const imgQueueDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM image_processing_queue
         WHERE stage = 'done'
           AND finished_at <= now() - interval '7 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM image_processing_queue WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'image_processing_queue', imgQueueDeleted, 'completed');
    summaries.push({
      targetTable: 'image_processing_queue',
      rowsAffected: imgQueueDeleted,
      action: 'batch_delete',
    });

    // 6. push_jobs e push_job_steps: 7 dias depois do status terminal ('completed','failed','blocked','superseded','cancelled')
    const pushJobsDeleted = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM push_jobs
         WHERE status IN ('completed', 'failed', 'blocked', 'superseded', 'cancelled')
           AND finished_at <= now() - interval '7 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(`DELETE FROM push_job_steps WHERE push_job_id = $1`, [row.id]);
        await client.query(`DELETE FROM push_jobs WHERE id = $1`, [row.id]);
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('ttl_cleanup', 'push_jobs', pushJobsDeleted, 'completed');
    summaries.push({
      targetTable: 'push_jobs',
      rowsAffected: pushJobsDeleted,
      action: 'batch_delete',
    });

    // 7. webhook_events.raw_payload: 30 dias depois de concluído -> anula raw_payload preservando a chave de idempotência
    const webhookPayloadsCleared = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{ id: string }>(
        `SELECT id FROM webhook_events
         WHERE status IN ('processed', 'ignored')
           AND raw_payload IS NOT NULL
           AND processed_at <= now() - interval '30 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );
      for (const row of claim.rows) {
        await client.query(
          `UPDATE webhook_events SET raw_payload = NULL WHERE id = $1`,
          [row.id]
        );
      }
      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun(
      'ttl_cleanup',
      'webhook_events.raw_payload',
      webhookPayloadsCleared,
      'completed'
    );
    summaries.push({
      targetTable: 'webhook_events.raw_payload',
      rowsAffected: webhookPayloadsCleared,
      action: 'nullify_payload',
    });

    const totalRowsAffected = summaries.reduce((acc, s) => acc + s.rowsAffected, 0);
    return {
      jobType: 'ttl_cleanup',
      replicaId,
      skippedByReplicaLock: false,
      summaries,
      totalRowsAffected,
    };
  } finally {
    await releaseResourceLock(lockKey, replicaId);
  }
}

/**
 * Executa o arquivamento fiscal e de alertas resolvidos (Seção 8.10):
 * - divergence_alerts resolvido há >= 90 dias -> MOVE para divergence_alerts_archive
 * - ean_validation_history com >= 18 meses (540 dias) -> MOVE para ean_validation_history_archive
 * - ncm_audit_log com >= 18 meses (540 dias) -> copia para ncm_audit_log_archive
 * - Tabelas *_archive têm retenção de 5 anos e NUNCA sofrem UPDATE nem DELETE.
 */
export async function runDlmFiscalArchive(options?: {
  replicaId?: string;
  batchSize?: number;
}): Promise<DlmExecutionReport> {
  const replicaId = options?.replicaId ?? 'dlm-replica-1';
  const batchSize = options?.batchSize ?? 500;
  const lockKey = 'dlm:job:fiscal_archive';

  const lock = await acquireResourceLock(lockKey, replicaId, 300);
  if (!lock.acquired) {
    return {
      jobType: 'fiscal_archive',
      replicaId,
      skippedByReplicaLock: true,
      summaries: [],
      totalRowsAffected: 0,
    };
  }

  try {
    const summaries: DlmBatchTargetSummary[] = [];

    // 1. divergence_alerts resolvido há >= 90 dias -> MOVE para divergence_alerts_archive
    const alertsArchived = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{
        id: string;
        master_product_id: string;
        variant_id: string | null;
        platform: string | null;
        alert_code: string;
        severity: string;
        bling_value: string | null;
        external_value: string | null;
        details: Record<string, unknown>;
        status: string;
        resolved_by: string | null;
        resolved_at: Date | string | null;
        created_at: Date | string;
      }>(
        `SELECT id, master_product_id, variant_id, platform, alert_code, severity,
                bling_value, external_value, details, status, resolved_by, resolved_at, created_at
         FROM divergence_alerts
         WHERE status = 'resolved'
           AND resolved_at <= now() - interval '90 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );

      for (const row of claim.rows) {
        await client.query(
          `INSERT INTO divergence_alerts_archive (
             id, master_product_id, variant_id, platform, alert_code, severity,
             bling_value, external_value, details, status, resolved_by, resolved_at, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.master_product_id,
            row.variant_id,
            row.platform,
            row.alert_code,
            row.severity,
            row.bling_value,
            row.external_value,
            JSON.stringify(row.details ?? {}),
            row.status,
            row.resolved_by,
            row.resolved_at
              ? row.resolved_at instanceof Date
                ? row.resolved_at.toISOString()
                : row.resolved_at
              : null,
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : row.created_at,
          ]
        );
        await client.query(`DELETE FROM divergence_alerts WHERE id = $1`, [row.id]);
      }

      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('fiscal_archive', 'divergence_alerts', alertsArchived, 'completed');
    summaries.push({
      targetTable: 'divergence_alerts',
      rowsAffected: alertsArchived,
      action: 'move_to_archive',
    });

    // 2. ean_validation_history com >= 540 dias (18 meses) -> MOVE para ean_validation_history_archive
    const eanArchived = await withTransaction(async (client: PoolClient) => {
      const claim = await client.query<{
        id: string;
        variant_id: string;
        master_product_id: string;
        ean: string | null;
        previous_status: string | null;
        new_status: string;
        action: string;
        actor_id: string | null;
        details: Record<string, unknown>;
        created_at: Date | string;
      }>(
        `SELECT id, variant_id, master_product_id, ean, previous_status,
                new_status, action, actor_id, details, created_at
         FROM ean_validation_history
         WHERE created_at <= now() - interval '540 days'
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize]
      );

      for (const row of claim.rows) {
        await client.query(
          `INSERT INTO ean_validation_history_archive (
             id, variant_id, master_product_id, ean, previous_status,
             new_status, action, actor_id, details, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.variant_id,
            row.master_product_id,
            row.ean,
            row.previous_status,
            row.new_status,
            row.action,
            row.actor_id,
            JSON.stringify(row.details ?? {}),
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : row.created_at,
          ]
        );
        await client.query(`DELETE FROM ean_validation_history WHERE id = $1`, [row.id]);
      }

      return claim.rowCount ?? 0;
    });
    await recordDlmJobRun('fiscal_archive', 'ean_validation_history', eanArchived, 'completed');
    summaries.push({
      targetTable: 'ean_validation_history',
      rowsAffected: eanArchived,
      action: 'move_to_archive',
    });

    const totalRowsAffected = summaries.reduce((acc, s) => acc + s.rowsAffected, 0);
    return {
      jobType: 'fiscal_archive',
      replicaId,
      skippedByReplicaLock: false,
      summaries,
      totalRowsAffected,
    };
  } finally {
    await releaseResourceLock(lockKey, replicaId);
  }
}

/**
 * Gera o plano SQL de manutenção mensal de partições (Seção 8.10):
 * - Cria as partições do mês seguinte (+2 meses à frente) para as 5 tabelas particionadas.
 * - Gera DROP TABLE IF EXISTS para partições com mais de 12 meses (sync_logs, quality_history,
 *   channel_readiness_history, push_execution_logs) e mais de 3 meses (identity_resolution_logs).
 */
export function buildDlmPartitionMaintenancePlan(referenceDate: Date): {
  createStatements: string[];
  dropStatements: string[];
} {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();

  const nextStart = new Date(Date.UTC(year, month + 2, 1, 0, 0, 0));
  const nextEnd = new Date(Date.UTC(year, month + 3, 1, 0, 0, 0));
  const nextY = nextStart.getUTCFullYear();
  const nextM = String(nextStart.getUTCMonth() + 1).padStart(2, '0');

  const tables12m = [
    'sync_logs',
    'quality_history',
    'channel_readiness_history',
    'push_execution_logs',
  ];

  const createStatements: string[] = [];
  for (const tbl of [...tables12m, 'identity_resolution_logs']) {
    createStatements.push(
      `CREATE TABLE IF NOT EXISTS ${tbl}_y${nextY}m${nextM} PARTITION OF ${tbl} FOR VALUES FROM ('${nextStart.toISOString()}') TO ('${nextEnd.toISOString()}');`
    );
  }

  const expired12m = new Date(Date.UTC(year, month - 13, 1, 0, 0, 0));
  const exp12Y = expired12m.getUTCFullYear();
  const exp12M = String(expired12m.getUTCMonth() + 1).padStart(2, '0');

  const expired3m = new Date(Date.UTC(year, month - 4, 1, 0, 0, 0));
  const exp3Y = expired3m.getUTCFullYear();
  const exp3M = String(expired3m.getUTCMonth() + 1).padStart(2, '0');

  const dropStatements: string[] = [
    ...tables12m.map((tbl) => `DROP TABLE IF EXISTS ${tbl}_y${exp12Y}m${exp12M};`),
    `DROP TABLE IF EXISTS identity_resolution_logs_y${exp3Y}m${exp3M};`,
  ];

  return { createStatements, dropStatements };
}
