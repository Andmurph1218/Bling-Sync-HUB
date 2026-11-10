import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('operator', 'fiscal_approver', 'admin', 'viewer'));
`;

export const DOWN_SQL = `
DELETE FROM user_roles WHERE role = 'viewer';
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('operator', 'fiscal_approver', 'admin'));
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
