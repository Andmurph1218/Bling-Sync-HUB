import { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './crypto.js';
import { AuthenticatedUser, UserRole } from './types.js';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roles: UserRole[];
}

export interface LoginResult {
  user: AuthenticatedUser;
  opaqueToken: string;
  expiresAt: Date;
}

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
      `INSERT INTO users (email, name, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, email, name`,
      [normalizedEmail, input.name.trim(), passwordHash]
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
  }>(
    `SELECT id, email, name, password_hash, is_active
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

  const rolesRes = await query<{ role: UserRole }>(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC`,
    [user.id]
  );
  const roles = rolesRes.rows.map((r) => r.role);

  const opaqueToken = generateSessionToken();
  const tokenHash = hashSessionToken(opaqueToken);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

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
      sessionId: sessionRow.id,
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
    expires_at: Date | string;
  }>(
    `SELECT
       s.id AS session_id,
       u.id AS user_id,
       u.email,
       u.name,
       u.is_active,
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

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    roles: rolesRes.rows.map((r) => r.role),
    sessionId: row.session_id,
  };
}

export async function revokeSessionByToken(opaqueToken: string): Promise<void> {
  if (!opaqueToken) return;
  const tokenHash = hashSessionToken(opaqueToken);
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}
