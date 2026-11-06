import { OAuthTokenManager } from '../oauth-token-manager.js';
import { refreshMlTokenViaHttp } from '../../routes/oauth.js';
import { RemoteListing } from './types.js';

const ML_API = 'https://api.mercadolibre.com';

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  closed: 'Encerrado',
  under_review: 'Em revisão',
  inactive: 'Inativo',
};

export function labelListingStatus(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

async function mlGet(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`mercadolivre_http_${response.status}`);
  }
  return response.json();
}

function listingIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('results' in payload)) return [];
  const results = (payload as { results: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function toListing(payload: unknown): RemoteListing | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as { id?: unknown; title?: unknown; price?: unknown; status?: unknown };
  if (typeof item.id !== 'string' || typeof item.title !== 'string') return null;
  const price = typeof item.price === 'number' ? item.price : null;
  const status = typeof item.status === 'string' ? labelListingStatus(item.status) : 'Sem status';
  return { id: item.id, title: item.title, price, status };
}

async function searchIds(sellerId: string, token: string, value: string): Promise<string[]> {
  const payload = await mlGet(
    `/users/${encodeURIComponent(sellerId)}/items/search?sku=${encodeURIComponent(value)}`,
    token
  );
  return listingIds(payload);
}

/**
 * Consulta anúncios do vendedor no Mercado Livre por SKU e, se vier vazio, por EAN.
 * Não cria anúncio.
 */
export async function searchMercadoLivreListings(input: {
  sku: string;
  ean: string | null;
}): Promise<RemoteListing[]> {
  const tokens = new OAuthTokenManager();
  const token = await tokens.getValidAccessToken('mercadolivre', refreshMlTokenViaHttp);
  const me = await mlGet('/users/me', token);
  const sellerId =
    me && typeof me === 'object' && 'id' in me && (typeof (me as { id: unknown }).id === 'number' || typeof (me as { id: unknown }).id === 'string')
      ? String((me as { id: number | string }).id)
      : '';
  if (!sellerId) return [];

  const tried = new Set<string>();
  const candidates = [input.sku, input.ean ?? ''].map((value) => value.trim()).filter(Boolean);
  let found: string[] = [];
  for (const value of candidates) {
    if (tried.has(value)) continue;
    tried.add(value);
    found = await searchIds(sellerId, token, value);
    if (found.length > 0) break;
  }
  if (found.length === 0) return [];

  const item = await mlGet(`/items/${encodeURIComponent(found[0]!)}`, token);
  const listing = toListing(item);
  return listing ? [listing] : [];
}
