import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Índices da ordenação da listagem do catálogo.
 *
 * A listagem ordena por: nome, SKU, tipo, preço, estoque e completude.
 * - Nome e SKU: índice funcional em `lower()`, que é a expressão do ORDER BY.
 * - Estoque e preço: vêm da variante exibida (`is_default`, preço > 0, mais recente).
 *   O índice de escolha da variante evita varrer todas as variantes do produto.
 * - Tipo: `product_format` tem baixa cardinalidade e não ganha índice.
 * - Completude: é uma contagem de predicados sobre imagens, categoria, mapas e
 *   variantes. Não existe coluna para indexar; o custo fica no sort da página.
 *
 * pg-mem não aceita índice funcional nem `DESC` na chave: os testes sobem sem eles.
 */
export const UP_SQL = `
-- mem-skip-start
CREATE INDEX IF NOT EXISTS master_products_name_lower
  ON master_products (lower(name));

CREATE INDEX IF NOT EXISTS master_products_erp_sku_lower
  ON master_products (lower(erp_sku));

CREATE INDEX IF NOT EXISTS product_variants_display_pick
  ON product_variants (master_product_id, is_default DESC, updated_at DESC);
-- mem-skip-end
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS product_variants_display_pick;
DROP INDEX IF EXISTS master_products_erp_sku_lower;
DROP INDEX IF EXISTS master_products_name_lower;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
