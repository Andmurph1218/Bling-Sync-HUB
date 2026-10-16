import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('operator', 'fiscal_approver', 'admin')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider            text PRIMARY KEY CHECK (provider IN ('bling', 'mercadolivre', 'nuvemshop')),
  access_token_enc    bytea NOT NULL,
  refresh_token_enc   bytea,
  expires_at          timestamptz NOT NULL,
  rotated_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_warehouses (
  bling_warehouse_id text PRIMARY KEY,
  name               text NOT NULL,
  role               text NOT NULL DEFAULT 'unclassified'
                       CHECK (role IN ('unclassified', 'seller', 'ml_full', 'other')),
  include_in_push    boolean NOT NULL DEFAULT false,
  CHECK (role = 'seller' OR include_in_push = false)
);

CREATE TABLE IF NOT EXISTS channel_stores (
  platform      text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  bling_loja_id text NOT NULL UNIQUE,
  name          text NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_sync_owners (
  platform     text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  stock_price  text NOT NULL DEFAULT 'bling_native' CHECK (stock_price IN ('bling_native', 'hub')),
  content      text NOT NULL DEFAULT 'hub' CHECK (content IN ('bling_native', 'hub'))
);

CREATE TABLE IF NOT EXISTS enrichment_controls (
  platform              text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  mode                  text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'live')),
  kill_switch           boolean NOT NULL DEFAULT false,
  max_replaces_per_run  integer NOT NULL DEFAULT 25
);

CREATE TABLE IF NOT EXISTS control_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target      text NOT NULL CHECK (target IN (
                'stock_warehouse', 'channel_store', 'channel_sync_owner',
                'enrichment_control', 'selling_condition'
              )),
  target_key  text NOT NULL,
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  origin      text NOT NULL DEFAULT 'admin' CHECK (origin IN ('admin', 'system')),
  changed_by  uuid REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (origin = 'admin' AND changed_by IS NOT NULL)
    OR (
      origin = 'system'
      AND changed_by IS NULL
      AND target = 'selling_condition'
      AND field = 'follow_store_price'
    )
  )
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  job_name     text PRIMARY KEY,
  cursor_value text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_writes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id       text NOT NULL,
  request_id     text NOT NULL UNIQUE,
  changed_fields text[] NOT NULL,
  written_at     timestamptz NOT NULL DEFAULT now()
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS hub_writes;
DROP TABLE IF EXISTS sync_cursors;
DROP TABLE IF EXISTS control_changes;
DROP TABLE IF EXISTS enrichment_controls;
DROP TABLE IF EXISTS channel_sync_owners;
DROP TABLE IF EXISTS channel_stores;
DROP TABLE IF EXISTS stock_warehouses;
DROP TABLE IF EXISTS oauth_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION forbid_control_changes_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'control_changes is append-only: UPDATE and DELETE are forbidden';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_control_changes_immutable ON control_changes;
    CREATE TRIGGER trg_control_changes_immutable
      BEFORE UPDATE OR DELETE ON control_changes
      FOR EACH ROW EXECUTE FUNCTION forbid_control_changes_mutation();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_control_changes_immutable ON control_changes;
    DROP FUNCTION IF EXISTS forbid_control_changes_mutation();
  `);
  pgm.sql(DOWN_SQL);
}
