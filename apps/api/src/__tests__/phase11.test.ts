import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import { evaluateProductNve } from '../engines/nve.js';
import { evaluateProductGve } from '../engines/gve.js';
import { resolvePlatformItemPire } from '../engines/pire.js';

describe('Fase 11 — Matching e Fiscal no Dashboard (Dois Usuários Confirmam o Mesmo NCM via API, Fila de EAN e Fila de Matching)', () => {
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
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. Critério de saída: Dois usuários distintos com papel fiscal_approver confirmam o mesmo NCM via rota do Dashboard (/api/fiscal/ncm/:suggestionId/confirm)', async () => {
    const operatorUser = await createUser({
      email: 'op_dash@blingsync.local',
      name: 'Operador Dashboard',
      password: 'Password!OpDash1',
      roles: ['operator'],
    });
    const fiscalUser1 = await createUser({
      email: 'fiscal_dash1@blingsync.local',
      name: 'Aprovador Fiscal 1',
      password: 'Password!FiscalDash1',
      roles: ['fiscal_approver'],
    });
    const fiscalUser2 = await createUser({
      email: 'fiscal_dash2@blingsync.local',
      name: 'Aprovador Fiscal 2',
      password: 'Password!FiscalDash2',
      roles: ['fiscal_approver'],
    });

    const loginOp = await request(app).post('/auth/login').send({
      email: operatorUser.email,
      password: 'Password!OpDash1',
    });
    const opCookie = (Array.isArray(loginOp.headers['set-cookie'])
      ? loginOp.headers['set-cookie'][0]
      : loginOp.headers['set-cookie'])!;

    const loginF1 = await request(app).post('/auth/login').send({
      email: fiscalUser1.email,
      password: 'Password!FiscalDash1',
    });
    const f1Cookie = (Array.isArray(loginF1.headers['set-cookie'])
      ? loginF1.headers['set-cookie'][0]
      : loginF1.headers['set-cookie'])!;

    const loginF2 = await request(app).post('/auth/login').send({
      email: fiscalUser2.email,
      password: 'Password!FiscalDash2',
    });
    const f2Cookie = (Array.isArray(loginF2.headers['set-cookie'])
      ? loginF2.headers['set-cookie'][0]
      : loginF2.headers['set-cookie'])!;

    // Cria produto sem NCM no Bling e gera sugestão 9617.00.10 pelo motor NVE
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato, ncm)
       VALUES ('11001', 'GAR-DASH-NCM', 'Garrafa Térmica Dashboard NCM', 'P', 'S', NULL)
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean)
       VALUES ($1, 'GAR-DASH-NCM', true, 'S', 99.90, NULL)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    const nveReport = await evaluateProductNve(masterId, [], {
      platform: 'mercadolivre',
      rawNcm: '9617.00.10',
    });
    const suggestionId = nveReport.suggestionCreatedId!;
    expect(suggestionId).toBeDefined();

    // Operator tentando aprovar NCM recebe 403 Forbidden
    const opForbidden = await request(app)
      .post(`/api/fiscal/ncm/${suggestionId}/confirm`)
      .set('Cookie', opCookie)
      .send({ note: 'Tentativa sem papel fiscal' });
    expect(opForbidden.status).toBe(403);

    // 1º usuário fiscal_approver (fiscalUser1) confirma a 1ª etapa
    const firstConfirm = await request(app)
      .post(`/api/fiscal/ncm/${suggestionId}/confirm`)
      .set('Cookie', f1Cookie)
      .send({ note: '1ª revisão conferida no cadastro do fornecedor.' });
    expect(firstConfirm.status).toBe(200);
    expect(firstConfirm.body.status).toBe('pending_second');

    // Se fiscalUser1 tentar confirmar a 2ª etapa sozinho, recebe 409 Conflict
    const selfSecondConfirm = await request(app)
      .post(`/api/fiscal/ncm/${suggestionId}/confirm`)
      .set('Cookie', f1Cookie)
      .send({ note: 'Tentativa do mesmo usuário na 2ª revisão.' });
    expect(selfSecondConfirm.status).toBe(409);

    // 2º usuário fiscal_approver (fiscalUser2) confirma a 2ª etapa com nota de TIPI
    const secondConfirm = await request(app)
      .post(`/api/fiscal/ncm/${suggestionId}/confirm`)
      .set('Cookie', f2Cookie)
      .send({
        note: 'Consulta TIPI Capítulo 96, posição 9617.00.10: Garrafas térmicas e recipientes isotérmicos.',
      });
    expect(secondConfirm.status).toBe(200);
    expect(secondConfirm.body).toEqual({
      status: 'approved',
      masterProductId: masterId,
      approvedNcmDigits: '96170010',
    });

    // Consulta rota de listagem e auditoria de NCM no dashboard
    const ncmListRes = await request(app)
      .get('/api/fiscal/ncm/suggestions')
      .set('Cookie', f2Cookie);
    expect(ncmListRes.status).toBe(200);
    expect(ncmListRes.body.suggestions[0]?.status).toBe('approved');
    expect(ncmListRes.body.suggestions[0]?.first_review_by).toBe(fiscalUser1.id);
    expect(ncmListRes.body.suggestions[0]?.second_review_by).toBe(fiscalUser2.id);
    expect(ncmListRes.body.auditLog.length).toBeGreaterThanOrEqual(1);

    // Também testa fila de aprovação humana de EAN (/api/fiscal/ean/pending e /api/fiscal/ean/:id/review)
    await evaluateProductGve(masterId, [
      {
        variant_id: variantId,
        platform: 'mercadolivre',
        external_ean: '7891234567895',
      },
    ]);

    const eanPendingList = await request(app)
      .get('/api/fiscal/ean/pending')
      .set('Cookie', f1Cookie);
    expect(eanPendingList.status).toBe(200);
    expect(eanPendingList.body.pendingEans).toHaveLength(1);
    const pendingEanId = eanPendingList.body.pendingEans[0]!.id as string;

    const eanApproveRes = await request(app)
      .post(`/api/fiscal/ean/${pendingEanId}/review`)
      .set('Cookie', f1Cookie)
      .send({ decision: 'approve' });
    expect(eanApproveRes.status).toBe(200);
    expect(eanApproveRes.body.status).toBe('approved');
    expect(eanApproveRes.body.ean).toBe('7891234567895');

    // Testa também fila de Matching (/api/matching/queue e /api/matching/resolve) e Overview (/api/dashboard/overview)
    await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platform_product_id: 'NS-DASH-11001',
      title: 'Garrafa Avulsa Sugestão',
      skus: ['GAR-DASH-NCM'],
      eans: [],
    });

    const matchQueueRes = await request(app)
      .get('/api/matching/queue')
      .set('Cookie', opCookie);
    expect(matchQueueRes.status).toBe(200);
    expect(matchQueueRes.body.pendingQueue).toHaveLength(1);

    const resolveMatchRes = await request(app)
      .post('/api/matching/resolve')
      .set('Cookie', opCookie)
      .send({
        platform: 'nuvemshop',
        platformProductId: 'NS-DASH-11001',
        action: 'confirm',
        masterProductId: masterId,
      });
    expect(resolveMatchRes.status).toBe(200);
    expect(resolveMatchRes.body.resolution.itemStatus).toBe('linked');

    const overviewRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Cookie', opCookie);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.queues.matchingPending).toBe(0);
    expect(overviewRes.body.queues.eanPending).toBe(0);
    expect(overviewRes.body.queues.ncmPending).toBe(0);
  });
});
