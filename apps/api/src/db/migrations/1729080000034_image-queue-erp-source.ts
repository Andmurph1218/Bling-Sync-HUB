import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * O Full Sync passou a enfileirar as imagens do ERP com source_platform = 'erp'
 * (ERP soberano), mas o CHECK original da fila só aceitava as plataformas de canal.
 * Sem esta migration o INSERT viola o CHECK e o produto fica sem imagem na fila,
 * sem capa elegível e sem auto-publicação.
 *
 * O DROP cobre os dois nomes possíveis: o nome gerado pelo PostgreSQL para o CHECK
 * inline (`image_processing_queue_source_platform_check`) e o nome usado pelo pg-mem
 * nos testes (`image_processing_queue_constraint_1`). Cada um é no-op no outro ambiente.
 */
export const UP_SQL = `
ALTER TABLE image_processing_queue DROP CONSTRAINT IF EXISTS image_processing_queue_source_platform_check;
ALTER TABLE image_processing_queue DROP CONSTRAINT IF EXISTS image_processing_queue_constraint_1;
ALTER TABLE image_processing_queue ADD CONSTRAINT image_processing_queue_source_platform_check
  CHECK (source_platform IN ('bling', 'erp', 'mercadolivre', 'nuvemshop'));
`;

export const DOWN_SQL = `
ALTER TABLE image_processing_queue DROP CONSTRAINT IF EXISTS image_processing_queue_source_platform_check;
ALTER TABLE image_processing_queue DROP CONSTRAINT IF EXISTS image_processing_queue_constraint_1;
UPDATE image_processing_queue SET source_platform = 'bling' WHERE source_platform = 'erp';
ALTER TABLE image_processing_queue ADD CONSTRAINT image_processing_queue_source_platform_check
  CHECK (source_platform IN ('bling', 'mercadolivre', 'nuvemshop'));
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
