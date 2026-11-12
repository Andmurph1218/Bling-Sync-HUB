import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * stock passa a ser só o estoque publicável (depósitos seller com include_in_push).
 * catalog_stock guarda a soma de exibição do catálogo.
 * O saldo antigo de stock foi calculado com a soma de exibição quando não havia depósito seller,
 * por isso vira catalog_stock e stock é zerado para variantes sem saldo em depósito de venda.
 */
export const UP_SQL = `
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS catalog_stock numeric(12,3);
UPDATE product_variants SET catalog_stock = stock WHERE catalog_stock IS NULL AND stock IS NOT NULL;
UPDATE product_variants SET stock = 0
WHERE stock IS NOT NULL
  AND id NOT IN (
    SELECT b.variant_id
    FROM variant_stock_balances b
    INNER JOIN stock_warehouses w ON w.bling_warehouse_id = b.bling_warehouse_id
    WHERE w.role = 'seller' AND w.include_in_push = true
  );
ALTER TABLE stock_warehouses DROP CONSTRAINT IF EXISTS stock_warehouses_role_check;
ALTER TABLE stock_warehouses DROP CONSTRAINT IF EXISTS stock_warehouses_check;
ALTER TABLE stock_warehouses DROP CONSTRAINT IF EXISTS stock_warehouses_constraint_1;
ALTER TABLE stock_warehouses DROP CONSTRAINT IF EXISTS stock_warehouses_constraint_2;
ALTER TABLE stock_warehouses ADD CONSTRAINT stock_warehouses_role_check
  CHECK (role IN ('unclassified', 'seller', 'ml_full', 'damaged', 'other'));
ALTER TABLE stock_warehouses ADD CONSTRAINT stock_warehouses_push_check
  CHECK (role = 'seller' OR include_in_push = false);
`;

export const DOWN_SQL = `
UPDATE stock_warehouses SET role = 'other' WHERE role = 'damaged';
ALTER TABLE stock_warehouses DROP CONSTRAINT IF EXISTS stock_warehouses_role_check;
ALTER TABLE stock_warehouses ADD CONSTRAINT stock_warehouses_role_check
  CHECK (role IN ('unclassified', 'seller', 'ml_full', 'other'));
ALTER TABLE product_variants DROP COLUMN IF EXISTS catalog_stock;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
