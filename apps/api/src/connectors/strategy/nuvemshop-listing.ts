import { query } from '../../db/pool.js';
import { OAuthTokenManager } from '../oauth-token-manager.js';
import { nuvemshopFetch } from './nuvemshop-http.js';
import { collectListingSignals, ListingSignal } from './listing-signals.js';
import { MarketplaceListing, MasterProduct } from './types.js';

interface NuvemshopVariant {
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  stock?: number | null;
}

interface NuvemshopProduct {
  id?: number | string;
  name?: { pt?: string } | string;
  published?: boolean;
  images?: Array<{ src?: string }>;
  variants?: NuvemshopVariant[];
}

function productName(product: NuvemshopProduct): string {
  if (typeof product.name === 'string') return product.name;
  return product.name?.pt ?? 'Anúncio Nuvemshop';
}

function asMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const STORE_CURSOR = 'nuvemshop-store-id';

export async function rememberNuvemshopStoreId(storeId: string): Promise<void> {
  await query(
    `INSERT INTO sync_cursors (job_name, cursor_value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (job_name) DO UPDATE
       SET cursor_value = EXCLUDED.cursor_value, updated_at = now()`,
    [STORE_CURSOR, storeId]
  );
}

/** A loja vem do ambiente, do último OAuth ou de um webhook já recebido. */
export async function resolveNuvemshopStoreId(): Promise<string | null> {
  const fromEnv = (process.env.NUVEMSHOP_STORE_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    const saved = await query<{ cursor_value: string | null }>(
      `SELECT cursor_value FROM sync_cursors WHERE job_name = $1`,
      [STORE_CURSOR]
    );
    const cursor = saved.rows[0]?.cursor_value?.trim();
    if (cursor) return cursor;
    const hook = await query<{ store_id: string | null }>(
      `SELECT COALESCE(raw_payload->>'store_id', raw_payload->>'user_id') AS store_id
       FROM webhook_events
       WHERE source = 'nuvemshop'
         AND COALESCE(raw_payload->>'store_id', raw_payload->>'user_id') IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`
    );
    const found = hook.rows[0]?.store_id?.trim();
    if (found) {
      await rememberNuvemshopStoreId(found);
      return found;
    }
  } catch {
    return null;
  }
  return null;
}

function sameSku(left: string | null | undefined, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

export const NUVEMSHOP_FETCH_TIMEOUT_MS = 15_000;

export class NuvemshopListingError extends Error {
  constructor(readonly status: number) {
    super(`Nuvemshop respondeu ${status}. O anúncio não foi tratado como inexistente.`);
    this.name = 'NuvemshopListingError';
  }
}

/** 404 é ausência. Qualquer outra falha, inclusive 401, 429 e 5xx, interrompe a leitura. */
export function assertNuvemshopReadable(status: number): 'ok' | 'missing' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) return 'missing';
  throw new NuvemshopListingError(status);
}

export function listingFromProduct(
  product: NuvemshopProduct,
  sku: string,
  hub: { ean?: string | null; name?: string | null } = {}
): MarketplaceListing | null {
  if (product.id === undefined || product.id === null) return null;
  const variant = (product.variants ?? []).find((item) => sameSku(item.sku, sku));
  if (!variant) return null;
  const title = productName(product);
  const signals: ListingSignal[] = collectListingSignals({
    hubSku: sku,
    hubEan: hub.ean,
    hubName: hub.name,
    channelSku: variant.sku,
    channelEan: variant.barcode,
    channelTitle: title,
    matchedBy: ['sku'],
  });
  return {
    externalId: String(product.id),
    title,
    sku: variant.sku ?? sku,
    ean: variant.barcode ?? null,
    price: asMoney(variant.price),
    stock: typeof variant.stock === 'number' ? variant.stock : null,
    images: (product.images ?? []).map((image) => image.src ?? '').filter((url) => url.startsWith('http')),
    status: product.published === false ? 'Rascunho' : 'Ativo',
    signals,
  };
}

/** Busca o anúncio da loja pelo SKU. Sem loja ou token, devolve null e não publica nada. */
export async function fetchNuvemshopListing(product: MasterProduct): Promise<MarketplaceListing | null> {
  const sku = product.sku.trim();
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId || !sku) return null;
  const tokens = new OAuthTokenManager();
  const stored = await tokens.getToken('nuvemshop');
  if (!stored) return null;
  const headers = {
    Authentication: `bearer ${stored.accessToken}`,
    'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
    Accept: 'application/json',
  };
  const base = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
  const signal = AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS);
  const bySku = await nuvemshopFetch(`${base}/products/sku/${encodeURIComponent(sku)}`, { headers, signal });
  if (assertNuvemshopReadable(bySku.status) === 'ok') {
    const body = (await bySku.json()) as NuvemshopProduct & {
      product_id?: number | string;
      sku?: string | null;
      price?: string | number | null;
      stock?: number | null;
    };
    if (body.product_id !== undefined && body.product_id !== null && sameSku(body.sku, sku)) {
      const price = asMoney(body.price);
      const stock = typeof body.stock === 'number' ? body.stock : null;
      const title = productName(body);
      const barcode = (body as { barcode?: string | null }).barcode ?? null;
      return {
        externalId: String(body.product_id),
        title,
        sku: body.sku ?? sku,
        ean: barcode,
        price,
        stock,
        images: [],
        status: 'Ativo',
        signals: collectListingSignals({
          hubSku: sku,
          hubEan: product.ean,
          hubName: product.name,
          channelSku: body.sku,
          channelEan: barcode,
          channelTitle: title,
          matchedBy: ['sku'],
        }),
      };
    }
    const listing = listingFromProduct(body, sku, { ean: product.ean, name: product.name });
    if (listing) return listing;
  }
  const response = await nuvemshopFetch(`${base}/products?q=${encodeURIComponent(sku)}`, { headers, signal });
  if (assertNuvemshopReadable(response.status) === 'missing') return null;
  const payload = (await response.json()) as NuvemshopProduct[];
  const match = (Array.isArray(payload) ? payload : []).find((item) =>
    (item.variants ?? []).some((variant) => sameSku(variant.sku, sku))
  );
  if (!match) return null;
  return listingFromProduct(match, sku, { ean: product.ean, name: product.name });
}
