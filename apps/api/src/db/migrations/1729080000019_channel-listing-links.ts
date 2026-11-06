import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS channel_listing_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES master_products(id),
  channel         text NOT NULL CHECK (channel IN ('mercadolivre', 'nuvemshop', 'shopee', 'amazon', 'tiktok')),
  listing_id      text NOT NULL,
  listing_title   text,
  listing_price   numeric(12,2),
  listing_status  text,
  link_status     text NOT NULL DEFAULT 'vinculado',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, channel),
  UNIQUE (channel, listing_id)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS channel_listing_links;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
