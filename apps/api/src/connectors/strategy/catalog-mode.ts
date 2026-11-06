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
