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

export const NUVEMSHOP_MAX_AXES = 3;
export const NUVEMSHOP_MAX_IMAGES = 50;
export const NUVEMSHOP_EXISTENCE_TIMEOUT_MS = 5_000;

/**
 * Traduz o draft para o payload de POST /products da API 2025-03.
 * `attributes` é a lista de NOMES de eixos; `variants[].values` segue a mesma ordem.
 * Validação falha com 400 para o job não retentar um payload inválido.
 */
export function buildNuvemshopProductBody(draft: ListingDraft): Record<string, unknown> {
  const name = (draft.title ?? '').trim() || draft.sku;
  const attributes = (draft.attributes ?? [])
    .map((attribute) => ({ pt: (attribute.name ?? attribute.value_name ?? attribute.id).trim() }))
    .filter((attribute) => attribute.pt.length > 0);

  if (attributes.length > NUVEMSHOP_MAX_AXES) {
    throw new NuvemshopPublishError(
      400,
      `Nuvemshop aceita até ${NUVEMSHOP_MAX_AXES} atributos de variação. O produto ${draft.sku} tem ${attributes.length}.`
    );
  }

  const variants = draft.variants?.length
    ? draft.variants
    : [{ sku: draft.sku, price: draft.price, stock: draft.stock, values: [] as string[] }];

  const seen = new Set<string>();
  const variantBodies = variants.map((variant) => {
    const sku = variant.sku.trim();
    if (!sku) throw new NuvemshopPublishError(400, 'Variação sem SKU — não sincroniza.');
    if (seen.has(sku)) throw new NuvemshopPublishError(400, `SKU duplicado no anúncio: ${sku}`);
    seen.add(sku);
    if (!Number.isFinite(variant.price) || variant.price <= 0) {
      throw new NuvemshopPublishError(400, `Preço inválido para o SKU ${sku}.`);
    }
    const values = attributes.length > 0 ? variant.values : [];
    if (attributes.length > 0 && values.length !== attributes.length) {
      throw new NuvemshopPublishError(
        400,
        `A variação ${sku} não tem valor para todos os ${attributes.length} atributos.`
      );
    }
    return {
      price: variant.price.toFixed(2),
      sku,
      stock_management: true,
      stock: Math.max(0, Math.floor(variant.stock)),
      ...(attributes.length > 0 ? { values: values.map((value) => ({ pt: value })) } : {}),
    };
  });

  return {
    name: { pt: name },
    published: true,
    ...(draft.description ? { description: { pt: draft.description } } : {}),
    ...(draft.categoryIds?.length ? { categories: draft.categoryIds } : {}),
    ...(draft.brand?.trim() ? { brand: draft.brand.trim() } : {}),
    ...(attributes.length > 0 ? { attributes } : {}),
    variants: variantBodies,
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
    body: JSON.stringify(buildNuvemshopProductBody(draft)),
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
