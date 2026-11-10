import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS problem_dismissals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL CHECK (source IN ('completude', 'publish_queue')),
  code          text NOT NULL,
  ref_id        uuid NOT NULL,
  dismissed_by  uuid REFERENCES users(id),
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, code, ref_id)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS problem_dismissals;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
