import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Produtos/variantes do Bling podem não ter SKU cadastrado. Com bling_sku NOT NULL UNIQUE,
 * vários produtos sem SKU (string vazia) colidiam entre si no primeiro sync real.
 * - master_products: unicidade do SKU passa a valer apenas quando preenchido (índice parcial);
 *   a identidade principal do produto continua sendo bling_id (UNIQUE).
 * - product_variants: unicidade passa a ser (master_product_id, bling_sku), permitindo
 *   uma variante sem SKU por produto e mantendo ON CONFLICT determinístico.
 */
export const UP_SQL = `
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_bling_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS master_products_bling_sku_nonempty_key
  ON master_products (bling_sku) WHERE bling_sku <> '';

ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_bling_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_sku_key
  ON product_variants (master_product_id, bling_sku);
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS product_variants_product_sku_key;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_bling_sku_key UNIQUE (bling_sku);
DROP INDEX IF EXISTS master_products_bling_sku_nonempty_key;
ALTER TABLE master_products ADD CONSTRAINT master_products_bling_sku_key UNIQUE (bling_sku);
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
