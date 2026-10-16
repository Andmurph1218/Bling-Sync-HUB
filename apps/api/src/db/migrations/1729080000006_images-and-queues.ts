import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS product_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  source_url        text NOT NULL,
  url_normalized    text NOT NULL,
  source_platform   text NOT NULL CHECK (source_platform IN ('bling', 'mercadolivre', 'nuvemshop')),
  seller_id         text,
  average_hash      varchar(16),
  sha256_hash       varchar(64),
  width             integer,
  height            integer,
  format            varchar(16),
  size_bytes        integer,
  rights_status     text NOT NULL DEFAULT 'owned'
                      CHECK (rights_status IN ('owned', 'third_party_risk', 'watermark_suspect', 'approved', 'rejected')),
  quality_score     smallint NOT NULL DEFAULT 0,
  is_cover_eligible boolean NOT NULL DEFAULT false,
  position_bling    smallint,
  position_ml       smallint,
  position_ns       smallint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, url_normalized)
);

CREATE TABLE IF NOT EXISTS image_processing_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id         uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  product_image_id   uuid REFERENCES product_images(id) ON DELETE SET NULL,
  source_url         text NOT NULL,
  url_normalized     text NOT NULL,
  source_platform    text NOT NULL CHECK (source_platform IN ('bling', 'mercadolivre', 'nuvemshop')),
  stage              text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'fetched', 'failed', 'done')),
  attempts           smallint NOT NULL DEFAULT 0,
  max_attempts       smallint NOT NULL DEFAULT 4,
  available_at       timestamptz NOT NULL DEFAULT now(),
  locked_at          timestamptz,
  locked_by          text,
  last_error         text,
  enqueued_at        timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  UNIQUE (master_product_id, url_normalized)
);

CREATE INDEX IF NOT EXISTS image_processing_queue_claim
  ON image_processing_queue (available_at, id)
  WHERE stage = 'queued' AND locked_at IS NULL;

CREATE TABLE IF NOT EXISTS image_rights_review_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_image_id  uuid NOT NULL REFERENCES product_images(id) ON DELETE CASCADE,
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  reason            text NOT NULL CHECK (reason IN ('different_seller', 'watermark_suspect', 'cross_product_similarity')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_image_limits (
  platform     text PRIMARY KEY CHECK (platform IN ('bling', 'mercadolivre', 'nuvemshop')),
  max_images   smallint NOT NULL,
  min_width    smallint NOT NULL,
  min_height   smallint NOT NULL,
  notes        text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS platform_image_limits;
DROP TABLE IF EXISTS image_rights_review_queue;
DROP INDEX IF EXISTS image_processing_queue_claim;
DROP TABLE IF EXISTS image_processing_queue;
DROP TABLE IF EXISTS product_images;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
