import { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './crypto.js';
import {
  DefaultPasswordRejectedError,
  evaluateLoginPassword,
  isBootstrapDefaultPassword,
} from './password-policy.js';
import { permissionsFor } from './permissions.js';
import { verifyTotp } from './totp.js';
import { AuthenticatedUser, UserRole } from './types.js';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roles: UserRole[];
  mustChangePassword?: boolean;
  invitePending?: boolean;
}

export type LoginResult =
  | { mfaRequired: true; ticket: string; expiresAt: Date }
  | { mfaRequired?: false; user: AuthenticatedUser; opaqueToken: string; expiresAt: Date };

export async function createUser(input: CreateUserInput): Promise<{
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
}> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const uniqueRoles = Array.from(new Set(input.roles));

  if (uniqueRoles.length === 0) {
    throw new Error('Todo usuário deve possuir ao menos um papel');
  }

  return withTransaction(async (client: PoolClient) => {
    const userRes = await client.query<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, must_change_password, invite_accepted_at)
       VALUES ($1, $2, $3, true, $4, CASE WHEN $5 THEN NULL ELSE now() END)
       RETURNING id, email, name`,
      [normalizedEmail, input.name.trim(), passwordHash, input.mustChangePassword === true, input.invitePending === true]
    );
    const created = userRes.rows[0];
    if (!created) {
      throw new Error('Falha ao inserir usuário');
    }

    for (const role of uniqueRoles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`,
        [created.id, role]
      );
      await client.query(
        `INSERT INTO user_access_roles (user_id, role_id)
         SELECT $1, id FROM access_roles WHERE slug = $2
         ON CONFLICT DO NOTHING`,
        [created.id, role]
      );
    }

    return {
      id: created.id,
      email: created.email,
      name: created.name,
      roles: uniqueRoles,
    };
  });
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<LoginResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const userRes = await query<{
    id: string;
    email: string;
    name: string;
    password_hash: string;
    is_active: boolean;
    must_change_password: boolean;
    mfa_enabled: boolean;
  }>(
    `SELECT id, email, name, password_hash, is_active, must_change_password, mfa_enabled
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  const user = userRes.rows[0];
  if (!user || !user.is_active) {
    return null;
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    return null;
  }

  const passwordPolicy = evaluateLoginPassword({
    nodeEnv: env.NODE_ENV,
    password,
    mustChangePassword: user.must_change_password,
  });

  const rolesRes = await query<{ role: UserRole }>(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC`,
    [user.id]
  );
  const roles = rolesRes.rows.map((r) => r.role);
  const permissions = await loadPermissions(user.id, roles);

  if (user.mfa_enabled) {
    const ticket = generateSessionToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await query(
      `INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, hashSessionToken(ticket), expiresAt.toISOString()]
    );
    return { mfaRequired: true, ticket, expiresAt };
  }

  const hoursRes = await query<{ session_hours: number }>(`SELECT session_hours FROM tenant_settings WHERE id = 1`);
  const hours = hoursRes.rows[0]?.session_hours || env.SESSION_TTL_HOURS;
  const opaqueToken = generateSessionToken();
  const tokenHash = hashSessionToken(opaqueToken);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const sessionRes = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [user.id, tokenHash, expiresAt.toISOString()]
  );

  const sessionRow = sessionRes.rows[0];
  if (!sessionRow) {
    throw new Error('Falha ao criar sessão');
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
      permissions,
      sessionId: sessionRow.id,
      mustChangePassword: passwordPolicy.mustChangePassword,
      mfaEnabled: user.mfa_enabled,
    },
    opaqueToken,
    expiresAt,
  };
}

export async function resolveSessionByToken(
  opaqueToken: string
): Promise<AuthenticatedUser | null> {
  if (!opaqueToken || opaqueToken.trim().length === 0) {
    return null;
  }
  const tokenHash = hashSessionToken(opaqueToken);

  const sessionRes = await query<{
    session_id: string;
    user_id: string;
    email: string;
    name: string;
    is_active: boolean;
    must_change_password: boolean;
    mfa_enabled: boolean;
    expires_at: Date | string;
  }>(
    `SELECT
       s.id AS session_id,
       u.id AS user_id,
       u.email,
       u.name,
       u.is_active,
       u.must_change_password,
       u.mfa_enabled,
       s.expires_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  const row = sessionRes.rows[0];
  if (!row || !row.is_active) {
    return null;
  }

  const expiresAtDate =
    row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (expiresAtDate.getTime() <= Date.now()) {
    await query(`DELETE FROM sessions WHERE id = $1`, [row.session_id]);
    return null;
  }

  const rolesRes = await query<{ role: UserRole }>(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC`,
    [row.user_id]
  );
  const roles = rolesRes.rows.map((r) => r.role);

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    roles,
    permissions: await loadPermissions(row.user_id, roles),
    sessionId: row.session_id,
    mustChangePassword: row.must_change_password,
    mfaEnabled: row.mfa_enabled,
  };
}

async function loadPermissions(userId: string, roles: readonly string[]): Promise<string[]> {
  const granted = await query<{ permission: string }>(
    `SELECT arp.permission
     FROM user_access_roles uar
     JOIN access_role_permissions arp ON arp.role_id = uar.role_id
     WHERE uar.user_id = $1`,
    [userId]
  );
  return permissionsFor(roles, granted.rows.map((row) => row.permission));
}

export async function completeMfaLogin(ticket: string, code: string): Promise<LoginResult | null> {
  const challenge = await query<{ id: string; user_id: string; expires_at: Date | string }>(
    `SELECT id, user_id, expires_at FROM mfa_challenges WHERE token_hash = $1`,
    [hashSessionToken(ticket)]
  );
  const row = challenge.rows[0];
  if (!row) return null;
  const expires = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (expires.getTime() <= Date.now()) {
    await query(`DELETE FROM mfa_challenges WHERE id = $1`, [row.id]);
    return null;
  }
  const secretRes = await query<{ mfa_secret: string | null }>(`SELECT mfa_secret FROM users WHERE id = $1`, [row.user_id]);
  if (!secretRes.rows[0]?.mfa_secret || !verifyTotp(secretRes.rows[0].mfa_secret, code)) return null;
  await query(`DELETE FROM mfa_challenges WHERE id = $1`, [row.id]);
  const user = await query<{ id: string; email: string; name: string; must_change_password: boolean; mfa_enabled: boolean }>(
    `SELECT id, email, name, must_change_password, mfa_enabled FROM users WHERE id = $1 AND is_active = true`,
    [row.user_id]
  );
  const account = user.rows[0];
  if (!account) return null;
  const rolesRes = await query<{ role: UserRole }>(`SELECT role FROM user_roles WHERE user_id = $1`, [account.id]);
  const roles = rolesRes.rows.map((item) => item.role);
  const session = await openSession(account.id);
  return {
    user: {
      id: account.id,
      email: account.email,
      name: account.name,
      roles,
      permissions: await loadPermissions(account.id, roles),
      sessionId: session.id,
      mustChangePassword: account.must_change_password,
      mfaEnabled: account.mfa_enabled,
    },
    opaqueToken: session.token,
    expiresAt: session.expiresAt,
  };
}

async function openSession(userId: string): Promise<{ id: string; token: string; expiresAt: Date }> {
  const hoursRes = await query<{ session_hours: number }>(`SELECT session_hours FROM tenant_settings WHERE id = 1`);
  const hours = hoursRes.rows[0]?.session_hours || env.SESSION_TTL_HOURS;
  const opaqueToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const sessionRes = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
    [userId, hashSessionToken(opaqueToken), expiresAt.toISOString()]
  );
  const sessionRow = sessionRes.rows[0];
  if (!sessionRow) throw new Error('Falha ao criar sessão');
  return { id: sessionRow.id, token: opaqueToken, expiresAt };
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (isBootstrapDefaultPassword(newPassword)) {
    throw new DefaultPasswordRejectedError();
  }
  if (newPassword === currentPassword) {
    throw new Error('same_password');
  }

  const userRes = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1 AND is_active = true`,
    [userId]
  );
  const user = userRes.rows[0];
  if (!user) {
    throw new Error('user_not_found');
  }
  const valid = await verifyPassword(user.password_hash, currentPassword);
  if (!valid) {
    throw new Error('invalid_current_password');
  }

  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`,
    [userId, passwordHash]
  );
}

export async function revokeSessionByToken(opaqueToken: string): Promise<void> {
  if (!opaqueToken) return;
  const tokenHash = hashSessionToken(opaqueToken);
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}
