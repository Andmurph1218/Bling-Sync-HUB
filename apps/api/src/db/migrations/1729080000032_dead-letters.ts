import type { MigrationBuilder } from 'node-pg-migrate';

/** Falha esgotada de uma fila. O operador reprocessa o item em Problemas. */
export const UP_SQL = `
CREATE TABLE IF NOT EXISTS dead_letters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue       text NOT NULL,
  payload     text NOT NULL DEFAULT '{}',
  error       text NOT NULL,
  attempts    integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'replayed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dead_letters_open_queue
  ON dead_letters (queue, updated_at DESC)
  WHERE status = 'open';
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS dead_letters_open_queue;
DROP TABLE IF EXISTS dead_letters;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
