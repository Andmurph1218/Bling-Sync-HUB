import { OAuthTokenManager } from '../oauth-token-manager.js';
import { refreshMlTokenViaHttp } from '../../routes/oauth.js';
import { collectListingSignals, sameIdentity } from './listing-signals.js';
import { ListingSearchInput, MarketplaceListing, RemoteListing } from './types.js';

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

  const found = await firstMercadoLivreHit(sellerId, token, input);
  if (!found) return [];

  const item = await mlGet(`/items/${encodeURIComponent(found.id)}`, token);
  const listing = toListing(item);
  return listing ? [listing] : [];
}

function toMarketplaceListing(payload: unknown): MarketplaceListing | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as {
    id?: unknown;
    title?: unknown;
    price?: unknown;
    status?: unknown;
    available_quantity?: unknown;
    pictures?: Array<{ secure_url?: string; url?: string }>;
  };
  if (typeof item.id !== 'string' || typeof item.title !== 'string') return null;
  const images = (item.pictures ?? [])
    .map((picture) => picture.secure_url || picture.url || '')
    .filter((url) => url.startsWith('http'));
  return {
    externalId: item.id,
    title: item.title,
    price: typeof item.price === 'number' ? item.price : null,
    stock: typeof item.available_quantity === 'number' ? item.available_quantity : null,
    images,
    status: typeof item.status === 'string' ? labelListingStatus(item.status) : 'Sem status',
  };
}

/** Lê o anúncio ativo do vendedor. Não grava preço nem estoque no ERP. */
export async function fetchMercadoLivreListing(input: ListingSearchInput): Promise<MarketplaceListing | null> {
  const tokens = new OAuthTokenManager();
  const token = await tokens.getValidAccessToken('mercadolivre', refreshMlTokenViaHttp);
  const me = await mlGet('/users/me', token);
  const sellerId =
    me && typeof me === 'object' && 'id' in me && (typeof (me as { id: unknown }).id === 'number' || typeof (me as { id: unknown }).id === 'string')
      ? String((me as { id: number | string }).id)
      : '';
  if (!sellerId) return null;
  const hit = await firstMercadoLivreHit(sellerId, token, input);
  if (!hit) return null;
  const item = await mlGet(`/items/${encodeURIComponent(hit.id)}`, token);
  const listing = toMarketplaceListing(item);
  if (!listing) return null;
  const status = listing.status.toLowerCase();
  if (status !== 'ativo' && status !== 'active') return null;
  const attributes = item && typeof item === 'object' && Array.isArray((item as { attributes?: unknown }).attributes)
    ? (item as { attributes: Array<{ id?: string; value_name?: string }> }).attributes
    : [];
  const attribute = (id: string) => attributes.find((entry) => entry.id === id)?.value_name ?? null;
  const channelSku = attribute('SELLER_SKU');
  const channelEan = attribute('GTIN') ?? attribute('EAN');
  return {
    ...listing,
    sku: channelSku,
    ean: channelEan,
    signals: collectListingSignals({
      hubSku: input.sku,
      hubEan: input.ean,
      hubName: input.name,
      channelSku,
      channelEan,
      channelTitle: listing.title,
      matchedBy: hit.matchedBy,
    }),
  };
}

function searchValues(input: ListingSearchInput): string[] {
  return [input.sku, input.ean ?? ''].map((value) => value.trim()).filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}

async function firstMercadoLivreHit(
  sellerId: string,
  token: string,
  input: ListingSearchInput
): Promise<{ id: string; matchedBy: Array<'sku' | 'ean'> } | null> {
  for (const value of searchValues(input)) {
    const found = await searchIds(sellerId, token, value);
    const id = found[0];
    if (!id) continue;
    const matchedBy: Array<'sku' | 'ean'> = [];
    if (sameIdentity(value, input.sku)) matchedBy.push('sku');
    if (sameIdentity(value, input.ean)) matchedBy.push('ean');
    return { id, matchedBy };
  }
  return null;
}
