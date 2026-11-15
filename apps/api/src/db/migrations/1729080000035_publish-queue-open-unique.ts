import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Um único job aberto por produto e canal.
 *
 * Sem isso, duas chamadas concorrentes de createPublishJobs/enqueueAutoPublish
 * (ou um clique duplo no envio) criam duas linhas 'pending' para o mesmo par e o
 * worker faz dois POSTs. O índice é parcial porque depois de 'success'/'failed'
 * o produto precisa poder ser enfileirado de novo.
 */
export const UP_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS publish_queue_open_per_product_channel
  ON publish_queue (product_id, channel)
  WHERE status IN ('pending', 'processing');
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS publish_queue_open_per_product_channel;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
