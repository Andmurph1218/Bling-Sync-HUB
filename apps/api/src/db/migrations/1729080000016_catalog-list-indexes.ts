import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Índices da listagem do catálogo.
 * SKU já tem o índice único parcial master_products_bling_sku_nonempty_key (migration 13).
 * catalog_status já tem idx_master_products_catalog_status (migration 11).
 */
export const UP_SQL = `
CREATE INDEX IF NOT EXISTS master_products_catalog_archived
  ON master_products (catalog_status, archived_at);

CREATE INDEX IF NOT EXISTS master_products_hub_category_id
  ON master_products (hub_category_id);

CREATE INDEX IF NOT EXISTS hub_categories_parent_id
  ON hub_categories (parent_id);

CREATE INDEX IF NOT EXISTS channel_attribute_maps_category_map
  ON channel_attribute_maps (channel_category_map_id);

CREATE INDEX IF NOT EXISTS product_images_cover_lookup
  ON product_images (master_product_id)
  WHERE is_cover_eligible = true;
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS product_images_cover_lookup;
DROP INDEX IF EXISTS channel_attribute_maps_category_map;
DROP INDEX IF EXISTS hub_categories_parent_id;
DROP INDEX IF EXISTS master_products_hub_category_id;
DROP INDEX IF EXISTS master_products_catalog_archived;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
