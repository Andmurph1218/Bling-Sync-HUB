import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS channel_readiness_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
  score_bling       smallint NOT NULL DEFAULT 0 CHECK (score_bling BETWEEN 0 AND 100),
  score_ml          smallint NOT NULL DEFAULT 0 CHECK (score_ml BETWEEN 0 AND 100),
  score_ns          smallint NOT NULL DEFAULT 0 CHECK (score_ns BETWEEN 0 AND 100),
  publishable_bling boolean NOT NULL DEFAULT false,
  publishable_ml    boolean NOT NULL DEFAULT false,
  publishable_ns    boolean NOT NULL DEFAULT false,
  blockers          jsonb NOT NULL DEFAULT '[]',
  top_improvements  jsonb NOT NULL DEFAULT '[]',
  calculated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_readiness_history (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL,
  variant_id        uuid NOT NULL,
  score_bling       smallint NOT NULL,
  score_ml          smallint NOT NULL,
  score_ns          smallint NOT NULL,
  blockers          jsonb NOT NULL DEFAULT '[]',
  top_improvements  jsonb NOT NULL DEFAULT '[]',
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS identity_resolution_logs (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  platform            text NOT NULL,
  platform_product_id text NOT NULL,
  master_product_id   uuid,
  variant_id          uuid,
  engine              text NOT NULL CHECK (engine IN ('PIRE', 'VIR')),
  outcome             text NOT NULL CHECK (outcome IN ('auto_linked', 'suggestion', 'quarantine', 'manual_linked', 'rejected')),
  confidence          smallint,
  signals             jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS identity_resolution_logs CASCADE;
DROP TABLE IF EXISTS channel_readiness_history CASCADE;
DROP TABLE IF EXISTS channel_readiness_scores;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
