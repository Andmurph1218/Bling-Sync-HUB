import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS sync_status (
  id                   smallint PRIMARY KEY DEFAULT 1,
  status               text NOT NULL DEFAULT 'idle'
                         CHECK (status IN ('idle', 'processing', 'completed', 'failed')),
  total                integer NOT NULL DEFAULT 0,
  processed            integer NOT NULL DEFAULT 0,
  page                 integer NOT NULL DEFAULT 1,
  last_completed_page  integer NOT NULL DEFAULT 0,
  run_token            text NOT NULL DEFAULT '',
  error_message        text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_status_singleton CHECK (id = 1)
);

INSERT INTO sync_status (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS sync_status;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
