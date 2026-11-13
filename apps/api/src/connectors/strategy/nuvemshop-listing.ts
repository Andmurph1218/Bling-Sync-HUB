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

export const NUVEMSHOP_FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 200;
const MAX_CATALOG_PAGES = 250;
const FALLBACK_KNOWN_STORE_IDS = ['6667412'];

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

function nuvemshopHeaders(accessToken: string): Record<string, string> {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
    Accept: 'application/json',
  };
}

async function verifyStoreIdWithToken(storeId: string, accessToken: string): Promise<boolean> {
  if (!/^\d+$/.test(storeId) || process.env.VITEST === 'true') return false;
  try {
    const res = await nuvemshopFetch(
      `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}/store`,
      { headers: nuvemshopHeaders(accessToken) }
    );
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/** A loja vem do ambiente, do último OAuth, de webhook já recebido ou da validação do token em /store. */
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

    const tokens = new OAuthTokenManager();
    const stored = await tokens.getToken('nuvemshop');
    if (!stored) return null;

    const creds = await query<{ client_id: string | null; redirect_uri: string | null }>(
      `SELECT client_id, redirect_uri FROM channel_app_credentials WHERE provider = 'nuvemshop' LIMIT 1`
    ).catch(() => ({ rows: [] as Array<{ client_id: string | null; redirect_uri: string | null }> }));

    const candidates = new Set<string>();
    for (const row of creds.rows) {
      const cid = (row.client_id ?? '').trim();
      const redir = (row.redirect_uri ?? '').trim();
      if (/^\d+$/.test(cid)) candidates.add(cid);
      const matchUrl = redir.match(/(\d{5,12})/);
      if (matchUrl?.[1]) candidates.add(matchUrl[1]);
    }
    for (const known of FALLBACK_KNOWN_STORE_IDS) candidates.add(known);

    for (const candidate of candidates) {
      if (await verifyStoreIdWithToken(candidate, stored.accessToken)) {
        await rememberNuvemshopStoreId(candidate);
        return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeSku(sku: string | null | undefined): string {
  return (sku ?? '').trim().toLowerCase();
}

function sameSku(left: string | null | undefined, right: string): boolean {
  const a = normalizeSku(left);
  const b = normalizeSku(right);
  return a.length > 0 && a === b;
}

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

/**
 * Baixa o catálogo da Nuvemshop em páginas de 200 produtos e devolve um leitor por SKU
 * que calcula os sinais completos (SKU + EAN + título) sobre cada produto do HUB.
 */
export async function createNuvemshopBatchReader(): Promise<((product: MasterProduct) => MarketplaceListing | null) | null> {
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId) return null;
  const tokens = new OAuthTokenManager();
  const stored = await tokens.getToken('nuvemshop');
  if (!stored) return null;

  const headers = nuvemshopHeaders(stored.accessToken);
  const base = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
  const bySku = new Map<string, NuvemshopProduct>();

  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    const res = await nuvemshopFetch(`${base}/products?page=${page}&per_page=${PAGE_SIZE}`, {
      headers,
    });
    if (assertNuvemshopReadable(res.status) === 'missing') break;
    const items = (await res.json()) as NuvemshopProduct[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      for (const variant of item.variants ?? []) {
        const key = normalizeSku(variant.sku);
        if (!key || bySku.has(key)) continue;
        bySku.set(key, item);
      }
    }

    if (items.length < PAGE_SIZE) break;
  }

  return (product: MasterProduct) => {
    const found = bySku.get(normalizeSku(product.sku));
    if (!found) return null;
    return listingFromProduct(found, product.sku, { ean: product.ean, name: product.name });
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
  const headers = nuvemshopHeaders(stored.accessToken);
  const base = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
  const bySku = await nuvemshopFetch(`${base}/products/sku/${encodeURIComponent(sku)}`, { headers });
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

  const response = await nuvemshopFetch(`${base}/products?q=${encodeURIComponent(sku)}`, { headers });
  if (assertNuvemshopReadable(response.status) === 'missing') return null;
  const payload = (await response.json()) as NuvemshopProduct[];
  const match = (Array.isArray(payload) ? payload : []).find((item) =>
    (item.variants ?? []).some((variant) => sameSku(variant.sku, sku))
  );
  if (!match) return null;
  return listingFromProduct(match, sku, { ean: product.ean, name: product.name });
}
