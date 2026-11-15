import { IncomingWebhook, StockUpdate, StockUpdateResult, WebhookReceipt } from './types.js';

/** O HUB opera o catálogo. Pedido e nota fiscal continuam na integração nativa. */
export const CATALOG_MODE = {
  ordersEnabled: false,
  invoicesEnabled: false,
  badge: 'Modo Catálogo (Webhooks de Pedido Desativados)',
} as const;

export function isOrderOrInvoiceEvent(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return (
    normalized.includes('order') ||
    normalized.includes('pedido') ||
    normalized.includes('nfe') ||
    normalized.includes('invoice') ||
    normalized.includes('nota')
  );
}

export function refuseStock(_update: StockUpdate): StockUpdateResult {
  return { performed: false, reason: 'estoque_na_integracao_nativa' };
}

export function receiveCatalogWebhook(event: IncomingWebhook): WebhookReceipt {
  if (isOrderOrInvoiceEvent(event.eventType)) {
    return { accepted: false, reason: 'modo_catalogo' };
  }
  return { accepted: true, reason: 'evento_de_catalogo' };
}
