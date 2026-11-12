import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Imagem puxada do ERP entra como pendente até o IQRE analisar.
 * Sugestão de NCM vinda do Bling entra na mesma fila de aprovação dos canais.
 */
export const UP_SQL = `
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_rights_status_check;
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_constraint_2;
ALTER TABLE product_images ADD CONSTRAINT product_images_rights_status_check
  CHECK (rights_status IN ('pending', 'owned', 'third_party_risk', 'watermark_suspect', 'approved', 'rejected'));

ALTER TABLE ncm_manual_suggestions DROP CONSTRAINT IF EXISTS ncm_manual_suggestions_source_platform_check;
ALTER TABLE ncm_manual_suggestions DROP CONSTRAINT IF EXISTS ncm_manual_suggestions_constraint_1;
ALTER TABLE ncm_manual_suggestions ADD CONSTRAINT ncm_manual_suggestions_source_platform_check
  CHECK (source_platform IN ('bling', 'mercadolivre', 'nuvemshop'));
`;

export const DOWN_SQL = `
UPDATE product_images SET rights_status = 'owned' WHERE rights_status = 'pending';
ALTER TABLE product_images DROP CONSTRAINT IF EXISTS product_images_rights_status_check;
ALTER TABLE product_images ADD CONSTRAINT product_images_rights_status_check
  CHECK (rights_status IN ('owned', 'third_party_risk', 'watermark_suspect', 'approved', 'rejected'));

UPDATE ncm_manual_suggestions SET source_platform = 'nuvemshop' WHERE source_platform = 'bling';
ALTER TABLE ncm_manual_suggestions DROP CONSTRAINT IF EXISTS ncm_manual_suggestions_source_platform_check;
ALTER TABLE ncm_manual_suggestions ADD CONSTRAINT ncm_manual_suggestions_source_platform_check
  CHECK (source_platform IN ('mercadolivre', 'nuvemshop'));
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
