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
      `INSERT INTO users (email, name, password_hash, is_active, must_change_password)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, email, name`,
      [normalizedEmail, input.name.trim(), passwordHash, input.mustChangePassword === true]
    );
    const created = userRes.rows[0];
    if (!created) {
      throw new Error('Falha ao inserir usuário');
    }

    if (await columnExists(client, 'users', 'invite_accepted_at') && input.invitePending !== true) {
      await client.query(`UPDATE users SET invite_accepted_at = now() WHERE id = $1`, [created.id]);
    }
    const grants = await tableExists(client, 'access_roles');
    for (const role of uniqueRoles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`,
        [created.id, role]
      );
      if (grants) {
        await client.query(
          `INSERT INTO user_access_roles (user_id, role_id)
           SELECT $1, id FROM access_roles WHERE slug = $2
           ON CONFLICT DO NOTHING`,
          [created.id, role]
        );
      }
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
    `SELECT id, email, name, password_hash, is_active, must_change_password, ${await mfaColumn()}
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

  const hours = await sessionHours();
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
       ${await mfaColumn()},
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

async function tableExists(client: PoolClient | null, name: string): Promise<boolean> {
  const sql = `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`;
  const res = client ? await client.query(sql, [name]) : await query(sql, [name]);
  return (res.rowCount ?? 0) > 0;
}

async function columnExists(client: PoolClient | null, table: string, column: string): Promise<boolean> {
  const sql = `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`;
  const res = client ? await client.query(sql, [table, column]) : await query(sql, [table, column]);
  return (res.rowCount ?? 0) > 0;
}

async function mfaColumn(): Promise<string> {
  return (await columnExists(null, 'users', 'mfa_enabled')) ? 'mfa_enabled' : 'false AS mfa_enabled';
}

async function sessionHours(): Promise<number> {
  if (!(await tableExists(null, 'tenant_settings'))) return env.SESSION_TTL_HOURS;
  const hoursRes = await query<{ session_hours: number }>(`SELECT session_hours FROM tenant_settings WHERE id = 1`);
  return hoursRes.rows[0]?.session_hours || env.SESSION_TTL_HOURS;
}

async function loadPermissions(userId: string, roles: readonly string[]): Promise<string[]> {
  if (!(await tableExists(null, 'user_access_roles'))) return permissionsFor(roles);
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
  const hours = await sessionHours();
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
