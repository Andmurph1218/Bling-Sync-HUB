import { query } from './pool.js';
import * as m001 from './migrations/1729080000001_identity-and-controls.js';
import * as m002 from './migrations/1729080000002_products-variants-and-axes.js';
import * as m003 from './migrations/1729080000003_platform-links-and-matching.js';
import * as m004 from './migrations/1729080000004_fiscal-overrides-and-archives.js';
import * as m005 from './migrations/1729080000005_enrichment-staging-and-categories.js';
import * as m006 from './migrations/1729080000006_images-and-queues.js';
import * as m007 from './migrations/1729080000007_push-jobs-and-windows.js';
import * as m008 from './migrations/1729080000008_webhooks-watermarks-and-sync-logs.js';
import * as m009 from './migrations/1729080000009_readiness-scores-and-history.js';
import * as m010 from './migrations/1729080000010_dlm-policies-and-runs.js';
import * as m011 from './migrations/1729080000011_indexes.js';
import * as m012 from './migrations/1729080000012_partitions-and-seeds.js';

export interface MigrationStep {
  id: number;
  name: string;
  upSql: string;
  downSql: string;
}

export const ALL_MIGRATIONS: MigrationStep[] = [
  { id: 1, name: '1729080000001_identity-and-controls', upSql: m001.UP_SQL, downSql: m001.DOWN_SQL },
  { id: 2, name: '1729080000002_products-variants-and-axes', upSql: m002.UP_SQL, downSql: m002.DOWN_SQL },
  { id: 3, name: '1729080000003_platform-links-and-matching', upSql: m003.UP_SQL, downSql: m003.DOWN_SQL },
  { id: 4, name: '1729080000004_fiscal-overrides-and-archives', upSql: m004.UP_SQL, downSql: m004.DOWN_SQL },
  { id: 5, name: '1729080000005_enrichment-staging-and-categories', upSql: m005.UP_SQL, downSql: m005.DOWN_SQL },
  { id: 6, name: '1729080000006_images-and-queues', upSql: m006.UP_SQL, downSql: m006.DOWN_SQL },
  { id: 7, name: '1729080000007_push-jobs-and-windows', upSql: m007.UP_SQL, downSql: m007.DOWN_SQL },
  { id: 8, name: '1729080000008_webhooks-watermarks-and-sync-logs', upSql: m008.UP_SQL, downSql: m008.DOWN_SQL },
  { id: 9, name: '1729080000009_readiness-scores-and-history', upSql: m009.UP_SQL, downSql: m009.DOWN_SQL },
  { id: 10, name: '1729080000010_dlm-policies-and-runs', upSql: m010.UP_SQL, downSql: m010.DOWN_SQL },
  { id: 11, name: '1729080000011_indexes', upSql: m011.UP_SQL, downSql: m011.DOWN_SQL },
  { id: 12, name: '1729080000012_partitions-and-seeds', upSql: m012.SEEDS_UP_SQL, downSql: m012.SEEDS_DOWN_SQL },
];

/**
 * Executa as 12 migrations (up) em ordem.
 * Quando stripPartitionClauseForMemDb = true (apenas em testes pg-mem), remove a cláusula
 * declarativa PARTITION BY RANGE (created_at) que o parser do pg-mem não suporta, mantendo
 * intacta a chave primária composta PRIMARY KEY (created_at, id) exigida pelo PostgreSQL 16.
 */
async function ensureMigrationsTable(): Promise<void> {
  const existing = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pgmigrations'`
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }
  await query(`
    CREATE TABLE pgmigrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL UNIQUE,
      run_on timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function runAllMigrationsUp(options?: {
  stripPartitionClauseForMemDb?: boolean;
}): Promise<string[]> {
  await ensureMigrationsTable();

  const applied: string[] = [];
  for (const mig of ALL_MIGRATIONS) {
    const exists = await query<{ name: string }>(
      `SELECT name FROM pgmigrations WHERE name = $1`,
      [mig.name]
    );
    if (exists.rowCount && exists.rowCount > 0) {
      continue;
    }

    const sqlToRun = options?.stripPartitionClauseForMemDb
      ? mig.upSql
          .replace(/\)\s*PARTITION BY RANGE\s*\(created_at\);/g, ');')
          .replace(
            /CHECK\s*\(\s*kit_variant_id\s+IS\s+DISTINCT\s+FROM\s+component_variant_id\s*\)/gi,
            'CHECK (component_variant_id IS NULL OR kit_variant_id <> component_variant_id)'
          )
      : mig.upSql;

    await query(sqlToRun);
    if (mig.id === 1 && !options?.stripPartitionClauseForMemDb) {
      await query(`
        CREATE OR REPLACE FUNCTION forbid_control_changes_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'control_changes is append-only: UPDATE and DELETE are forbidden';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_control_changes_immutable ON control_changes;
        CREATE TRIGGER trg_control_changes_immutable
          BEFORE UPDATE OR DELETE ON control_changes
          FOR EACH ROW EXECUTE FUNCTION forbid_control_changes_mutation();
      `);
    }
    if (mig.id === 4 && !options?.stripPartitionClauseForMemDb) {
      await query(`
        CREATE OR REPLACE FUNCTION forbid_fiscal_archive_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Tabelas de auditoria e arquivo fiscal são imutáveis: UPDATE e DELETE proibidos';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_ncm_audit_immutable ON ncm_audit_log;
        CREATE TRIGGER trg_ncm_audit_immutable
          BEFORE UPDATE OR DELETE ON ncm_audit_log
          FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

        DROP TRIGGER IF EXISTS trg_ncm_archive_immutable ON ncm_audit_log_archive;
        CREATE TRIGGER trg_ncm_archive_immutable
          BEFORE UPDATE OR DELETE ON ncm_audit_log_archive
          FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

        DROP TRIGGER IF EXISTS trg_ean_archive_immutable ON ean_validation_history_archive;
        CREATE TRIGGER trg_ean_archive_immutable
          BEFORE UPDATE OR DELETE ON ean_validation_history_archive
          FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

        DROP TRIGGER IF EXISTS trg_divergence_archive_immutable ON divergence_alerts_archive;
        CREATE TRIGGER trg_divergence_archive_immutable
          BEFORE UPDATE OR DELETE ON divergence_alerts_archive
          FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();
      `);
    }
    if (mig.id === 12 && !options?.stripPartitionClauseForMemDb) {
      const { upSql } = m012.buildMonthlyPartitionsSql(new Date());
      await query(upSql);
    }

    await query(`INSERT INTO pgmigrations (name) VALUES ($1)`, [mig.name]);
    applied.push(mig.name);
  }

  return applied;
}

export async function runAllMigrationsDown(options?: {
  stripPartitionClauseForMemDb?: boolean;
}): Promise<string[]> {
  const reverted: string[] = [];
  const reversed = [...ALL_MIGRATIONS].reverse();

  for (const mig of reversed) {
    const exists = await query<{ name: string }>(
      `SELECT name FROM pgmigrations WHERE name = $1`,
      [mig.name]
    );
    if (!exists.rowCount || exists.rowCount === 0) {
      continue;
    }

    if (mig.id === 12 && !options?.stripPartitionClauseForMemDb) {
      const { downSql } = m012.buildMonthlyPartitionsSql();
      await query(downSql);
    }
    await query(mig.downSql);
    await query(`DELETE FROM pgmigrations WHERE name = $1`, [mig.name]);
    reverted.push(mig.name);
  }

  return reverted;
}
