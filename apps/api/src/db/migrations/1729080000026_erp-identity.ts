import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_bling_formato_check;
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_constraint_3;
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_bling_id_key;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_bling_formato_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_ean_status_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_variant_status_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_stock_mode_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_stock_values_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_constraint_1;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_constraint_2;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_constraint_3;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_constraint_4;
DROP INDEX IF EXISTS master_products_bling_sku_nonempty_key;
DROP INDEX IF EXISTS product_variants_product_sku_key;
DROP INDEX IF EXISTS idx_hub_writes_bling_id_written;

ALTER TABLE master_products RENAME COLUMN bling_id TO erp_id;
ALTER TABLE master_products RENAME COLUMN bling_sku TO erp_sku;
ALTER TABLE master_products RENAME COLUMN bling_formato TO product_format;
ALTER TABLE product_variants RENAME COLUMN bling_sku TO erp_sku;
ALTER TABLE product_variants RENAME COLUMN bling_formato TO product_format;
ALTER TABLE hub_writes RENAME COLUMN bling_id TO erp_id;

ALTER TABLE master_products ADD CONSTRAINT master_products_product_format_check CHECK (product_format IN ('S', 'V', 'E'));
ALTER TABLE master_products ADD CONSTRAINT master_products_erp_id_key UNIQUE (erp_id);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_stock_values_check CHECK (stock_mode IS NULL OR stock_mode IN ('physical', 'virtual'));
ALTER TABLE product_variants ADD CONSTRAINT product_variants_ean_status_check CHECK (ean_status IN ('unknown', 'valid', 'invalid', 'pending_validation', 'divergent', 'duplicate'));
ALTER TABLE product_variants ADD CONSTRAINT product_variants_variant_status_check CHECK (variant_status IN ('active', 'inactive', 'discontinued'));
ALTER TABLE product_variants ADD CONSTRAINT product_variants_product_format_check CHECK (product_format IN ('S', 'E'));
ALTER TABLE product_variants ADD CONSTRAINT product_variants_stock_mode_check CHECK (
  (product_format = 'S' AND stock_mode IS NULL)
  OR (product_format = 'E' AND stock_mode IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS master_products_erp_sku_nonempty_key
  ON master_products (erp_sku) WHERE erp_sku <> '';
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_sku_key
  ON product_variants (master_product_id, erp_sku);
CREATE INDEX IF NOT EXISTS idx_hub_writes_erp_id_written
  ON hub_writes (erp_id, written_at);
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_source_platform_check;
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_constraint_1;
ALTER TABLE product_images ADD CONSTRAINT product_images_source_platform_check
  CHECK (source_platform IN ('bling', 'erp', 'mercadolivre', 'nuvemshop'));
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS idx_hub_writes_erp_id_written;
DROP INDEX IF EXISTS product_variants_product_sku_key;
DROP INDEX IF EXISTS master_products_erp_sku_nonempty_key;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_stock_mode_check;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_product_format_check;
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_erp_id_key;
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_product_format_check;
ALTER TABLE hub_writes RENAME COLUMN erp_id TO bling_id;
ALTER TABLE product_variants RENAME COLUMN product_format TO bling_formato;
ALTER TABLE product_variants RENAME COLUMN erp_sku TO bling_sku;
ALTER TABLE master_products RENAME COLUMN product_format TO bling_formato;
ALTER TABLE master_products RENAME COLUMN erp_sku TO bling_sku;
ALTER TABLE master_products RENAME COLUMN erp_id TO bling_id;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
