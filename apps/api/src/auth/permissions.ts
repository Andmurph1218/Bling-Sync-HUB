import { UserRole } from './types.js';

export const PERMISSIONS = [
  'product:read',
  'product:write',
  'fiscal:approve_ean',
  'fiscal:approve_ncm',
  'push:simulate',
  'push:execute',
  'audit:read',
  'settings:manage_users',
  'settings:manage_general',
  'settings:manage_notifications',
  'settings:manage_webhooks',
  'settings:manage_security',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'product:read': 'Ler catálogo',
  'product:write': 'Editar catálogo',
  'fiscal:approve_ean': 'Aprovar EAN',
  'fiscal:approve_ncm': 'Aprovar NCM',
  'push:simulate': 'Simular envio',
  'push:execute': 'Executar envio',
  'audit:read': 'Ler auditoria',
  'settings:manage_users': 'Gerir usuários',
  'settings:manage_general': 'Configurações gerais',
  'settings:manage_notifications': 'Notificações',
  'settings:manage_webhooks': 'Webhooks e chaves',
  'settings:manage_security': 'Segurança',
};

const READ_PERMISSIONS = PERMISSIONS.filter((permission) => permission.endsWith(':read'));

export const SYSTEM_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  operator: ['product:read', 'product:write', 'push:simulate'],
  fiscal_approver: ['fiscal:approve_ean', 'fiscal:approve_ncm', 'audit:read'],
  viewer: READ_PERMISSIONS,
};

export const MFA_REQUIRED_ROLES: readonly UserRole[] = ['admin', 'fiscal_approver'];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[], granted: readonly string[] = []): string[] {
  const owned = new Set<string>(granted.filter(isPermission));
  for (const role of roles) {
    const bundled = SYSTEM_ROLE_PERMISSIONS[role as UserRole];
    if (bundled) bundled.forEach((permission) => owned.add(permission));
  }
  if (owned.has('*:read')) READ_PERMISSIONS.forEach((permission) => owned.add(permission));
  return [...owned];
}

export function hasPermission(
  user: { roles: readonly string[]; permissions?: readonly string[] },
  permission: string
): boolean {
  if (user.roles.includes('admin')) return true;
  const owned = user.permissions ?? permissionsFor(user.roles);
  if (owned.includes(permission)) return true;
  return permission.endsWith(':read') && owned.includes('*:read');
}

export function mfaRequiredFor(roles: readonly string[]): boolean {
  return roles.some((role) => (MFA_REQUIRED_ROLES as readonly string[]).includes(role));
}
