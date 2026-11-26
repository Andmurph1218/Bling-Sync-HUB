import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
ALTER TABLE master_products ADD COLUMN erp_provider text NOT NULL DEFAULT 'bling';
ALTER TABLE master_products ADD COLUMN erp_category_id text;
CREATE INDEX master_products_erp_category ON master_products (erp_provider, erp_category_id);
CREATE TABLE erp_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_provider text NOT NULL,
  erp_category_id text NOT NULL,
  channel text NOT NULL,
  channel_category_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (erp_provider, erp_category_id, channel)
);
CREATE TABLE erp_category_syncs (
  erp_provider text PRIMARY KEY,
  last_synced_at timestamptz
);
ALTER TABLE divergence_alerts ADD COLUMN type text;
CREATE UNIQUE INDEX divergence_alerts_category_identity ON divergence_alerts (master_product_id, platform, type);
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS divergence_alerts_category_identity;
ALTER TABLE divergence_alerts DROP COLUMN IF EXISTS type;
DROP TABLE IF EXISTS erp_category_syncs;
DROP TABLE IF EXISTS erp_category_mappings;
ALTER TABLE master_products DROP COLUMN IF EXISTS erp_category_id;
ALTER TABLE master_products DROP COLUMN IF EXISTS erp_provider;
`;
export const shorthands = {};
export function up(pgm: MigrationBuilder): void { pgm.sql(UP_SQL); }
export function down(pgm: MigrationBuilder): void { pgm.sql(DOWN_SQL); }
