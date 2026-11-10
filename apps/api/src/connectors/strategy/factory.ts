import { IntegrationCategory, IntegrationStatus, TokenSnapshot } from './types.js';
import { MercadoLivreMarketplaceConnector, NuvemshopMarketplaceConnector } from './marketplaces.js';
import { UnavailableMarketplaceConnector } from './unavailable.js';
import { ErpConnector, MarketplaceConnector } from './types.js';

export interface IntegrationApp {
  id: string;
  name: string;
  category: IntegrationCategory;
  implemented: boolean;
  authorizePath: string | null;
}

export const INTEGRATION_APPS: IntegrationApp[] = [
  { id: 'mercadolivre', name: 'Mercado Livre', category: 'marketplaces', implemented: true, authorizePath: '/oauth/mercadolivre/authorize' },
  { id: 'nuvemshop', name: 'Nuvemshop', category: 'marketplaces', implemented: true, authorizePath: null },
  { id: 'shopee', name: 'Shopee', category: 'marketplaces', implemented: false, authorizePath: null },
  { id: 'amazon', name: 'Amazon', category: 'marketplaces', implemented: false, authorizePath: null },
  { id: 'tiktok', name: 'TikTok Shop', category: 'marketplaces', implemented: false, authorizePath: null },
  { id: 'bling', name: 'Bling', category: 'erps', implemented: true, authorizePath: '/oauth/bling/authorize' },
];

const MARKETPLACES: Record<string, () => MarketplaceConnector> = {
  mercadolivre: () => new MercadoLivreMarketplaceConnector(),
  nuvemshop: () => new NuvemshopMarketplaceConnector(),
  shopee: () => new UnavailableMarketplaceConnector('shopee'),
  amazon: () => new UnavailableMarketplaceConnector('amazon'),
  tiktok: () => new UnavailableMarketplaceConnector('tiktok'),
};

const ERPS: Record<string, () => ErpConnector> = {};

export function registerErpConnector(id: string, create: () => ErpConnector): void {
  ERPS[id] = create;
}

export function createMarketplaceConnector(id: string): MarketplaceConnector {
  const factory = MARKETPLACES[id];
  if (!factory) {
    throw new Error(`marketplace_not_registered:${id}`);
  }
  return factory();
}

export const DEFAULT_ERP_ID = 'bling';

export function getMarketplaceConnector(id: string): MarketplaceConnector {
  return createMarketplaceConnector(id);
}

export function erpRecordUrl(erpId: string): string {
  const connector = createErpConnector(DEFAULT_ERP_ID);
  return connector.recordUrl ? connector.recordUrl(erpId) : '';
}

export function createErpConnector(id: string): ErpConnector {
  const factory = ERPS[id];
  if (!factory) {
    throw new Error(`erp_not_registered:${id}`);
  }
  return factory();
}

export function resolveInstallStatus(
  app: IntegrationApp,
  token: TokenSnapshot | null,
  now = new Date()
): { status: IntegrationStatus; label: string; reason: string | null } {
  if (!app.implemented) {
    return { status: 'available', label: 'Em breve', reason: null };
  }
  if (!token) {
    return { status: 'available', label: 'Não instalado', reason: null };
  }
  const expired = new Date(token.expiresAt).getTime() < now.getTime();
  // O access token do Bling dura ~6h e é renovado com o refresh. Isso não é desconexão.
  const renewsItself = app.id === 'nuvemshop' || (app.id === 'bling' && token.hasRefresh);
  if (renewsItself) {
    return { status: 'installed', label: 'Instalado', reason: null };
  }
  const needsOfflineAccess = app.id === 'mercadolivre' && !token.hasRefresh;
  if (needsOfflineAccess || expired) {
    const reason = needsOfflineAccess
      ? 'O Mercado Livre está sem offline_access. Reautorize o aplicativo para o token renovar sozinho.'
      : 'O token expirou.';
    return { status: 'attention', label: 'Requer Atenção', reason };
  }
  return { status: 'installed', label: 'Instalado', reason: null };
}
