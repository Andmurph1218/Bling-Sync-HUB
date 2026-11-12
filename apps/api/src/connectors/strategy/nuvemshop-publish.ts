import { OAuthTokenManager } from '../oauth-token-manager.js';
import { ListingDraft, ListingResult, MasterProduct } from './types.js';
import { fetchNuvemshopListing, NUVEMSHOP_FETCH_TIMEOUT_MS, NuvemshopListingError, resolveNuvemshopStoreId } from './nuvemshop-listing.js';
import { nuvemshopFetch } from './nuvemshop-http.js';

export class NuvemshopPublishError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'NuvemshopPublishError';
  }
}

/** Só 429 e 5xx voltam para a fila. 400 e o restante encerram o job. */
export function isRetryablePublishError(error: unknown): boolean {
  return error instanceof NuvemshopPublishError && (error.status === 429 || error.status >= 500);
}

function publishMessage(status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? (body as { message?: unknown; description?: unknown }) : {};
  const detail = [record.description, record.message].find((item) => typeof item === 'string' && item.trim());
  const suffix = typeof detail === 'string' ? ` ${detail.trim().slice(0, 240)}` : '';
  if (status === 400) return `Nuvemshop recusou o anúncio (400).${suffix}`;
  if (status === 429) return `Nuvemshop limitou a criação (429).${suffix}`;
  return `Nuvemshop respondeu ${status} na criação do anúncio.${suffix}`;
}

function productBody(draft: ListingDraft): Record<string, unknown> {
  const name = (draft.title ?? '').trim() || draft.sku;
  return {
    name: { pt: name },
    published: true,
    variants: [
      {
        price: draft.price.toFixed(2),
        sku: draft.sku,
        stock_management: true,
        stock: Math.max(0, Math.floor(draft.stock)),
      },
    ],
  };
}

/** Cria o produto na loja. Se o SKU já existe lá, devolve o id sem um segundo POST. */
export async function createNuvemshopListing(draft: ListingDraft): Promise<ListingResult> {
  const sku = draft.sku.trim();
  if (!sku) throw new NuvemshopPublishError(400, 'Sem SKU — não sincroniza');
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId) throw new NuvemshopPublishError(401, 'Loja da Nuvemshop não configurada.');
  const stored = await new OAuthTokenManager().getToken('nuvemshop');
  if (!stored) throw new NuvemshopPublishError(401, 'Token da Nuvemshop ausente.');

  const product: MasterProduct = { id: sku, sku, ean: null, price: draft.price, stock: draft.stock };
  let existing: Awaited<ReturnType<typeof fetchNuvemshopListing>>;
  try {
    existing = await fetchNuvemshopListing(product);
  } catch (error) {
    if (error instanceof NuvemshopListingError) throw new NuvemshopPublishError(error.status, error.message);
    throw error;
  }
  if (existing) return { performed: true, reason: 'ja_existia', externalId: existing.externalId };

  const headers = {
    Authentication: `bearer ${stored.accessToken}`,
    'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const url = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}/products`;
  const response = await nuvemshopFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(productBody(draft)),
    signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200 && response.status !== 201) {
    throw new NuvemshopPublishError(response.status, publishMessage(response.status, body));
  }
  const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined;
  if (id === undefined || id === null || String(id).trim() === '') {
    throw new NuvemshopPublishError(502, 'Nuvemshop não devolveu o id do anúncio.');
  }
  return { performed: true, reason: 'criado', externalId: String(id) };
}
