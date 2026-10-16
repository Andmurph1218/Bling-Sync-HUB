import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS dlm_retention_policies (
  target_table    text PRIMARY KEY,
  retention_days  integer NOT NULL,
  strategy        text NOT NULL CHECK (strategy IN ('batch_delete', 'drop_partition', 'move_to_archive', 'permanent')),
  batch_size      integer NOT NULL DEFAULT 1000,
  is_enabled      boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dlm_job_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text NOT NULL CHECK (job_type IN ('ttl_cleanup', 'partition_maintenance', 'fiscal_archive', 'health_audit')),
  target_table    text NOT NULL,
  rows_affected   bigint NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_detail    text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS dlm_job_runs;
DROP TABLE IF EXISTS dlm_retention_policies;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
