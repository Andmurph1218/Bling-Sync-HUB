import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  BlingQuotaExhaustedError,
  BlingRateLimiter,
} from '../connectors/bling-rate-limiter.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import {
  BlingConnector,
  HttpTransportRequest,
  MercadoLivreConnector,
  NuvemshopConnector,
} from '../connectors/connectors.js';

describe('Fase 2 — Conectores, Rate Limiter Global (3 req/s + 120k/dia) e OAuth Single-Flight', () => {
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

  it('1. Dois jobs juntos (stock_sync e delta_enrich) não passam de 3 req por janela e respeitam fila de prioridade', async () => {
    const windowMs = 250;
    const limiter = new BlingRateLimiter({
      maxPerSecond: 3,
      windowMs,
    });

    const executionOrder: string[] = [];
    const grantedTimestamps: number[] = [];

    // Dispara 4 chamadas de delta_enrich (prioridade 4) e 4 de stock_sync (prioridade 2) + 1 de webhook_p1_push_stock (prioridade 1)
    const jobDelta = [1, 2, 3, 4].map((i) =>
      limiter.schedule('delta_enrich', async (ts) => {
        grantedTimestamps.push(ts);
        executionOrder.push(`delta_${i}`);
      })
    );

    const jobStock = [1, 2, 3, 4].map((i) =>
      limiter.schedule('stock_sync', async (ts) => {
        grantedTimestamps.push(ts);
        executionOrder.push(`stock_${i}`);
      })
    );

    const jobUrgentP1 = limiter.schedule('webhook_p1_push_stock', async (ts) => {
      grantedTimestamps.push(ts);
      executionOrder.push('p1_urgent');
    });

    await Promise.all([...jobDelta, ...jobStock, jobUrgentP1]);

    expect(grantedTimestamps).toHaveLength(9);

    // Verifica que em NENHUM intervalo de tamanho windowMs houve mais de 3 chamadas concedidas
    for (let i = 0; i < grantedTimestamps.length; i++) {
      const tStart = grantedTimestamps[i]!;
      const countInWindow = grantedTimestamps.filter(
        (t) => t >= tStart && t < tStart + windowMs - 10
      ).length;
      expect(countInWindow).toBeLessThanOrEqual(3);
    }

    // As 3 primeiras saem na janela 0; na janela seguinte, p1_urgent e stock_sync saem antes do restante de delta_enrich
    const indexP1 = executionOrder.indexOf('p1_urgent');
    const indexLastDelta = executionOrder.indexOf('delta_4');
    expect(indexP1).toBeLessThan(indexLastDelta);
  });

  it('2. Repartição da cota diária de 120.000: full_enrich pausa em 96.000, jobs não-P1 param em 108.000 e reserva P1 segue até 120.000', async () => {
    const limiter = new BlingRateLimiter({ maxPerSecond: 100, windowMs: 100 });

    limiter.setDailyTotalUsedForTest(96_000);

    // Em 96.000: full_enrich deve parar para continuar no dia seguinte pelo cursor
    await expect(limiter.acquire('full_enrich')).rejects.toThrowError(
      BlingQuotaExhaustedError
    );

    // Mas delta_enrich e stock_sync ainda podem rodar entre 96.000 e 108.000
    await expect(limiter.acquire('delta_enrich')).resolves.toBeTypeOf('number');

    // Em 108.000: stock_sync, price_check e delta_enrich param para preservar as 12.000 de reserva P1
    limiter.setDailyTotalUsedForTest(108_000);
    await expect(limiter.acquire('stock_sync')).rejects.toThrowError(
      BlingQuotaExhaustedError
    );
    await expect(limiter.acquire('price_check')).rejects.toThrowError(
      BlingQuotaExhaustedError
    );

    // A reserva P1 (webhook_p1_push_stock) e token continuam operando até 120.000
    await expect(limiter.acquire('webhook_p1_push_stock')).resolves.toBeTypeOf('number');
  });

  it('3. O refresh do token em oauth_tokens é single-flight: 6 chamadas concorrentes disparam apenas 1 requisição a /oauth/token e rotacionam o refresh token', async () => {
    const tokenManager = new OAuthTokenManager({ expiryBufferMs: 60_000 });

    // Grava token do Bling já expirado (há 5 minutos)
    await tokenManager.upsertToken({
      provider: 'bling',
      accessToken: 'expired_access_token_v1',
      refreshToken: 'initial_refresh_token_v1',
      expiresAt: new Date(Date.now() - 5 * 60_000),
    });

    let refreshHttpCalls = 0;
    const refreshFn = async (currentRefreshToken: string) => {
      refreshHttpCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      expect(currentRefreshToken).toBe('initial_refresh_token_v1');
      return {
        accessToken: 'fresh_access_token_v2',
        refreshToken: 'rotated_refresh_token_v2',
        expiresInSeconds: 21_600,
      };
    };

    // 6 workers concorrentes pedem token válido ao mesmo tempo
    const tokens = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(() =>
        tokenManager.getValidAccessToken('bling', refreshFn)
      )
    );

    expect(refreshHttpCalls).toBe(1);
    expect(tokens).toEqual([
      'fresh_access_token_v2',
      'fresh_access_token_v2',
      'fresh_access_token_v2',
      'fresh_access_token_v2',
      'fresh_access_token_v2',
      'fresh_access_token_v2',
    ]);

    // Confirma que tanto o access_token quanto o refresh_token foram rotacionados e criptografados no banco
    const storedAfter = await tokenManager.getToken('bling');
    expect(storedAfter?.accessToken).toBe('fresh_access_token_v2');
    expect(storedAfter?.refreshToken).toBe('rotated_refresh_token_v2');
    expect(storedAfter?.rotatedAt).toBeInstanceOf(Date);
  });

  it('4. BlingConnector grava hub_writes em applyToBling, recupera de 401 com single-flight e salva cursor em sync_cursors', async () => {
    const tokenManager = new OAuthTokenManager();
    await tokenManager.upsertToken({
      provider: 'bling',
      accessToken: 'token_that_will_401',
      refreshToken: 'refresh_before_401',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    let refreshCalls = 0;
    const executedRequests: HttpTransportRequest[] = [];

    const connector = new BlingConnector({
      limiter: new BlingRateLimiter({ maxPerSecond: 10, windowMs: 100 }),
      tokenManager,
      refreshFn: async () => {
        refreshCalls += 1;
        return {
          accessToken: 'token_after_401_recovery',
          refreshToken: 'refresh_after_401',
          expiresInSeconds: 3600,
        };
      },
      transport: async <T>(req: HttpTransportRequest) => {
        executedRequests.push(req);
        if (req.headers.Authorization === 'Bearer token_that_will_401') {
          return {
            status: 401,
            headers: {},
            data: { error: 'invalid_token' } as unknown as T,
          };
        }
        return {
          status: 200,
          headers: {},
          data: { ok: true } as unknown as T,
        };
      },
    });

    const writeRes = await connector.applyToBling('100101', 'delta_enrich', {
      marca: 'ThermoHub Pro',
      pesoLiquido: 0.31,
      pesoBruto: 0.36,
    });

    expect(writeRes.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(executedRequests).toHaveLength(2);

    const hubWriteRow = await query<{
      bling_id: string;
      changed_fields: string[];
    }>(
      `SELECT bling_id, changed_fields FROM hub_writes WHERE request_id = $1`,
      [writeRes.requestId]
    );
    expect(hubWriteRow.rows[0]?.bling_id).toBe('100101');
    expect(hubWriteRow.rows[0]?.changed_fields).toEqual([
      'marca',
      'pesoLiquido',
      'pesoBruto',
    ]);

    await connector.saveSyncCursor('full_enrich', 'page:42');
    const cursorRow = await query<{ cursor_value: string }>(
      `SELECT cursor_value FROM sync_cursors WHERE job_name = 'full_enrich'`
    );
    expect(cursorRow.rows[0]?.cursor_value).toBe('page:42');
  });

  it('5. MercadoLivreConnector pula PUT de estoque em meli_facility puro e faz 1 retry relendo x-version em caso de 409 Conflict; NuvemshopConnector envia measures isolado', async () => {
    const tokenManager = new OAuthTokenManager();
    await tokenManager.upsertToken({
      provider: 'mercadolivre',
      accessToken: 'ml_token_valid',
      refreshToken: 'ml_refresh_valid',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await tokenManager.upsertToken({
      provider: 'nuvemshop',
      accessToken: 'ns_permanent_token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 365 * 86400_000),
    });

    let stockGetCalls = 0;
    let stockPutCalls = 0;
    const putHeadersSent: string[] = [];

    const mlConnector = new MercadoLivreConnector({
      tokenManager,
      refreshFn: async () => ({
        accessToken: 'ml_token_valid',
        refreshToken: 'ml_refresh_valid',
        expiresInSeconds: 3600,
      }),
      transport: async <T>(req: HttpTransportRequest) => {
        if (req.url.endsWith('/user-products/MLBU-ONLY-FULL/stock')) {
          return {
            status: 200,
            headers: { 'x-version': '4' },
            data: {
              id: 'MLBU-ONLY-FULL',
              locations: [{ type: 'meli_facility', quantity: 50 }],
            } as unknown as T,
          };
        }

        if (req.method === 'GET' && req.url.endsWith('/user-products/MLBU-COEXIST/stock')) {
          stockGetCalls += 1;
          const version = stockGetCalls === 1 ? '11' : '12';
          return {
            status: 200,
            headers: { 'x-version': version },
            data: {
              id: 'MLBU-COEXIST',
              locations: [
                {
                  type: 'seller_warehouse',
                  store_id: 'ST-1',
                  network_node_id: 'ND-1',
                  quantity: 5,
                },
                {
                  type: 'meli_facility',
                  quantity: 30,
                },
              ],
            } as unknown as T,
          };
        }

        if (
          req.method === 'PUT' &&
          req.url.endsWith('/user-products/MLBU-COEXIST/stock/type/seller_warehouse')
        ) {
          stockPutCalls += 1;
          putHeadersSent.push(req.headers['X-Version'] ?? '');
          if (stockPutCalls === 1) {
            return { status: 409, headers: {}, data: {} as unknown as T };
          }
          return { status: 200, headers: {}, data: {} as unknown as T };
        }

        throw new Error(`URL inesperada: ${req.method} ${req.url}`);
      },
    });

    // Anúncio só Full não recebe PUT
    const fullOnlyResult = await mlConnector.updateSellerWarehouseStock(
      'MLBU-ONLY-FULL',
      10
    );
    expect(fullOnlyResult).toEqual({ outcome: 'skipped', reason: 'ml_full' });
    expect(stockPutCalls).toBe(0);

    // Anúncio coexistente: 1º PUT com X-Version 11 toma 409, relê X-Version 12 e conclui no 2º PUT
    const coexistResult = await mlConnector.updateSellerWarehouseStock(
      'MLBU-COEXIST',
      15.9
    );
    expect(coexistResult).toEqual({
      outcome: 'updated',
      usedVersion: 12,
      retriedOn409: true,
    });
    expect(putHeadersSent).toEqual(['11', '12']);

    // Nuvemshop: PATCH /products/{id}/variants só com medidas
    let nsPatchReq: HttpTransportRequest | null = null;
    const nsConnector = new NuvemshopConnector({
      storeId: '441100',
      tokenManager,
      transport: async <T>(req: HttpTransportRequest) => {
        nsPatchReq = req;
        return { status: 200, headers: {}, data: [] as unknown as T };
      },
    });

    await nsConnector.patchVariantMeasures('991122', {
      id: 55001,
      weight: '0.310',
      width: '7.50',
      height: '24.00',
      depth: '7.50',
    });

    expect(nsPatchReq).not.toBeNull();
    expect(nsPatchReq!.method).toBe('PATCH');
    expect(nsPatchReq!.url).toContain('/441100/products/991122/variants');
    expect(nsPatchReq!.body).toEqual([
      {
        id: 55001,
        weight: '0.310',
        width: '7.50',
        height: '24.00',
        depth: '7.50',
      },
    ]);
  });
});
