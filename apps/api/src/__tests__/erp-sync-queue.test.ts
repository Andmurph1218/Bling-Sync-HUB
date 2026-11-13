import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { processErpSyncPage, readErpSyncStatus } from '../queues/erp-sync-worker.js';

function erp(): ErpConnector {
  return {
    id: 'bling',
    syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
    getStock: async () => ({ found: false, quantity: null }),
    getPrice: async () => ({ found: false, price: null }),
    listCatalogPage: async (page: number, pageSize: number) => {
      if (page === 1) return { page, pageSize, externalIds: ['1', '2'], done: false, total: 3 };
      if (page === 2) return { page, pageSize, externalIds: ['3'], done: true, total: 3 };
      return { page, pageSize, externalIds: [], done: true, total: 3 };
    },
    pullCatalogProduct: async (externalId: string) => ({
      id: Number(externalId),
      nome: `Produto ${externalId}`,
      codigo: `SKU-${externalId}`,
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
    }),
    createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
  };
}

describe('fila de sync do ERP', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';
  const saved: string[] = [];

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
      implementation: (value: string) => (value ? value.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'admin.sync@blingsync.local',
      name: 'Admin Sync',
      password: 'SenhaPessoal!2026',
      roles: ['admin'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'admin.sync@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    cookie = (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('aceita a sync na hora e continua da página gravada se o worker parar', async () => {
    const accepted = await request(app).post('/api/admin/sync-full').set('Cookie', cookie);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ accepted: true, status: 'processing' });

    const started = await request(app).get('/api/admin/sync-status').set('Cookie', cookie);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: 'processing', processed: 0, total: 0 });

    const hooks = {
      upsertProduct: async (payload: { codigo: string }) => {
        saved.push(payload.codigo);
        return { masterProductId: payload.codigo, variantIdsBySku: { [payload.codigo]: 'v' } };
      },
      scoreProduct: async () => false,
    };
    await processErpSyncPage(erp(), 1, { pageSize: 2, delayMs: 0, hooks });
    const midway = await readErpSyncStatus();
    expect(midway).toMatchObject({ status: 'processing', processed: 2, total: 3, lastCompletedPage: 1 });

    await processErpSyncPage(erp(), 1, { pageSize: 2, delayMs: 0, hooks });
    expect(saved).toEqual(['SKU-1', 'SKU-2']);

    await processErpSyncPage(erp(), 2, { pageSize: 2, delayMs: 0, hooks });
    const done = await request(app).get('/api/admin/sync-status').set('Cookie', cookie);
    expect(done.body).toMatchObject({ status: 'completed', processed: 3, total: 3, lastCompletedPage: 2 });
    expect(saved).toEqual(['SKU-1', 'SKU-2', 'SKU-3']);
  });

  it('lança a falha da página para o BullMQ repetir sem avançar o cursor', async () => {
    await query(
      `UPDATE sync_status
       SET status = 'idle', processed = 0, last_completed_page = 0, error_message = NULL
       WHERE id = 1`
    );
    const failing = erp();
    failing.listCatalogPage = async () => {
      throw new Error('erp indisponível');
    };
    await expect(processErpSyncPage(failing, 1, { pageSize: 2, delayMs: 0 })).rejects.toThrow('erp indisponível');
    const status = await readErpSyncStatus();
    expect(status.status).toBe('failed');
    expect(status.lastCompletedPage).toBe(0);
    expect(status.errorMessage).toBe('erp indisponível');
  });

  it('mantém status processing enquanto throwOnPageFailure está ativo nas tentativas intermediárias', async () => {
    await request(app).post('/api/admin/sync-full').set('Cookie', cookie);
    let failListing = true;
    const flakyErp: ErpConnector = {
      ...erp(),
      listCatalogPage: async (page: number, pageSize: number) => {
        if (failListing) throw new Error('falha_transitoria_bling');
        return { page, pageSize, externalIds: ['1'], done: true, total: 1 };
      },
    };
    const hooks = {
      upsertProduct: async (payload: { codigo: string }) => ({
        masterProductId: payload.codigo,
        variantIdsBySku: { [payload.codigo]: 'v' },
      }),
      scoreProduct: async () => false,
    };

    await expect(
      processErpSyncPage(flakyErp, 1, { pageSize: 2, delayMs: 0, hooks, throwOnPageFailure: true })
    ).rejects.toThrow('falha_transitoria_bling');

    const statusAfterRetryableError = await readErpSyncStatus();
    expect(statusAfterRetryableError.status).toBe('processing');

    failListing = false;
    await processErpSyncPage(flakyErp, 1, { pageSize: 2, delayMs: 0, hooks, throwOnPageFailure: true });
    const finalStatus = await readErpSyncStatus();
    expect(finalStatus).toMatchObject({ status: 'completed', lastCompletedPage: 1 });
  });
});
