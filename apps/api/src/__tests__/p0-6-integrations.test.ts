import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { CATALOG_MODE, isOrderOrInvoiceEvent } from '../connectors/strategy/catalog-mode.js';
import { loadConnectors } from '../connectors/load.js';
import { createErpConnector, createMarketplaceConnector, resolveInstallStatus } from '../connectors/strategy/factory.js';
import { getPublicBaseUrl, webhookUrl } from '../config/public-url.js';
import { UP_SQL as IDENTITY_SQL } from '../db/migrations/1729080000001_identity-and-controls.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { setRedis } from '../lib/redis.js';

describe('P0.6 — fábrica de conectores', () => {
  it('Mercado Livre sem offline_access ou com token vencido exige atenção', () => {
    const app = { id: 'mercadolivre', name: 'Mercado Livre', category: 'marketplaces' as const, implemented: true, authorizePath: '/oauth/mercadolivre/authorize' };
    expect(resolveInstallStatus(app, { expiresAt: '2099-01-01T00:00:00.000Z', hasRefresh: false }).status).toBe('attention');
    expect(resolveInstallStatus(app, { expiresAt: '2000-01-01T00:00:00.000Z', hasRefresh: true }).status).toBe('attention');
    expect(resolveInstallStatus(app, { expiresAt: '2099-01-01T00:00:00.000Z', hasRefresh: true })).toMatchObject({
      status: 'installed',
      label: 'Instalado',
    });
    const bling = { id: 'bling', name: 'Bling', category: 'erps' as const, implemented: true, authorizePath: '/oauth/bling/authorize' };
    expect(resolveInstallStatus(bling, { expiresAt: '2000-01-01T00:00:00.000Z', hasRefresh: true }).status).toBe('installed');
    expect(resolveInstallStatus(bling, { expiresAt: '2000-01-01T00:00:00.000Z', hasRefresh: false }).status).toBe('attention');
  });

  it('pedido e nota fiscal ficam fora do modo catálogo', async () => {
    expect(isOrderOrInvoiceEvent('order.created')).toBe(true);
    expect(isOrderOrInvoiceEvent('product.updated')).toBe(false);
    await loadConnectors();
    const bling = createErpConnector('bling');
    expect(bling.id).toBe('bling');
    const ml = createMarketplaceConnector('mercadolivre');
    await expect(ml.receiveWebhook({ eventType: 'orders_v2', resourceId: '1' })).resolves.toMatchObject({
      accepted: false,
      reason: 'modo_catalogo',
    });
    await expect(ml.createListing({ sku: '1', price: 10, stock: 1, attributes: [] })).resolves.toMatchObject({
      performed: false,
      reason: 'escrita_ao_vivo_desligada',
    });
    await expect(createMarketplaceConnector('shopee').createListing({ sku: '1', price: 1, stock: 1, attributes: [] })).resolves.toMatchObject({
      performed: false,
      reason: 'escrita_ao_vivo_desligada',
    });
    expect(() => createErpConnector('omie')).toThrow(/erp_not_registered/);
    expect(CATALOG_MODE.badge).toBe('Modo Catálogo (Webhooks de Pedido Desativados)');
  });

  it('monta o webhook do Bling a partir do domínio público', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://hub.exemplo.com.br/';
    expect(getPublicBaseUrl()).toBe('https://hub.exemplo.com.br');
    expect(webhookUrl('bling')).toBe('https://hub.exemplo.com.br/webhooks/bling');
    process.env.PUBLIC_BASE_URL = previous;
  });
});

describe('P0.6 — loja e canais', () => {
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
    await query(IDENTITY_SQL);
    await query(`
      CREATE TABLE webhook_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source text NOT NULL,
        event_type text NOT NULL,
        resource_id text NOT NULL,
        content_hash char(64) NOT NULL,
        idempotency_key text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'received',
        ignore_reason text,
        error_detail text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await createUser({
      email: 'admin.integracoes@blingsync.local',
      name: 'Admin Integrações',
      password: 'SenhaAdmin!Integracoes1',
      roles: ['admin'],
      mustChangePassword: false,
    });
    await query(
      `INSERT INTO oauth_tokens (provider, access_token_enc, expires_at)
       VALUES ('mercadolivre', $1, $2)`,
      [Buffer.from('token-ml'), '2000-01-01T00:00:00.000Z']
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('mostra Requer Atenção no Mercado Livre e o modo catálogo nos canais', async () => {
    const login = await request(app).post('/auth/login').send({
      email: 'admin.integracoes@blingsync.local',
      password: 'SenhaAdmin!Integracoes1',
    });
    const setCookie = login.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookie) throw new Error('cookie de sessão ausente');

    const store = await request(app).get('/api/integrations').set('Cookie', cookie);
    expect(store.status).toBe(200);
    const ml = store.body.apps.find((row: { id: string }) => row.id === 'mercadolivre');
    expect(ml).toMatchObject({
      status: 'attention',
      statusLabel: 'Requer Atenção',
      authorizePath: '/oauth/mercadolivre/authorize',
    });
    expect(store.body.apps.find((row: { id: string }) => row.id === 'shopee').status).toBe('available');
    expect(store.body.categories.map((row: { id: string }) => row.id)).toEqual([
      'all',
      'sales',
      'erps',
      'logistics',
      'marketplaces',
    ]);
    expect(store.body.apps.find((row: { id: string }) => row.id === 'shopee').statusLabel).toBe('Não instalado');
    expect(store.body.apps.find((row: { id: string }) => row.id === 'shopee').implemented).toBe(true);

    const channels = await request(app).get('/api/integrations/channels').set('Cookie', cookie);
    expect(channels.status).toBe(200);
    expect(channels.body.catalogMode.badge).toBe(CATALOG_MODE.badge);
    const blingWebhook = store.body.publicWebhooks.bling as string | null;
    expect(blingWebhook === null || blingWebhook.endsWith('/webhooks/bling')).toBe(true);
    expect(channels.body.channels.find((row: { id: string }) => row.id === 'mercadolivre').health).toBe('attention');

    const tested = await request(app).post('/api/integrations/mercadolivre/test').set('Cookie', cookie);
    expect(tested.body.ok).toBe(false);
    const logs = await request(app).get('/api/integrations/mercadolivre/webhooks').set('Cookie', cookie);
    expect(logs.body.events).toEqual([]);

    await createUser({
      email: 'operador.integracoes@blingsync.local',
      name: 'Operador Integrações',
      password: 'SenhaOperador!Integracoes1',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const operatorLogin = await request(app).post('/auth/login').send({
      email: 'operador.integracoes@blingsync.local',
      password: 'SenhaOperador!Integracoes1',
    });
    const operatorSetCookie = operatorLogin.headers['set-cookie'];
    const operatorCookie = Array.isArray(operatorSetCookie) ? operatorSetCookie[0] : operatorSetCookie;
    if (!operatorCookie) throw new Error('cookie do operador ausente');
    const operatorStore = await request(app).get('/api/integrations').set('Cookie', operatorCookie);
    expect(operatorStore.status).toBe(200);
    const operatorTest = await request(app).post('/api/integrations/mercadolivre/test').set('Cookie', operatorCookie);
    expect(operatorTest.status).toBe(403);
  });
});
