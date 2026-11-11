import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS marketplace_listings_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  marketplace     text NOT NULL,
  external_id     text NOT NULL,
  payload_json    text NOT NULL DEFAULT '{}',
  last_synced_at  timestamptz NOT NULL DEFAULT now()
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS marketplace_listings_snapshot;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
