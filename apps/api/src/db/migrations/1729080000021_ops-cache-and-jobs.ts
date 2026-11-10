import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
ALTER TABLE master_products
  ADD COLUMN IF NOT EXISTS worst_score smallint,
  ADD COLUMN IF NOT EXISTS has_fiscal_risk boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  file_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  rows_processed integer NOT NULL DEFAULT 0,
  rows_error integer NOT NULL DEFAULT 0,
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  rows_error integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS batch_jobs;
DROP TABLE IF EXISTS import_jobs;
ALTER TABLE master_products
  DROP COLUMN IF EXISTS needs_review,
  DROP COLUMN IF EXISTS has_fiscal_risk,
  DROP COLUMN IF EXISTS worst_score;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
