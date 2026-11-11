import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS duplicate_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  conflict_type  text NOT NULL CHECK (conflict_type IN ('erp_sku', 'erp_ean', 'marketplace')),
  marketplace    text,
  external_id    text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

CREATE INDEX IF NOT EXISTS duplicate_alerts_open_product
  ON duplicate_alerts (product_id, status);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS duplicate_alerts;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
