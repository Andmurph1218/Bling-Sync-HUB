import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS publish_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES master_products(id),
  channel       text NOT NULL CHECK (channel IN ('mercadolivre', 'nuvemshop', 'shopee', 'amazon', 'tiktok')),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'success', 'failed')),
  payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publish_queue_status_created
  ON publish_queue (status, created_at);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS publish_queue;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
