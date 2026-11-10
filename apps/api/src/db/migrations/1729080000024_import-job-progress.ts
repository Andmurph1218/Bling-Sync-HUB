import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;
`;

export const DOWN_SQL = `
ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS finished_at,
  DROP COLUMN IF EXISTS total;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
