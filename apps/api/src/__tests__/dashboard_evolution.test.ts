import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DbPoolLike, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import { runFullProductCatalogPipeline } from '../orchestrator/pipeline.js';
import { resolvePlatformItemPire } from '../engines/pire.js';
import { BLING_SIMPLE_PRODUCT_FIXTURE, BLING_STOCK_BALANCES_TWO_SELLERS_FIXTURE } from '../contracts/fixtures/bling.fixtures.js';

const SIMPLE_PRODUCT = BLING_SIMPLE_PRODUCT_FIXTURE.data;
const SIMPLE_BALANCE = BLING_STOCK_BALANCES_TWO_SELLERS_FIXTURE.data[0]!;

async function loginCookie(app: ReturnType<typeof createApp>, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  const header = res.headers['set-cookie'];
  return (Array.isArray(header) ? header[0] : header)!;
}

describe('Evolução do Dashboard (docs/bling_sync_hub_evolucao_dashboard.md — Camada Consolidada, 10 Motores, 10 Indicadores, Simulador, Ficha Única e Auditoria)', () => {
  let poolInstance: DbPoolLike;
  const app = createApp();
  let adminCookie = '';
  let operatorCookie = '';

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
      email: 'admin_evol@blingsync.local',
      name: 'Admin Evolução',
      password: 'Password!AdminEvol1',
      roles: ['admin'],
    });
    await createUser({
      email: 'op_evol@blingsync.local',
      name: 'Operador Evolução',
      password: 'Password!OpEvol1',
      roles: ['operator'],
    });
    adminCookie = await loginCookie(app, 'admin_evol@blingsync.local', 'Password!AdminEvol1');
    operatorCookie = await loginCookie(app, 'op_evol@blingsync.local', 'Password!OpEvol1');

    await runFullProductCatalogPipeline({
      blingPayload: SIMPLE_PRODUCT,
      stockBalancesBySku: {
        [SIMPLE_PRODUCT.codigo]: SIMPLE_BALANCE,
      },
    });
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('0. Endpoints do Dashboard exigem sessão (401 sem login) e respeitam papel (auditoria bloqueada para operador)', async () => {
    const paths = [
      '/api/dashboard/operational-state',
      '/api/dashboard/motors-diagnostic',
      '/api/dashboard/admin-indicators',
      '/api/dashboard/pendings',
      `/api/dashboard/products/${SIMPLE_PRODUCT.id}`,
      '/api/dashboard/margin',
      '/api/dashboard/audit-trail',
      '/api/dashboard/push-attempts',
    ];
    for (const p of paths) {
      const res = await request(app).get(p);
      expect(res.status).toBe(401);
    }
    const simNoAuth = await request(app).post('/api/dashboard/simulate-sync');
    expect(simNoAuth.status).toBe(401);

    const auditAsOperator = await request(app)
      .get('/api/dashboard/audit-trail')
      .set('Cookie', operatorCookie);
    expect(auditAsOperator.status).toBe(403);
  });

  it('1. GET /api/dashboard/operational-state retorna os 4 KPIs principais com definição formal, fonte, período e estado dos canais', async () => {
    const res = await request(app).get('/api/dashboard/operational-state').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.calculatedAt).toBeDefined();
    expect(res.body.kpis.monitoredProducts.value).toBeGreaterThanOrEqual(1);
    expect(res.body.kpis.monitoredProducts.source).toContain('master_products');
    expect(res.body.kpis.readyToPublish.definition).toBeDefined();
    expect(res.body.kpis.actionPendings.definition).toBeDefined();
    expect(res.body.kpis.syncFailures.definition).toBeDefined();
    expect(res.body.channels.syncOwners).toHaveLength(2);
  });

  it('2. GET /api/dashboard/motors-diagnostic entrega a estrutura padronizada para todos os 10 motores (Seção 6)', async () => {
    const res = await request(app).get('/api/dashboard/motors-diagnostic').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.motors.map((m: { motor: string }) => m.motor)).toEqual([
      'PIRE', 'VIR', 'GVE', 'NVE', 'CQS', 'IQRE', 'CRE', 'APE', 'WIG', 'DLM',
    ]);
    for (const motor of res.body.motors) {
      expect(motor.operationalExplanation).toBeTruthy();
      expect(Array.isArray(motor.evidencesUsed)).toBe(true);
      expect(motor.ruleApplied).toBeTruthy();
      expect(motor.recommendedNextAction).toBeTruthy();
      expect(motor.executionId).toBeTruthy();
    }
  });

  it('3. GET /api/dashboard/admin-indicators calcula os 10 Indicadores Administrativos com fórmula, fonte e período (Seção 9)', async () => {
    const res = await request(app).get('/api/dashboard/admin-indicators').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.indicators).toHaveLength(10);
    for (const ind of res.body.indicators) {
      expect(ind.value).toBeTruthy();
      expect(ind.definition).toBeTruthy();
      expect(ind.formula).toBeTruthy();
      expect(ind.source).toBeTruthy();
      expect(ind.period).toBeTruthy();
    }
    const resolution = res.body.indicators.find((i: { code: string }) => i.code === 'tempo_medio_resolucao');
    expect(resolution.value).not.toBe('Medição ativa nas filas');
  });

  it('4. Ficha Única, Simulador (sem escrita externa), Margem, Auditoria e Histórico de Publicações operam sobre dados reais', async () => {
    const prodRes = await request(app)
      .get(`/api/dashboard/products/${SIMPLE_PRODUCT.id}`)
      .set('Cookie', adminCookie);
    expect(prodRes.status).toBe(200);
    expect(prodRes.body.product.bling_sku).toBe(SIMPLE_PRODUCT.codigo);
    expect(prodRes.body.variants.length).toBeGreaterThanOrEqual(1);

    const simRes = await request(app).post('/api/dashboard/simulate-sync').set('Cookie', operatorCookie);
    expect(simRes.status).toBe(200);
    expect(simRes.body.externalWritesPerformed).toBe(0);
    expect(simRes.body.summary.totalProductsAnalyzed).toBeGreaterThanOrEqual(1);
    expect(simRes.body.protectedBlingFields.length).toBeGreaterThanOrEqual(5);

    const marginRes = await request(app).get('/api/dashboard/margin').set('Cookie', adminCookie);
    expect(marginRes.status).toBe(200);
    expect(marginRes.body.formulaUsed).toContain('Margem Bruta Simplificada');
    expect(marginRes.body.items.length).toBeGreaterThanOrEqual(1);

    const auditRes = await request(app).get('/api/dashboard/audit-trail').set('Cookie', adminCookie);
    expect(auditRes.status).toBe(200);
    expect(Array.isArray(auditRes.body.records)).toBe(true);

    const pushRes = await request(app).get('/api/dashboard/push-attempts').set('Cookie', adminCookie);
    expect(pushRes.status).toBe(200);
    expect(pushRes.body.replayEnabled).toBe(false);
    expect(Array.isArray(pushRes.body.attempts)).toBe(true);
  });

  it('5. GET /api/matching/queue devolve itens normalizados com dados do anúncio e do candidato no Bling', async () => {
    await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platform_product_id: 'NS-EVOL-1',
      title: 'Produto Sugestão Evolução',
      skus: [SIMPLE_PRODUCT.codigo],
      eans: [],
    });

    const res = await request(app).get('/api/matching/queue').set('Cookie', operatorCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pendingQueue)).toBe(true);
    expect(res.body.items.length).toBe(res.body.pendingQueue.length);
    const item = res.body.items.find((i: { platformProductId: string }) => i.platformProductId === 'NS-EVOL-1');
    expect(item).toBeDefined();
    expect(item.channel.title).toBeTruthy();
    expect(item.candidate?.blingSku).toBe(SIMPLE_PRODUCT.codigo);
  });
});
