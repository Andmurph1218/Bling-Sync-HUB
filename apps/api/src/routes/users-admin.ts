import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { generateSessionToken, hashPassword, hashSessionToken } from '../auth/crypto.js';
import { createUser } from '../auth/service.js';
import { hasPermission, isPermission, mfaRequiredFor, PERMISSION_LABELS, PERMISSIONS } from '../auth/permissions.js';
import { generateTotpSecret, verifyTotp } from '../auth/totp.js';
import { ROLES, UserRole } from '../auth/types.js';
import { query } from '../db/pool.js';

export const usersAdminRouter = Router();

const manageUsers = requirePermission('settings:manage_users');
const SYSTEM_SLUGS = new Set<string>(ROLES);

function origin(): string {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? 'https://hub.jhshopping.com.br' : 'http://localhost:3000';
}

async function recordChange(actorId: string, target: string, targetKey: string, field: string, oldValue: string, newValue: string) {
  await query(
    `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
     VALUES ($1, $2, $3, $4, $5, 'admin', $6)`,
    [target, targetKey, field, oldValue, newValue, actorId]
  );
}

async function roleRows(userId: string) {
  const rows = await query<{ id: string; slug: string; name: string }>(
    `SELECT ar.id, ar.slug, ar.name
     FROM user_access_roles uar
     JOIN access_roles ar ON ar.id = uar.role_id
     WHERE uar.user_id = $1
     ORDER BY ar.name`,
    [userId]
  );
  return rows.rows;
}

async function replaceRoles(userId: string, roleIds: string[], actorId: string) {
  const current = await roleRows(userId);
  const nextRes = await query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM access_roles WHERE id IN (${roleIds.map((_, index) => `$${index + 1}`).join(',')})`,
    roleIds
  );
  if (nextRes.rows.length !== new Set(roleIds).size) {
    throw Object.assign(new Error('unknown_role'), { status: 400 });
  }
  if (userId === actorId && current.some((role) => role.slug === 'admin') && !nextRes.rows.some((role) => role.slug === 'admin')) {
    throw Object.assign(new Error('cannot_demote_self'), { status: 409 });
  }
  const oldValue = current.map((role) => role.slug).sort().join(',') || '(nenhum)';
  const newValue = nextRes.rows.map((role) => role.slug).sort().join(',');
  await query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_access_roles WHERE user_id = $1`, [userId]);
  for (const role of nextRes.rows) {
    await query(`INSERT INTO user_access_roles (user_id, role_id) VALUES ($1, $2)`, [userId, role.id]);
    if (SYSTEM_SLUGS.has(role.slug)) {
      await query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [userId, role.slug]);
    }
  }
  if (oldValue !== newValue) {
    await recordChange(actorId, 'user_role', userId, 'roles', oldValue, newValue);
  }
  return nextRes.rows;
}

async function queueAccessMail(email: string, purpose: 'invite' | 'reset', token: string) {
  const url = `${origin()}/convite?token=${encodeURIComponent(token)}`;
  const subject = purpose === 'invite' ? 'Convite para o JH Sync Hub' : 'Redefinição de senha do JH Sync Hub';
  const body = purpose === 'invite'
    ? `Você foi convidado para o JH Sync Hub. Defina sua senha e aceite o acesso: ${url}`
    : `Foi pedida uma nova senha para a sua conta. Use este link nas próximas 2 horas: ${url}`;
  await query(
    `INSERT INTO outbound_messages (to_email, subject, body, purpose) VALUES ($1, $2, $3, $4)`,
    [email, subject, body, purpose]
  );
  return { url, emailed: false };
}

usersAdminRouter.get('/api/admin/permissions', manageUsers, (_req, res) => {
  res.status(200).json({
    permissions: PERMISSIONS.map((id) => ({ id, label: PERMISSION_LABELS[id] })),
  });
});

usersAdminRouter.get('/api/admin/roles', manageUsers, async (_req, res, next) => {
  try {
    const roles = await query<{ id: string; slug: string; name: string; description: string; is_system: boolean }>(
      `SELECT id, slug, name, description, is_system FROM access_roles ORDER BY is_system DESC, name ASC`
    );
    const perms = await query<{ role_id: string; permission: string }>(
      `SELECT role_id, permission FROM access_role_permissions`
    );
    res.status(200).json({
      roles: roles.rows.map((role) => ({
        ...role,
        isSystem: role.is_system,
        permissions: perms.rows.filter((item) => item.role_id === role.id).map((item) => item.permission),
      })),
    });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/admin/roles', manageUsers, async (req, res, next) => {
  try {
    const parsed = z.object({
      name: z.string().trim().min(2).max(80),
      permissions: z.array(z.string()).min(1),
    }).safeParse(req.body);
    if (!parsed.success || parsed.data.permissions.some((item) => !isPermission(item))) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const slug = `${parsed.data.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'papel'}-${crypto.randomBytes(2).toString('hex')}`;
    const created = await query<{ id: string }>(
      `INSERT INTO access_roles (slug, name, description, is_system) VALUES ($1, $2, '', false) RETURNING id`,
      [slug, parsed.data.name]
    );
    const id = created.rows[0]!.id;
    for (const permission of new Set(parsed.data.permissions)) {
      await query(`INSERT INTO access_role_permissions (role_id, permission) VALUES ($1, $2)`, [id, permission]);
    }
    await recordChange(req.user!.id, 'user_role', id, 'custom_role', '(novo)', `${slug}:${parsed.data.permissions.join(',')}`);
    res.status(201).json({ id, slug, name: parsed.data.name, permissions: parsed.data.permissions, isSystem: false });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.get('/api/admin/users', manageUsers, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const role = String(req.query.role ?? '');
    const users = await query<{
      id: string;
      name: string;
      email: string;
      is_active: boolean;
      mfa_enabled: boolean;
      invite_accepted_at: Date | null;
    }>(
      `SELECT id, name, email, is_active, mfa_enabled, invite_accepted_at
       FROM users
       ORDER BY name ASC`
    );
    const sessions = await query<{ user_id: string; last_access: Date | null }>(
      `SELECT user_id, max(created_at) AS last_access FROM sessions GROUP BY user_id`
    );
    const grants = await query<{ user_id: string; id: string; slug: string; name: string }>(
      `SELECT uar.user_id, ar.id, ar.slug, ar.name
       FROM user_access_roles uar
       JOIN access_roles ar ON ar.id = uar.role_id`
    );
    const items = users.rows
      .map((user) => {
        const roles = grants.rows.filter((grant) => grant.user_id === user.id);
        const lastAccess = sessions.rows.find((session) => session.user_id === user.id)?.last_access ?? null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          active: user.is_active,
          mfaEnabled: user.mfa_enabled,
          mfaRequired: mfaRequiredFor(roles.map((item) => item.slug)),
          inviteStatus: user.invite_accepted_at ? 'active' : 'pending',
          roles: roles.map(({ id, slug, name }) => ({ id, slug, name })),
          role: (roles.find((item) => SYSTEM_SLUGS.has(item.slug))?.slug ?? roles[0]?.slug ?? 'viewer') as UserRole,
          lastAccess: lastAccess ? new Date(lastAccess).toISOString() : null,
        };
      })
      .filter((user) => {
        if (role && !user.roles.some((item) => item.slug === role || item.id === role)) return false;
        if (!q) return true;
        return user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
      });
    res.status(200).json({ users: items });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/admin/users', manageUsers, async (req, res, next) => {
  try {
    const parsed = z.object({
      name: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().email(),
      roleIds: z.array(z.string().uuid()).min(1),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const roles = await query<{ id: string; slug: string }>(
      `SELECT id, slug FROM access_roles WHERE id IN (${parsed.data.roleIds.map((_, index) => `$${index + 1}`).join(',')})`,
      parsed.data.roleIds
    );
    if (roles.rows.length !== new Set(parsed.data.roleIds).size) {
      res.status(400).json({ error: 'unknown_role' });
      return;
    }
    const system = roles.rows.map((role) => role.slug).filter((slug): slug is UserRole => SYSTEM_SLUGS.has(slug));
    const email = parsed.data.email.toLowerCase();
    const name = parsed.data.name?.trim() || email.split('@')[0] || 'Convidado';
    try {
      const created = await createUser({
        email,
        name,
        password: `Hub-${crypto.randomBytes(18).toString('base64url')}`,
        roles: system.length > 0 ? system : ['viewer'],
        mustChangePassword: true,
        invitePending: true,
      });
      if (system.length === 0) {
        await query(`DELETE FROM user_roles WHERE user_id = $1`, [created.id]);
        await query(`DELETE FROM user_access_roles WHERE user_id = $1`, [created.id]);
      }
      for (const role of roles.rows) {
        await query(
          `INSERT INTO user_access_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [created.id, role.id]
        );
      }
      const token = generateSessionToken();
      const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await query(
        `INSERT INTO user_invites (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'invite', $3)`,
        [created.id, hashSessionToken(token), expires.toISOString()]
      );
      const delivery = await queueAccessMail(email, 'invite', token);
      await recordChange(req.user!.id, 'user_role', created.id, 'invite', '(novo)', roles.rows.map((role) => role.slug).join(','));
      res.status(201).json({ user: created, inviteUrl: delivery.url, emailed: delivery.emailed });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('duplicate') || message.includes('unique')) {
        res.status(409).json({ error: 'email_taken' });
        return;
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.patch('/api/admin/users/:id/roles', manageUsers, async (req, res, next) => {
  try {
    const parsed = z.object({ roleIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success || !req.params.id) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const roles = await replaceRoles(req.params.id, parsed.data.roleIds, req.user!.id);
    res.status(200).json({ roles });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      res.status(status).json({ error: error instanceof Error ? error.message : 'error' });
      return;
    }
    next(error);
  }
});

usersAdminRouter.post('/api/admin/users/:id/deactivate', manageUsers, async (req, res, next) => {
  try {
    if (req.params.id === req.user?.id) {
      res.status(409).json({ error: 'cannot_deactivate_self' });
      return;
    }
    const updated = await query(`UPDATE users SET is_active = false WHERE id = $1 AND is_active = true`, [req.params.id]);
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await query(`DELETE FROM sessions WHERE user_id = $1`, [req.params.id]);
    await recordChange(req.user!.id, 'user_role', req.params.id, 'is_active', 'true', 'false');
    res.status(200).json({ active: false });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/admin/users/:id/reset-password', manageUsers, async (req, res, next) => {
  try {
    const user = await query<{ id: string; email: string }>(`SELECT id, email FROM users WHERE id = $1`, [req.params.id]);
    const row = user.rows[0];
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const token = generateSessionToken();
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await query(
      `INSERT INTO user_invites (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'reset', $3)`,
      [row.id, hashSessionToken(token), expires.toISOString()]
    );
    const delivery = await queueAccessMail(row.email, 'reset', token);
    await recordChange(req.user!.id, 'user_role', row.id, 'password_reset', '(link anterior)', 'link emitido');
    res.status(200).json({ resetUrl: delivery.url, emailed: delivery.emailed });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/auth/invites/accept', async (req, res, next) => {
  try {
    const parsed = z.object({
      token: z.string().min(20),
      password: z.string().min(8).max(200),
      name: z.string().trim().min(2).max(120).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const policy = await query<{ password_min_length: number }>(`SELECT password_min_length FROM tenant_settings WHERE id = 1`);
    const min = policy.rows[0]?.password_min_length ?? 8;
    if (parsed.data.password.length < min) {
      res.status(400).json({ error: 'password_too_short', min });
      return;
    }
    const invite = await query<{ id: string; user_id: string; expires_at: Date | string; accepted_at: Date | null }>(
      `SELECT id, user_id, expires_at, accepted_at FROM user_invites WHERE token_hash = $1`,
      [hashSessionToken(parsed.data.token)]
    );
    const row = invite.rows[0];
    const expires = row ? (row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at)) : null;
    if (!row || row.accepted_at || !expires || expires.getTime() <= Date.now()) {
      res.status(400).json({ error: 'invite_invalid' });
      return;
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await query(
      `UPDATE users
       SET password_hash = $2, must_change_password = false, invite_accepted_at = now(),
           name = COALESCE($3, name)
       WHERE id = $1`,
      [row.user_id, passwordHash, parsed.data.name ?? null]
    );
    await query(`UPDATE user_invites SET accepted_at = now() WHERE id = $1`, [row.id]);
    res.status(200).json({ status: 'accepted' });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/account/mfa/start', requireAuth, async (req, res, next) => {
  try {
    const secret = generateTotpSecret();
    await query(`UPDATE users SET mfa_secret = $2, mfa_enabled = false WHERE id = $1`, [req.user!.id, secret]);
    const label = encodeURIComponent(req.user!.email);
    res.status(200).json({ secret, otpauth: `otpauth://totp/JH%20Sync%20Hub:${label}?secret=${secret}&issuer=JH%20Sync%20Hub` });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/account/mfa/confirm', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({ code: z.string().min(6).max(8) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const secret = await query<{ mfa_secret: string | null }>(`SELECT mfa_secret FROM users WHERE id = $1`, [req.user!.id]);
    if (!secret.rows[0]?.mfa_secret || !verifyTotp(secret.rows[0].mfa_secret, parsed.data.code)) {
      res.status(400).json({ error: 'invalid_mfa' });
      return;
    }
    await query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [req.user!.id]);
    await recordChange(req.user!.id, 'user_role', req.user!.id, 'mfa_enabled', 'false', 'true');
    res.status(200).json({ mfaEnabled: true });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.get('/api/admin/settings', requirePermission('settings:manage_general', 'settings:manage_notifications', 'settings:manage_security'), async (_req, res, next) => {
  try {
    const row = await query(`SELECT * FROM tenant_settings WHERE id = 1`);
    res.status(200).json({ settings: row.rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.put('/api/admin/settings', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({
      company_name: z.string().trim().min(2).max(120).optional(),
      timezone: z.string().trim().min(3).max(64).optional(),
      currency: z.string().trim().length(3).optional(),
      notify_email: z.string().trim().email().or(z.literal('')).optional(),
      notify_webhook_url: z.string().trim().max(300).optional(),
      alert_sync_failure: z.boolean().optional(),
      alert_token_expiring: z.boolean().optional(),
      alert_fiscal_block: z.boolean().optional(),
      password_min_length: z.number().int().min(8).max(64).optional(),
      session_hours: z.number().int().min(1).max(168).optional(),
      allowed_ips: z.string().max(2000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const section = String(req.query.section ?? 'general');
    const needed = section === 'notifications'
      ? 'settings:manage_notifications'
      : section === 'security'
        ? 'settings:manage_security'
        : 'settings:manage_general';
    if (!hasPermission(req.user!, needed)) {
      res.status(403).json({ error: 'forbidden', requiredPermissions: [needed] });
      return;
    }
    const current = await query<Record<string, string | number | boolean>>(`SELECT * FROM tenant_settings WHERE id = 1`);
    const before = current.rows[0] ?? {};
    const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
    for (const [field, value] of entries) {
      await query(`UPDATE tenant_settings SET ${field} = $1 WHERE id = 1`, [value]);
      if (String(before[field] ?? '') !== String(value)) {
        await recordChange(req.user!.id, 'tenant_settings', 'tenant', field, String(before[field] ?? ''), String(value));
      }
    }
    const saved = await query(`SELECT * FROM tenant_settings WHERE id = 1`);
    res.status(200).json({ settings: saved.rows[0] });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.get('/api/admin/webhooks', requirePermission('settings:manage_webhooks'), (_req, res) => {
  const base = process.env.PUBLIC_API_ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://hub.jhshopping.com.br' : 'http://localhost:3001');
  res.status(200).json({
    endpoints: [
      { source: 'Bling', method: 'POST', path: `${base}/webhooks/bling` },
      { source: 'Nuvemshop', method: 'POST', path: `${base}/webhooks/nuvemshop` },
    ],
  });
});

usersAdminRouter.get('/api/admin/api-keys', requirePermission('settings:manage_webhooks'), async (_req, res, next) => {
  try {
    const keys = await query(
      `SELECT id, name, prefix, created_at, rotated_at FROM api_keys ORDER BY created_at DESC`
    );
    res.status(200).json({ keys: keys.rows });
  } catch (error) {
    next(error);
  }
});

function newApiKey() {
  const secret = `hub_${crypto.randomBytes(24).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, 12), hash: crypto.createHash('sha256').update(secret).digest('hex') };
}

usersAdminRouter.post('/api/admin/api-keys', requirePermission('settings:manage_webhooks'), async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const key = newApiKey();
    const created = await query<{ id: string }>(
      `INSERT INTO api_keys (name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [parsed.data.name, key.prefix, key.hash, req.user!.id]
    );
    await recordChange(req.user!.id, 'api_key', created.rows[0]!.id, 'created', '(nova)', key.prefix);
    res.status(201).json({ id: created.rows[0]!.id, prefix: key.prefix, secret: key.secret });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.post('/api/admin/api-keys/:id/rotate', requirePermission('settings:manage_webhooks'), async (req, res, next) => {
  try {
    const current = await query<{ prefix: string }>(`SELECT prefix FROM api_keys WHERE id = $1`, [req.params.id]);
    if (!current.rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const key = newApiKey();
    await query(`UPDATE api_keys SET prefix = $2, key_hash = $3, rotated_at = now() WHERE id = $1`, [req.params.id, key.prefix, key.hash]);
    await recordChange(req.user!.id, 'api_key', req.params.id, 'rotated', current.rows[0].prefix, key.prefix);
    res.status(200).json({ prefix: key.prefix, secret: key.secret });
  } catch (error) {
    next(error);
  }
});

usersAdminRouter.get('/api/governance/audit', requirePermission('audit:read', 'settings:manage_users', 'settings:manage_general', 'settings:manage_webhooks', 'settings:manage_security'), async (_req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      target: string;
      target_key: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      changed_at: Date;
      email: string | null;
    }>(
      `SELECT cc.id, cc.target, cc.target_key, cc.field, cc.old_value, cc.new_value, cc.changed_at, u.email
       FROM control_changes cc
       LEFT JOIN users u ON u.id = cc.changed_by
       WHERE cc.target IN ('user_role', 'tenant_settings', 'api_key')
       ORDER BY cc.changed_at DESC
       LIMIT 200`
    );
    res.status(200).json({
      records: rows.rows.map((row) => ({
        id: row.id,
        target: row.target,
        targetKey: row.target_key,
        field: row.field,
        previousValue: row.old_value,
        newValue: row.new_value,
        at: new Date(row.changed_at).toISOString(),
        actor: row.email,
      })),
    });
  } catch (error) {
    next(error);
  }
});
