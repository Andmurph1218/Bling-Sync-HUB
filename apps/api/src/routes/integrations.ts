import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { CATALOG_MODE } from '../connectors/strategy/catalog-mode.js';
import { publicWebhookMap } from '../config/public-url.js';
import {
  INTEGRATION_APPS,
  IntegrationApp,
  resolveInstallStatus,
} from '../connectors/strategy/factory.js';
import { IntegrationStatus, TokenSnapshot } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';

export const integrationsRouter = Router();

const reader = requireRole('admin', 'operator');
const admin = requireRole('admin');

const CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'sales', label: 'Canais de venda' },
  { id: 'erps', label: 'ERP' },
  { id: 'logistics', label: 'Logística' },
  { id: 'marketplaces', label: 'Marketplaces' },
] as const;

const WEBHOOK_SOURCES = new Set(['bling', 'mercadolivre', 'nuvemshop']);

interface TokenRow {
  provider: string;
  expires_at: Date | string;
  has_refresh: boolean;
}

async function loadTokens(): Promise<Map<string, TokenSnapshot & { expiresAt: string }>> {
  const found = await query<TokenRow>(
    `SELECT provider, expires_at, (refresh_token_enc IS NOT NULL) AS has_refresh
     FROM oauth_tokens`
  );
  const tokens = new Map<string, TokenSnapshot & { expiresAt: string }>();
  for (const row of found.rows) {
    tokens.set(row.provider, {
      expiresAt: new Date(row.expires_at).toISOString(),
      hasRefresh: row.has_refresh === true || String(row.has_refresh) === 't' || String(row.has_refresh) === 'true',
    });
  }
  return tokens;
}

function findApp(id: string): IntegrationApp | undefined {
  return INTEGRATION_APPS.find((app) => app.id === id);
}

function presentApp(app: IntegrationApp, token: (TokenSnapshot & { expiresAt: string }) | null) {
  const resolved = resolveInstallStatus(app, token);
  return {
    id: app.id,
    name: app.name,
    category: app.category,
    implemented: app.implemented,
    status: resolved.status,
    statusLabel: resolved.label,
    reason: resolved.reason,
    authorizePath: app.authorizePath,
    expiresAt: token?.expiresAt ?? null,
  };
}

function healthOf(status: IntegrationStatus): 'ok' | 'attention' | 'down' {
  if (status === 'installed') return 'ok';
  if (status === 'attention') return 'attention';
  return 'down';
}

integrationsRouter.get('/api/integrations', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await loadTokens();
    res.json({
      catalogMode: CATALOG_MODE,
      publicWebhooks: publicWebhookMap(),
      categories: CATEGORIES,
      apps: INTEGRATION_APPS.map((app) => presentApp(app, tokens.get(app.id) ?? null)),
    });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/api/integrations/channels', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [tokens, stores, owners, controls, warehouses] = await Promise.all([
      loadTokens(),
      query<{ platform: string; name: string; bling_loja_id: string }>(
        `SELECT platform, name, bling_loja_id FROM channel_stores`
      ),
      query<{ platform: string; stock_price: string; content: string }>(
        `SELECT platform, stock_price, content FROM channel_sync_owners`
      ),
      query<{ platform: string; mode: string; kill_switch: boolean }>(
        `SELECT platform, mode, kill_switch FROM enrichment_controls`
      ),
      query<{ bling_warehouse_id: string; name: string; role: string; include_in_push: boolean }>(
        `SELECT bling_warehouse_id, name, role, include_in_push
         FROM stock_warehouses
         ORDER BY bling_warehouse_id ASC`
      ),
    ]);

    const channels = INTEGRATION_APPS.filter((app) => app.category === 'marketplaces' && app.implemented).map((app) => {
      const presented = presentApp(app, tokens.get(app.id) ?? null);
      const store = stores.rows.find((row) => row.platform === app.id);
      const owner = owners.rows.find((row) => row.platform === app.id);
      const control = controls.rows.find((row) => row.platform === app.id);
      return {
        id: app.id,
        name: app.name,
        storeName: store?.name ?? null,
        blingStoreId: store?.bling_loja_id ?? null,
        health: healthOf(presented.status),
        healthLabel: presented.status === 'installed' ? 'Conectado' : presented.statusLabel,
        reason: presented.reason,
        stockOwner: owner?.stock_price ?? null,
        contentOwner: owner?.content ?? null,
        enrichmentMode: control?.mode ?? null,
        killSwitch: control?.kill_switch ?? null,
      };
    });

    res.json({
      catalogMode: CATALOG_MODE,
      channels,
      warehouses: warehouses.rows,
    });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/api/integrations/:id/webhooks', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = findApp(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'integration_not_found', message: 'Integração não cadastrada.' });
      return;
    }
    if (!WEBHOOK_SOURCES.has(app.id)) {
      res.json({ events: [], note: 'connector_not_installed' });
      return;
    }
    const found = await query<{
      id: string;
      event_type: string;
      resource_id: string;
      status: string;
      ignore_reason: string | null;
      error_detail: string | null;
      created_at: Date | string;
    }>(
      `SELECT id, event_type, resource_id, status, ignore_reason, error_detail, created_at
       FROM webhook_events
       WHERE source = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [app.id]
    );
    res.json({
      events: found.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        resourceId: row.resource_id,
        status: row.status,
        ignoreReason: row.ignore_reason,
        errorDetail: row.error_detail,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/api/integrations/:id/test', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = findApp(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'integration_not_found', message: 'Integração não cadastrada.' });
      return;
    }
    const tokens = await loadTokens();
    const presented = presentApp(app, tokens.get(app.id) ?? null);
    res.json({
      ok: presented.status === 'installed',
      status: presented.status,
      statusLabel: presented.statusLabel,
      reason: presented.reason,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/api/integrations/:id/settings', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = findApp(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'integration_not_found', message: 'Integração não cadastrada.' });
      return;
    }
    const tokens = await loadTokens();
    const presented = presentApp(app, tokens.get(app.id) ?? null);
    const store = await query<{ name: string; bling_loja_id: string }>(
      `SELECT name, bling_loja_id FROM channel_stores WHERE platform = $1`,
      [app.id]
    );
    const owner = await query<{ stock_price: string; content: string }>(
      `SELECT stock_price, content FROM channel_sync_owners WHERE platform = $1`,
      [app.id]
    );
    res.json({
      id: presented.id,
      name: presented.name,
      status: presented.status,
      statusLabel: presented.statusLabel,
      reason: presented.reason,
      expiresAt: presented.expiresAt,
      authorizePath: presented.authorizePath,
      catalogMode: CATALOG_MODE,
      store: store.rows[0] ?? null,
      syncOwner: owner.rows[0]
        ? { stockPrice: owner.rows[0].stock_price, content: owner.rows[0].content }
        : null,
    });
  } catch (error) {
    next(error);
  }
});
