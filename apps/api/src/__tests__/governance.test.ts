import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DbPoolLike, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import { hasPermission } from '../auth/permissions.js';
import { hotp, verifyTotp } from '../auth/totp.js';

async function loginCookie(app: ReturnType<typeof createApp>, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  const header = res.headers['set-cookie'];
  return (Array.isArray(header) ? header[0] : header)!;
}

describe('governança de papéis e configurações', () => {
  let poolInstance: DbPoolLike;
  const app = createApp();
  let adminCookie = '';

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'admin_gov@blingsync.local',
      name: 'Admin Governança',
      password: 'Password!AdminGov1',
      roles: ['admin'],
    });
    await createUser({
      email: 'op_gov@blingsync.local',
      name: 'Operador Governança',
      password: 'Password!OpGov1',
      roles: ['operator'],
    });
    adminCookie = await loginCookie(app, 'admin_gov@blingsync.local', 'Password!AdminGov1');
  });

  afterAll(async () => {
    await poolInstance.end();
    setPool(null);
  });

  it('libera permissão fiscal só para quem tem o papel correspondente', () => {
    expect(hasPermission({ roles: ['fiscal_approver'], permissions: ['fiscal:approve_ean', 'fiscal:approve_ncm', 'audit:read'] }, 'fiscal:approve_ean')).toBe(true);
    expect(hasPermission({ roles: ['operator'], permissions: ['product:read', 'product:write', 'push:simulate'] }, 'push:execute')).toBe(false);
    expect(hasPermission({ roles: ['admin'], permissions: [] }, 'settings:manage_users')).toBe(true);
  });

  it('confere um código TOTP gerado para o mesmo segredo', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const code = hotp(secret, Math.floor(Date.now() / 30_000));
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('cria papel customizado, atribui e registra control_changes', async () => {
    const created = await request(app)
      .post('/api/admin/roles')
      .set('Cookie', adminCookie)
      .send({ name: 'Aprovador de EAN', permissions: ['fiscal:approve_ean'] });
    expect(created.status).toBe(201);

    const people = await request(app).get('/api/admin/users').set('Cookie', adminCookie);
    expect(people.status).toBe(200);
    const operator = people.body.users.find((user: { email: string }) => user.email === 'op_gov@blingsync.local');
    const updated = await request(app)
      .patch(`/api/admin/users/${operator.id}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleIds: [created.body.id] });
    expect(updated.status).toBe(200);

    const audit = await request(app).get('/api/governance/audit').set('Cookie', adminCookie);
    expect(audit.status).toBe(200);
    expect(audit.body.records.some((row: { target: string; field: string }) => row.target === 'user_role' && row.field === 'roles')).toBe(true);

    const denied = await request(app).get('/api/admin/users').set('Cookie', await loginCookie(app, 'op_gov@blingsync.local', 'Password!OpGov1'));
    expect(denied.status).toBe(403);
  });
});
