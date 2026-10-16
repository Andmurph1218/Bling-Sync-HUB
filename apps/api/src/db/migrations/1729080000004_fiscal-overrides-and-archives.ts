import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS ean_pending_validation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  proposed_ean      varchar(14) NOT NULL,
  source_platform   text NOT NULL CHECK (source_platform IN ('mercadolivre', 'nuvemshop')),
  gs1_valid         boolean NOT NULL DEFAULT true,
  context_type      text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  rejection_reason  text,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, proposed_ean, source_platform)
);

CREATE TABLE IF NOT EXISTS ean_validation_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        uuid NOT NULL REFERENCES product_variants(id),
  master_product_id uuid NOT NULL REFERENCES master_products(id),
  ean               varchar(14),
  previous_status   text,
  new_status        text NOT NULL,
  action            text NOT NULL,
  actor_id          uuid REFERENCES users(id),
  details           jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ean_validation_history_archive (
  id                uuid PRIMARY KEY,
  variant_id        uuid NOT NULL,
  master_product_id uuid NOT NULL,
  ean               varchar(14),
  previous_status   text,
  new_status        text NOT NULL,
  action            text NOT NULL,
  actor_id          uuid,
  details           jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL,
  archived_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ncm_manual_suggestions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id      uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  proposed_ncm           varchar(10) NOT NULL,
  source_platform        text NOT NULL CHECK (source_platform IN ('mercadolivre', 'nuvemshop')),
  status                 text NOT NULL DEFAULT 'pending_first'
                           CHECK (status IN ('pending_first', 'pending_second', 'approved', 'rejected', 'expired')),
  first_review_by        uuid REFERENCES users(id),
  first_review_at        timestamptz,
  first_review_note      text,
  second_review_by       uuid REFERENCES users(id),
  second_review_at       timestamptz,
  tipi_consultation_note text,
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (second_review_by IS NULL OR second_review_by <> first_review_by),
  CHECK (
    status <> 'approved'
    OR (
      first_review_by IS NOT NULL
      AND second_review_by IS NOT NULL
      AND second_review_by <> first_review_by
      AND tipi_consultation_note IS NOT NULL
      AND length(trim(tipi_consultation_note)) > 0
    )
  )
);

CREATE TABLE IF NOT EXISTS ncm_divergence_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  bling_ncm         varchar(10),
  external_ncm      varchar(10),
  conflict_ncms     text[],
  alert_type        text NOT NULL CHECK (alert_type IN ('external_mismatch', 'variant_conflict', 'invalid_bling_ncm')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ncm_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id),
  previous_ncm      varchar(10),
  new_ncm           varchar(10),
  decision          text NOT NULL,
  first_review_by   uuid REFERENCES users(id),
  second_review_by  uuid REFERENCES users(id),
  tipi_note         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ncm_audit_log_archive (
  id                uuid PRIMARY KEY,
  master_product_id uuid NOT NULL,
  previous_ncm      varchar(10),
  new_ncm           varchar(10),
  decision          text NOT NULL,
  first_review_by   uuid,
  second_review_by  uuid,
  tipi_note         text,
  created_at        timestamptz NOT NULL,
  archived_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS divergence_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  platform          text CHECK (platform IS NULL OR platform IN ('bling', 'mercadolivre', 'nuvemshop')),
  alert_code        text NOT NULL,
  severity          text NOT NULL DEFAULT 'critical' CHECK (severity IN ('warning', 'critical')),
  bling_value       text,
  external_value    text,
  details           jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS divergence_alerts_archive (
  id                uuid PRIMARY KEY,
  master_product_id uuid NOT NULL,
  variant_id        uuid,
  platform          text,
  alert_code        text NOT NULL,
  severity          text NOT NULL,
  bling_value       text,
  external_value    text,
  details           jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL,
  resolved_by       uuid,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL,
  archived_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_content_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id         uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  platform           text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  field              text NOT NULL CHECK (field IN ('title', 'description')),
  value              text NOT NULL,
  source             text NOT NULL,
  status             text NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow', 'live', 'reverted')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, variant_id, platform, field)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS channel_content_overrides;
DROP TABLE IF EXISTS divergence_alerts_archive;
DROP TABLE IF EXISTS divergence_alerts;
DROP TABLE IF EXISTS ncm_audit_log_archive;
DROP TABLE IF EXISTS ncm_audit_log;
DROP TABLE IF EXISTS ncm_divergence_alerts;
DROP TABLE IF EXISTS ncm_manual_suggestions;
DROP TABLE IF EXISTS ean_validation_history_archive;
DROP TABLE IF EXISTS ean_validation_history;
DROP TABLE IF EXISTS ean_pending_validation;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION forbid_fiscal_archive_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Tabelas de auditoria e arquivo fiscal são imutáveis: UPDATE e DELETE proibidos';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_ncm_audit_immutable ON ncm_audit_log;
    CREATE TRIGGER trg_ncm_audit_immutable
      BEFORE UPDATE OR DELETE ON ncm_audit_log
      FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

    DROP TRIGGER IF EXISTS trg_ncm_archive_immutable ON ncm_audit_log_archive;
    CREATE TRIGGER trg_ncm_archive_immutable
      BEFORE UPDATE OR DELETE ON ncm_audit_log_archive
      FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

    DROP TRIGGER IF EXISTS trg_ean_archive_immutable ON ean_validation_history_archive;
    CREATE TRIGGER trg_ean_archive_immutable
      BEFORE UPDATE OR DELETE ON ean_validation_history_archive
      FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();

    DROP TRIGGER IF EXISTS trg_divergence_archive_immutable ON divergence_alerts_archive;
    CREATE TRIGGER trg_divergence_archive_immutable
      BEFORE UPDATE OR DELETE ON divergence_alerts_archive
      FOR EACH ROW EXECUTE FUNCTION forbid_fiscal_archive_mutation();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_divergence_archive_immutable ON divergence_alerts_archive;
    DROP TRIGGER IF EXISTS trg_ean_archive_immutable ON ean_validation_history_archive;
    DROP TRIGGER IF EXISTS trg_ncm_archive_immutable ON ncm_audit_log_archive;
    DROP TRIGGER IF EXISTS trg_ncm_audit_immutable ON ncm_audit_log;
    DROP FUNCTION IF EXISTS forbid_fiscal_archive_mutation();
  `);
  pgm.sql(DOWN_SQL);
}
