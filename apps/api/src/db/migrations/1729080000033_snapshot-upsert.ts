import type { MigrationBuilder } from 'node-pg-migrate';

/** Um retrato por produto e canal, para o upsert da reconciliação. */
export const UP_SQL = `
-- mem-skip-start
DELETE FROM marketplace_listings_snapshot
WHERE id IN (
  SELECT dup.id
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY product_id, marketplace
             ORDER BY last_synced_at DESC, id DESC
           ) AS rn
    FROM marketplace_listings_snapshot
  ) dup
  WHERE dup.rn > 1
);
-- mem-skip-end
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_snapshot_product_channel
  ON marketplace_listings_snapshot (product_id, marketplace);
`;

export const DOWN_SQL = `
DROP INDEX IF EXISTS marketplace_listings_snapshot_product_channel;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
