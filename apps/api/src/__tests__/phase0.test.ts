import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setPool, DbPoolLike, query } from '../db/pool.js';
import { setRedis } from '../lib/redis.js';
import { UP_SQL, DOWN_SQL } from '../db/migrations/1729080000001_identity-and-controls.js';
import { createUser } from '../auth/service.js';
import {
  decryptOAuthToken,
  encryptOAuthToken,
  hashSessionToken,
} from '../auth/crypto.js';

describe('Fase 0 — Healthcheck, Identidade (Argon2id + Sessão SHA-256), Dois Papéis e Trilha de Controle', () => {
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
    await query(DOWN_SQL);
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
    setRedis(null);
  });

  it('1. GET /health responde 200 quando PostgreSQL e Redis estão operacionais e 503 quando degradado', async () => {
    const resOk = await request(app).get('/health');
    expect(resOk.status).toBe(200);
    expect(resOk.body.status).toBe('ok');
    expect(resOk.body.dependencies.postgres.ok).toBe(true);
    expect(resOk.body.dependencies.redis.ok).toBe(true);

    setRedis({
      ping: async () => {
        throw new Error('Redis connection refused');
      },
      quit: async () => 'OK',
    });

    const resDegraded = await request(app).get('/health');
    expect(resDegraded.status).toBe(503);
    expect(resDegraded.body.status).toBe('degraded');
    expect(resDegraded.body.dependencies.redis.ok).toBe(false);

    setRedis({
      ping: async () => 'PONG',
      quit: async () => 'OK',
    });
  });

  it('2. Login de dois papéis distintos (operator e fiscal_approver) grava apenas o SHA-256 do token opaco em sessions e isola permissões', async () => {
    const operatorUser = await createUser({
      email: 'operador@blingsync.local',
      name: 'Operador Catálogo',
      password: 'SenhaForte!Operador123',
      roles: ['operator'],
    });

    const fiscalUser = await createUser({
      email: 'fiscal@blingsync.local',
      name: 'Aprovador Fiscal',
      password: 'SenhaForte!Fiscal456',
      roles: ['fiscal_approver'],
    });

    expect(operatorUser.roles).toEqual(['operator']);
    expect(fiscalUser.roles).toEqual(['fiscal_approver']);

    // Senha incorreta deve retornar 401
    const badLogin = await request(app).post('/auth/login').send({
      email: 'operador@blingsync.local',
      password: 'senha-errada',
    });
    expect(badLogin.status).toBe(401);

    // Login papel 1: operator
    const opLogin = await request(app).post('/auth/login').send({
      email: 'operador@blingsync.local',
      password: 'SenhaForte!Operador123',
    });
    expect(opLogin.status).toBe(200);
    expect(opLogin.body.user.roles).toEqual(['operator']);
    const opCookies = opLogin.headers['set-cookie'];
    expect(opCookies).toBeDefined();
    const opCookieHeader = Array.isArray(opCookies) ? opCookies[0] : opCookies;
    expect(opCookieHeader).toContain('bling_hub_sid=');
    expect(opCookieHeader).toContain('HttpOnly');

    const opOpaqueToken = opCookieHeader.split('bling_hub_sid=')[1].split(';')[0];
    const expectedHash = hashSessionToken(opOpaqueToken);

    // Verifica que o banco guarda apenas o hash SHA-256 e nunca o token em texto puro
    const sessionCheck = await query<{ token_hash: string }>(
      `SELECT token_hash FROM sessions WHERE user_id = $1`,
      [operatorUser.id]
    );
    expect(sessionCheck.rows).toHaveLength(1);
    expect(sessionCheck.rows[0]?.token_hash).toBe(expectedHash);
    expect(sessionCheck.rows[0]?.token_hash).not.toBe(opOpaqueToken);

    // Login papel 2: fiscal_approver
    const fiscalLogin = await request(app).post('/auth/login').send({
      email: 'fiscal@blingsync.local',
      password: 'SenhaForte!Fiscal456',
    });
    expect(fiscalLogin.status).toBe(200);
    expect(fiscalLogin.body.user.roles).toEqual(['fiscal_approver']);
    const fiscalCookies = fiscalLogin.headers['set-cookie'];
    const fiscalCookieHeader = Array.isArray(fiscalCookies) ? fiscalCookies[0] : fiscalCookies;

    // Operator acessa rota de operator (200), mas recebe 403 em rota fiscal e 403 em controle admin
    const opSelf = await request(app).get('/auth/me').set('Cookie', opCookieHeader);
    expect(opSelf.status).toBe(200);
    expect(opSelf.body.user.email).toBe('operador@blingsync.local');

    const opCanOperate = await request(app)
      .get('/operator/capabilities')
      .set('Cookie', opCookieHeader);
    expect(opCanOperate.status).toBe(200);

    const opBlockedFiscal = await request(app)
      .get('/fiscal/capabilities')
      .set('Cookie', opCookieHeader);
    expect(opBlockedFiscal.status).toBe(403);

    const opBlockedAdminControl = await request(app)
      .put('/admin/controls/warehouses/DEP-01')
      .set('Cookie', opCookieHeader)
      .send({ name: 'Depósito Principal', role: 'seller', include_in_push: true });
    expect(opBlockedAdminControl.status).toBe(403);

    // Fiscal Approver acessa rota fiscal (200), mas recebe 403 em rota de operator e 403 em controle admin
    const fiscalCanApprove = await request(app)
      .get('/fiscal/capabilities')
      .set('Cookie', fiscalCookieHeader);
    expect(fiscalCanApprove.status).toBe(200);

    const fiscalBlockedOperator = await request(app)
      .get('/operator/capabilities')
      .set('Cookie', fiscalCookieHeader);
    expect(fiscalBlockedOperator.status).toBe(403);

    const fiscalBlockedAdminControl = await request(app)
      .put('/admin/controls/sync-owner/mercadolivre')
      .set('Cookie', fiscalCookieHeader)
      .send({ stock_price: 'hub', content: 'hub' });
    expect(fiscalBlockedAdminControl.status).toBe(403);
  });

  it('3. Admin altera depósito e dono do estoque gravando trilha obrigatória em control_changes na mesma transação', async () => {
    const adminUser = await createUser({
      email: 'admin@blingsync.local',
      name: 'Administrador Hub',
      password: 'SenhaForte!Admin789',
      roles: ['admin'],
    });

    const adminLogin = await request(app).post('/auth/login').send({
      email: 'admin@blingsync.local',
      password: 'SenhaForte!Admin789',
    });
    expect(adminLogin.status).toBe(200);
    const adminCookies = adminLogin.headers['set-cookie'];
    const adminCookieHeader = Array.isArray(adminCookies) ? adminCookies[0] : adminCookies;

    // Regra: depósito ml_full nunca pode ter include_in_push = true
    const invalidFullPush = await request(app)
      .put('/admin/controls/warehouses/DEP-FULL-ML')
      .set('Cookie', adminCookieHeader)
      .send({ name: 'Full Mercado Livre', role: 'ml_full', include_in_push: true });
    expect(invalidFullPush.status).toBe(400);

    // Classifica depósito seller com include_in_push = true
    const validWarehouse = await request(app)
      .put('/admin/controls/warehouses/DEP-SELLER-01')
      .set('Cookie', adminCookieHeader)
      .send({ name: 'Depósito Vendedor SP', role: 'seller', include_in_push: true });
    expect(validWarehouse.status).toBe(200);
    expect(validWarehouse.body.warehouse).toEqual({
      bling_warehouse_id: 'DEP-SELLER-01',
      name: 'Depósito Vendedor SP',
      role: 'seller',
      include_in_push: true,
    });

    // Verifica linhas gravadas em control_changes
    const changesRes = await query<{
      target: string;
      target_key: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      origin: string;
      changed_by: string;
    }>(
      `SELECT target, target_key, field, old_value, new_value, origin, changed_by
       FROM control_changes
       WHERE target_key = 'DEP-SELLER-01'
       ORDER BY field ASC`
    );

    expect(changesRes.rows).toHaveLength(2);
    expect(changesRes.rows[0]).toEqual({
      target: 'stock_warehouse',
      target_key: 'DEP-SELLER-01',
      field: 'include_in_push',
      old_value: null,
      new_value: 'true',
      origin: 'admin',
      changed_by: adminUser.id,
    });
    expect(changesRes.rows[1]).toEqual({
      target: 'stock_warehouse',
      target_key: 'DEP-SELLER-01',
      field: 'role',
      old_value: null,
      new_value: 'seller',
      origin: 'admin',
      changed_by: adminUser.id,
    });
  });

  it('4. Criptografia AES-256-GCM para oauth_tokens preserva sigilo e integridade', () => {
    const rawAccessToken = 'bling_access_token_secret_123456';
    const encrypted = encryptOAuthToken(rawAccessToken);
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(encrypted.toString('utf8')).not.toContain(rawAccessToken);

    const decrypted = decryptOAuthToken(encrypted);
    expect(decrypted).toBe(rawAccessToken);
  });
});
