import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS access_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_role_permissions (
  role_id uuid NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS user_access_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'JH Shopping',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  currency text NOT NULL DEFAULT 'BRL',
  notify_email text NOT NULL DEFAULT '',
  notify_webhook_url text NOT NULL DEFAULT '',
  alert_sync_failure boolean NOT NULL DEFAULT true,
  alert_token_expiring boolean NOT NULL DEFAULT true,
  alert_fiscal_block boolean NOT NULL DEFAULT true,
  password_min_length integer NOT NULL DEFAULT 8,
  session_hours integer NOT NULL DEFAULT 12,
  allowed_ips text NOT NULL DEFAULT ''
);

INSERT INTO tenant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_accepted_at timestamptz;
UPDATE users SET invite_accepted_at = created_at WHERE invite_accepted_at IS NULL;

ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_target_check;
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_origin_check;
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_check;
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_constraint_1;
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_constraint_2;
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_constraint_3;
ALTER TABLE control_changes ADD CONSTRAINT control_changes_target_check CHECK (target IN (
  'stock_warehouse', 'channel_store', 'channel_sync_owner',
  'enrichment_control', 'selling_condition',
  'user_role', 'tenant_settings', 'api_key'
));
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_origin_check;
ALTER TABLE control_changes ADD CONSTRAINT control_changes_origin_check CHECK (origin IN ('admin', 'system'));
ALTER TABLE control_changes DROP CONSTRAINT IF EXISTS control_changes_check;
ALTER TABLE control_changes ADD CONSTRAINT control_changes_origin_scope_check CHECK (
  (origin = 'admin' AND changed_by IS NOT NULL)
  OR (
    origin = 'system'
    AND changed_by IS NULL
    AND target = 'selling_condition'
    AND field = 'follow_store_price'
  )
);

INSERT INTO access_roles (slug, name, description, is_system) VALUES
  ('admin', 'Administrador', 'Todas as permissões do tenant.', true),
  ('operator', 'Operador de Catálogo', 'Lê e edita o catálogo e simula envios.', true),
  ('fiscal_approver', 'Revisor Fiscal', 'Aprova EAN e NCM e lê a auditoria.', true),
  ('viewer', 'Visualizador', 'Apenas leitura.', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM access_roles r
JOIN (VALUES
  ('admin', 'product:read'), ('admin', 'product:write'),
  ('admin', 'fiscal:approve_ean'), ('admin', 'fiscal:approve_ncm'),
  ('admin', 'push:simulate'), ('admin', 'push:execute'),
  ('admin', 'audit:read'),
  ('admin', 'settings:manage_users'), ('admin', 'settings:manage_general'),
  ('admin', 'settings:manage_notifications'), ('admin', 'settings:manage_webhooks'),
  ('admin', 'settings:manage_security'),
  ('operator', 'product:read'), ('operator', 'product:write'), ('operator', 'push:simulate'),
  ('fiscal_approver', 'fiscal:approve_ean'), ('fiscal_approver', 'fiscal:approve_ncm'), ('fiscal_approver', 'audit:read'),
  ('viewer', 'product:read'), ('viewer', 'audit:read')
) AS p(slug, permission) ON p.slug = r.slug
ON CONFLICT DO NOTHING;

INSERT INTO user_access_roles (user_id, role_id)
SELECT ur.user_id, ar.id
FROM user_roles ur
JOIN access_roles ar ON ar.slug = ur.role
ON CONFLICT DO NOTHING;
`;

export const DOWN_SQL = `
DELETE FROM user_access_roles;
DELETE FROM access_role_permissions;
DELETE FROM access_roles;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS tenant_settings;
DROP TABLE IF EXISTS mfa_challenges;
DROP TABLE IF EXISTS outbound_messages;
DROP TABLE IF EXISTS user_invites;
DROP TABLE IF EXISTS user_access_roles;
DROP TABLE IF EXISTS access_role_permissions;
DROP TABLE IF EXISTS access_roles;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_secret;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS invite_accepted_at;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
