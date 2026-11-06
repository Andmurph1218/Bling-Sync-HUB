import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setPool, DbPoolLike } from '../db/pool.js';
import { setRedis } from '../lib/redis.js';
import { UP_SQL } from '../db/migrations/1729080000001_identity-and-controls.js';
import { query } from '../db/pool.js';
import { createUser } from '../auth/service.js';
import {
  BOOTSTRAP_DEFAULT_PASSWORDS,
  evaluateLoginPassword,
  resolveBootstrapPassword,
} from '../auth/password-policy.js';

describe('P0.2 — senha padrão e troca no primeiro login', () => {
  it('recusa a senha padrão em produção e exige troca em desenvolvimento', () => {
    expect(() =>
      evaluateLoginPassword({
        nodeEnv: 'production',
        password: BOOTSTRAP_DEFAULT_PASSWORDS[0],
        mustChangePassword: false,
      })
    ).toThrow(/não é aceita fora do ambiente de desenvolvimento/);

    expect(
      evaluateLoginPassword({
        nodeEnv: 'development',
        password: BOOTSTRAP_DEFAULT_PASSWORDS[0],
        mustChangePassword: false,
      })
    ).toEqual({ mustChangePassword: true });

    expect(
      evaluateLoginPassword({
        nodeEnv: 'production',
        password: 'SenhaPessoal!2026',
        mustChangePassword: false,
      })
    ).toEqual({ mustChangePassword: false });
  });

  it('bootstrap em produção não aceita a senha padrão', () => {
    expect(() =>
      resolveBootstrapPassword({
        nodeEnv: 'production',
        envPassword: undefined,
        defaultPassword: BOOTSTRAP_DEFAULT_PASSWORDS[0],
      })
    ).toThrow(/BOOTSTRAP_\*_PASSWORD/);

    expect(
      resolveBootstrapPassword({
        nodeEnv: 'development',
        envPassword: undefined,
        defaultPassword: BOOTSTRAP_DEFAULT_PASSWORDS[0],
      }).password
    ).toBe(BOOTSTRAP_DEFAULT_PASSWORDS[0]);
  });
});

describe('P0.2 — sessão bloqueada até trocar a senha', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({
      ping: async () => 'PONG',
      quit: async () => 'OK',
    });
    await query(UP_SQL);
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('login com senha inicial abre sessão só para trocar a senha', async () => {
    await createUser({
      email: 'operador.p0@blingsync.local',
      name: 'Operador P0',
      password: 'ChangeMe!Operator2026',
      roles: ['operator'],
      mustChangePassword: true,
    });

    const login = await request(app).post('/auth/login').send({
      email: 'operador.p0@blingsync.local',
      password: 'ChangeMe!Operator2026',
    });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    const setCookie = login.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookie) {
      throw new Error('cookie de sessão ausente');
    }

    const blocked = await request(app).get('/operator/capabilities').set('Cookie', cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('password_change_required');

    const me = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const rejectedDefault = await request(app)
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'ChangeMe!Operator2026', newPassword: 'ChangeMe!Admin2026' });
    expect(rejectedDefault.status).toBe(400);

    const changed = await request(app)
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'ChangeMe!Operator2026', newPassword: 'SenhaNova!Operador1' });
    expect(changed.status).toBe(200);

    const allowed = await request(app).get('/operator/capabilities').set('Cookie', cookie);
    expect(allowed.status).toBe(200);

    const oldPassword = await request(app).post('/auth/login').send({
      email: 'operador.p0@blingsync.local',
      password: 'ChangeMe!Operator2026',
    });
    expect(oldPassword.status).toBe(401);
  });
});
