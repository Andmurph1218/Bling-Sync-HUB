import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * P0.2 — usuários do bootstrap precisam trocar a senha no primeiro login.
 * Bases já migradas não reexecutam a migration 001, então a coluna entra aqui.
 * Os quatro e-mails iniciais ficam marcados: a senha padrão deixa de valer
 * fora de desenvolvimento e, em desenvolvimento, o login exige troca.
 */
export const UP_SQL = `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

UPDATE users
SET must_change_password = true
WHERE email IN (
  'admin@blingsync.local',
  'fiscal1@blingsync.local',
  'fiscal2@blingsync.local',
  'operador@blingsync.local'
);
`;

export const DOWN_SQL = `
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
