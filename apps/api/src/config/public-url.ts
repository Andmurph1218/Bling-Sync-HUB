const WEBHOOK_SOURCES = ['bling', 'mercadolivre', 'nuvemshop'] as const;

export type WebhookSourceName = (typeof WEBHOOK_SOURCES)[number];

/** Origem pública do HUB, sem barra no final. Vazia enquanto o domínio não estiver no .env. */
export function getPublicBaseUrl(): string | null {
  const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return base.length > 0 ? base : null;
}

export function webhookUrl(source: WebhookSourceName): string | null {
  const base = getPublicBaseUrl();
  return base ? `${base}/webhooks/${source}` : null;
}

export function publicWebhookMap(): {
  base: string | null;
  bling: string | null;
  mercadolivre: string | null;
  nuvemshop: string | null;
} {
  return {
    base: getPublicBaseUrl(),
    bling: webhookUrl('bling'),
    mercadolivre: webhookUrl('mercadolivre'),
    nuvemshop: webhookUrl('nuvemshop'),
  };
}
