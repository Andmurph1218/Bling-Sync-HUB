import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS enrichment_staging (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  source_platform   text NOT NULL CHECK (source_platform IN ('mercadolivre', 'nuvemshop')),
  field_name        text NOT NULL,
  proposed_value    jsonb NOT NULL,
  source_score      smallint NOT NULL,
  source_grade      char(1) NOT NULL CHECK (source_grade IN ('A', 'B', 'C', 'D', 'F')),
  applied           boolean NOT NULL DEFAULT false,
  applied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichment_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  source_platform   text NOT NULL CHECK (source_platform IN ('mercadolivre', 'nuvemshop')),
  field_name        text NOT NULL,
  bling_value       text,
  bling_score       smallint,
  bling_grade       char(1),
  suggested_value   text NOT NULL,
  suggested_score   smallint NOT NULL,
  suggested_grade   char(1) NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quality_history (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL,
  variant_id        uuid,
  field_name        text NOT NULL,
  old_value         text,
  new_value         text,
  old_score         smallint,
  new_score         smallint,
  decision          text NOT NULL CHECK (decision IN ('KEEP', 'REPLACE', 'SUGGEST', 'REVERT')),
  source            text NOT NULL,
  mode              text NOT NULL CHECK (mode IN ('shadow', 'live')),
  applied           boolean NOT NULL DEFAULT false,
  actor_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS product_category_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id   uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  channel_category_id text NOT NULL,
  channel_path        text,
  required_attributes jsonb NOT NULL DEFAULT '[]',
  is_verified         boolean NOT NULL DEFAULT false,
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, platform)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS product_category_mappings;
DROP TABLE IF EXISTS quality_history CASCADE;
DROP TABLE IF EXISTS enrichment_suggestions;
DROP TABLE IF EXISTS enrichment_staging;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
