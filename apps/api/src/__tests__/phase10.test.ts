import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import { acquireResourceLock, releaseResourceLock } from '../engines/wig.js';
import {
  buildDlmPartitionMaintenancePlan,
  DLM_BULLMQ_SCHEDULES,
  runDlmFiscalArchive,
  runDlmTtlCleanup,
} from '../engines/dlm.js';

describe('Fase 10 — Gerenciador de Ciclo de Vida de Dados DLM (Coordenação entre Réplicas, Limpeza TTL sem Expirar Pending/Failed, Arquivo Fiscal 5 Anos e Partições)', () => {
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
    const mem = newDb();

    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.trim() : ''),
    });

    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });

    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);

    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. Critério de saída: Réplica extra concorrente NÃO duplica limpeza nem arquivamento quando outra réplica já detém o lock do job DLM', async () => {
    expect(DLM_BULLMQ_SCHEDULES.timezone).toBe('America/Sao_Paulo');

    // Réplica 1 adquire o lock de ttl_cleanup
    const lock1 = await acquireResourceLock('dlm:job:ttl_cleanup', 'replica-1', 300);
    expect(lock1.acquired).toBe(true);

    // Réplica 2 dispara no mesmo instante -> skippedByReplicaLock = true e 0 linhas tocadas
    const replica2Run = await runDlmTtlCleanup({ replicaId: 'replica-2' });
    expect(replica2Run.skippedByReplicaLock).toBe(true);
    expect(replica2Run.totalRowsAffected).toBe(0);

    await releaseResourceLock('dlm:job:ttl_cleanup', 'replica-1');
  });

  it('2. Limpeza TTL: remove registros terminais vencidos, anula raw_payload de webhook > 30d e PRESERVA matching_queue pendente, image_processing_queue queued/failed, master_products e control_changes', async () => {
    const admin = await createUser({
      email: 'admin_dlm@blingsync.local',
      name: 'Admin DLM',
      password: 'Password!Dlm1',
      roles: ['admin'],
    });

    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('10001', 'PROD-DLM-1', 'Produto Permanente DLM', 'P', 'S')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, 'PROD-DLM-1', true, 'S', 79.90)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    // 1. matching_queue: 1 pendente com 90 dias (NÃO deve expirar!) e 1 matched com expires_at vencido (DEVE apagar!)
    const pItem1 = await query<{ id: string }>(
      `INSERT INTO platform_items (platform, platform_product_id, status)
       VALUES ('mercadolivre', 'MLB-DLM-PEND', 'quarantine')
       RETURNING id`
    );
    const pItem2 = await query<{ id: string }>(
      `INSERT INTO platform_items (platform, platform_product_id, status, master_product_id)
       VALUES ('mercadolivre', 'MLB-DLM-DONE', 'linked', $1)
       RETURNING id`,
      [masterId]
    );

    await query(
      `INSERT INTO matching_queue (platform_item_id, platform_raw_data, status, expires_at, created_at)
       VALUES
         ($1, '{}', 'pending', NULL, now() - interval '90 days'),
         ($2, '{}', 'matched', now() - interval '2 days', now() - interval '65 days')`,
      [pItem1.rows[0]!.id, pItem2.rows[0]!.id]
    );

    // 2. image_processing_queue: 1 'done' há 10 dias (DEVE apagar), 1 'failed' há 30 dias (NÃO deve apagar) e 1 'queued' (NÃO deve apagar)
    await query(
      `INSERT INTO image_processing_queue (
         master_product_id, source_url, url_normalized, source_platform, stage, finished_at
       ) VALUES
         ($1, 'https://org.bling.com.br/done.jpg', 'https://org.bling.com.br/done.jpg', 'bling', 'done', now() - interval '10 days'),
         ($1, 'https://org.bling.com.br/failed.jpg', 'https://org.bling.com.br/failed.jpg', 'bling', 'failed', now() - interval '30 days'),
         ($1, 'https://org.bling.com.br/queued.jpg', 'https://org.bling.com.br/queued.jpg', 'bling', 'queued', NULL)`,
      [masterId]
    );

    // 3. push_jobs: 1 'completed' há 10 dias (DEVE apagar) e 1 'pending' (NÃO deve apagar)
    await query(
      `INSERT INTO push_jobs (master_product_id, variant_id, platform, job_kind, status, finished_at)
       VALUES
         ($1, $2, 'mercadolivre', 'STOCK_PRICE', 'completed', now() - interval '10 days'),
         ($1, $2, 'nuvemshop', 'STOCK_PRICE', 'pending', NULL)`,
      [masterId, variantId]
    );

    // 4. webhook_events: processado há 35 dias -> deve limpar raw_payload = NULL mantendo a linha!
    await query(
      `INSERT INTO webhook_events (
         source, event_type, resource_id, content_hash, idempotency_key,
         raw_payload, status, processed_at
       ) VALUES (
         'bling', 'product.updated', '10001', $1, 'bling:product.updated:10001:dlmtest',
         '{"secret":"old_payload"}', 'processed', now() - interval '35 days'
       )`,
      ['a'.repeat(64)]
    );

    // 5. control_changes permanente
    await query(
      `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by, changed_at)
       VALUES ('stock_warehouse', '9001', 'include_in_push', 'false', 'true', 'admin', $1, now() - interval '500 days')`,
      [admin.id]
    );

    const ttlReport = await runDlmTtlCleanup({ replicaId: 'replica-primary' });
    expect(ttlReport.skippedByReplicaLock).toBe(false);
    expect(ttlReport.totalRowsAffected).toBeGreaterThanOrEqual(4);

    // Verifica que matching_queue pendente sobreviveu e a expirada foi removida
    const mqLeft = await query<{ status: string }>(
      `SELECT status FROM matching_queue`
    );
    expect(mqLeft.rows).toEqual([{ status: 'pending' }]);

    // Verifica que image_processing_queue manteve 'failed' e 'queued', removendo apenas 'done'
    const iqLeft = await query<{ stage: string }>(
      `SELECT stage FROM image_processing_queue WHERE master_product_id = $1 ORDER BY stage ASC`,
      [masterId]
    );
    expect(iqLeft.rows).toEqual([{ stage: 'failed' }, { stage: 'queued' }]);

    // Verifica que push_jobs manteve apenas o 'pending'
    const pjLeft = await query<{ status: string }>(
      `SELECT status FROM push_jobs WHERE master_product_id = $1`,
      [masterId]
    );
    expect(pjLeft.rows).toEqual([{ status: 'pending' }]);

    // Verifica que webhook_events manteve a linha e idempotency_key, mas limpou raw_payload = NULL
    const whCheck = await query<{ idempotency_key: string; raw_payload: unknown }>(
      `SELECT idempotency_key, raw_payload
       FROM webhook_events
       WHERE idempotency_key = 'bling:product.updated:10001:dlmtest'`
    );
    expect(whCheck.rows).toEqual([
      {
        idempotency_key: 'bling:product.updated:10001:dlmtest',
        raw_payload: null,
      },
    ]);

    // Verifica que control_changes e dlm_job_runs estão intactos
    const ccCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM control_changes WHERE target_key = '9001'`
    );
    expect(ccCount.rows[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it('3. Arquivamento fiscal (MOVE para *_archive) e plano de manutenção de partições (12m e 3m)', async () => {
    const prodRes = await query<{ id: string }>(
      `SELECT id FROM master_products WHERE bling_id = '10001'`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `SELECT id FROM product_variants WHERE master_product_id = $1`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    // Alerta resolvido há 95 dias (>= 90d) -> deve ser movido para divergence_alerts_archive
    await query(
      `INSERT INTO divergence_alerts (
         master_product_id, variant_id, platform, alert_code, severity,
         status, resolved_at, created_at
       ) VALUES ($1, $2, 'mercadolivre', 'price_below_cost', 'critical', 'resolved', now() - interval '95 days', now() - interval '100 days')`,
      [masterId, variantId]
    );

    // Histórico de EAN com 600 dias (>= 540d / 18m) -> deve ser movido para ean_validation_history_archive
    await query(
      `INSERT INTO ean_validation_history (
         variant_id, master_product_id, ean, previous_status, new_status, action, created_at
       ) VALUES ($1, $2, '7891234567895', 'unknown', 'valid', 'gve_evaluate', now() - interval '600 days')`,
      [variantId, masterId]
    );

    const archiveReport = await runDlmFiscalArchive({ replicaId: 'replica-archive' });
    expect(archiveReport.skippedByReplicaLock).toBe(false);
    expect(archiveReport.totalRowsAffected).toBe(2);

    const alertsOperational = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM divergence_alerts WHERE master_product_id = $1`,
      [masterId]
    );
    const alertsInArchive = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM divergence_alerts_archive WHERE master_product_id = $1`,
      [masterId]
    );
    expect(alertsOperational.rows[0]?.count).toBe(0);
    expect(alertsInArchive.rows[0]?.count).toBe(1);

    const eanOperational = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_validation_history WHERE master_product_id = $1`,
      [masterId]
    );
    const eanInArchive = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_validation_history_archive WHERE master_product_id = $1`,
      [masterId]
    );
    expect(eanOperational.rows[0]?.count).toBe(0);
    expect(eanInArchive.rows[0]?.count).toBe(1);

    // Valida plano de manutenção de partições (5 CREATE para o mês seguinte e 5 DROP para as expiradas de 12m/3m)
    const partPlan = buildDlmPartitionMaintenancePlan(new Date('2026-10-01T03:00:00Z'));
    expect(partPlan.createStatements).toHaveLength(5);
    expect(partPlan.dropStatements).toHaveLength(5);
    expect(partPlan.dropStatements).toContain(
      'DROP TABLE IF EXISTS identity_resolution_logs_y2026m06;'
    );
    expect(partPlan.dropStatements).toContain(
      'DROP TABLE IF EXISTS sync_logs_y2025m09;'
    );
  });
});
