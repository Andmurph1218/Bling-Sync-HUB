import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS pending_product_changes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  job_kind          text NOT NULL CHECK (job_kind IN ('STOCK_PRICE', 'CONTENT', 'CREATE')),
  priority          varchar(2) NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  changed_fields    text[] NOT NULL,
  detected_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aggregation_windows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  job_kind          text NOT NULL CHECK (job_kind IN ('STOCK_PRICE', 'CONTENT', 'CREATE')),
  priority          varchar(2) NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  changed_fields    text[] NOT NULL DEFAULT '{}',
  opens_at          timestamptz NOT NULL DEFAULT now(),
  flushes_at        timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'flushed', 'cancelled')),
  UNIQUE (master_product_id, variant_id, platform, job_kind, status)
);

CREATE TABLE IF NOT EXISTS push_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id         uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  platform           text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  job_kind           text NOT NULL CHECK (job_kind IN ('STOCK_PRICE', 'CONTENT', 'CREATE')),
  priority           varchar(2) NOT NULL DEFAULT 'P1' CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  changed_fields     text[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending', 'locked', 'completed', 'failed',
                       'blocked', 'superseded', 'cancelled'
                     )),
  block_reason       text CHECK (block_reason IS NULL OR block_reason IN ('ncm', 'ean', 'score', 'unlinked', 'price_zero')),
  attempts           smallint NOT NULL DEFAULT 0,
  locked_at          timestamptz,
  locked_by          text,
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_jobs_active
  ON push_jobs (master_product_id, variant_id, platform, job_kind)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS push_job_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_job_id  uuid NOT NULL REFERENCES push_jobs(id) ON DELETE CASCADE,
  step         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'skipped', 'blocked')),
  skip_reason  text,
  last_error   text,
  finished_at  timestamptz,
  UNIQUE (push_job_id, step)
);

CREATE TABLE IF NOT EXISTS push_execution_logs (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  push_job_id       uuid NOT NULL,
  push_job_step_id  uuid,
  master_product_id uuid NOT NULL,
  variant_id        uuid NOT NULL,
  platform          text NOT NULL,
  job_kind          text NOT NULL,
  step              text NOT NULL,
  http_status       smallint,
  latency_ms        integer,
  status            text NOT NULL,
  error_detail      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS push_execution_logs CASCADE;
DROP TABLE IF EXISTS push_job_steps;
DROP INDEX IF EXISTS push_jobs_active;
DROP TABLE IF EXISTS push_jobs;
DROP TABLE IF EXISTS aggregation_windows;
DROP TABLE IF EXISTS pending_product_changes;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
