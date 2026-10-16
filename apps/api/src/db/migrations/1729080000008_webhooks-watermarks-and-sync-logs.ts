import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS webhook_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text NOT NULL CHECK (source IN ('bling', 'mercadolivre', 'nuvemshop')),
  event_type       text NOT NULL,
  resource_id      text NOT NULL,
  content_hash     char(64) NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  event_timestamp  timestamptz,
  raw_payload      jsonb,
  status           text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'queued', 'processing', 'processed', 'ignored', 'failed')),
  ignore_reason    text CHECK (ignore_reason IS NULL OR ignore_reason IN ('echo', 'stale_watermark', 'identical_content', 'service', 'duplicate')),
  error_detail     text,
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_watermarks (
  resource_type   text NOT NULL,
  resource_id     text NOT NULL,
  field_name      text NOT NULL,
  last_event_at   timestamptz NOT NULL,
  last_value_hash char(64),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id, field_name)
);

CREATE TABLE IF NOT EXISTS resource_locks (
  lock_key    text PRIMARY KEY,
  locked_by   text NOT NULL,
  locked_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id       uuid,
  platform         text NOT NULL,
  direction        text NOT NULL,
  field_group      text,
  fields_changed   jsonb,
  status           text NOT NULL,
  error_detail     text,
  idempotency_key  text NOT NULL,
  webhook_event_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS sync_logs CASCADE;
DROP TABLE IF EXISTS resource_locks;
DROP TABLE IF EXISTS field_watermarks;
DROP TABLE IF EXISTS webhook_events;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
