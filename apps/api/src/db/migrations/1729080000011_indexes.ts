import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE INDEX IF NOT EXISTS idx_master_products_catalog_status
  ON master_products (catalog_status);

CREATE INDEX IF NOT EXISTS idx_master_products_ncm_status
  ON master_products (ncm_status);

CREATE INDEX IF NOT EXISTS idx_product_variants_master_product_id
  ON product_variants (master_product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_ean
  ON product_variants (ean);

CREATE INDEX IF NOT EXISTS idx_platform_links_master_product
  ON platform_links (master_product_id, platform);

CREATE INDEX IF NOT EXISTS idx_platform_links_family_id
  ON platform_links (family_id);

CREATE INDEX IF NOT EXISTS idx_platform_variant_links_variant
  ON platform_variant_links (variant_id, platform);

CREATE INDEX IF NOT EXISTS idx_platform_variant_links_user_product
  ON platform_variant_links (user_product_id);

CREATE INDEX IF NOT EXISTS idx_matching_queue_status_expires
  ON matching_queue (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ean_pending_status_expires
  ON ean_pending_validation (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ncm_suggestions_status_expires
  ON ncm_manual_suggestions (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_divergence_alerts_open
  ON divergence_alerts (master_product_id, status);

CREATE INDEX IF NOT EXISTS idx_push_jobs_status_priority
  ON push_jobs (status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_created
  ON webhook_events (status, created_at);

CREATE INDEX IF NOT EXISTS idx_hub_writes_bling_id_written
  ON hub_writes (bling_id, written_at);
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS idx_hub_writes_bling_id_written;
DROP INDEX IF EXISTS idx_webhook_events_status_created;
DROP INDEX IF EXISTS idx_push_jobs_status_priority;
DROP INDEX IF EXISTS idx_divergence_alerts_open;
DROP INDEX IF EXISTS idx_ncm_suggestions_status_expires;
DROP INDEX IF EXISTS idx_ean_pending_status_expires;
DROP INDEX IF EXISTS idx_matching_queue_status_expires;
DROP INDEX IF EXISTS idx_platform_variant_links_user_product;
DROP INDEX IF EXISTS idx_platform_variant_links_variant;
DROP INDEX IF EXISTS idx_platform_links_family_id;
DROP INDEX IF EXISTS idx_platform_links_master_product;
DROP INDEX IF EXISTS idx_product_variants_ean;
DROP INDEX IF EXISTS idx_product_variants_master_product_id;
DROP INDEX IF EXISTS idx_master_products_ncm_status;
DROP INDEX IF EXISTS idx_master_products_catalog_status;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
