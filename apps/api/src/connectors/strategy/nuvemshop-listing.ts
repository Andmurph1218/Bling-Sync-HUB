import { query } from '../../db/pool.js';
import { OAuthTokenManager } from '../oauth-token-manager.js';
import { MarketplaceListing, MasterProduct } from './types.js';

interface NuvemshopVariant {
  sku?: string | null;
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

const HTTP_TIMEOUT_MS = 15_000;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const res = await fetch(`https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}/store`, {
      headers: nuvemshopHeaders(accessToken),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A loja vem do ambiente, do último OAuth, de webhook/fila já recebidos ou da validação do token em /store. */
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
    const foundHook = hook.rows[0]?.store_id?.trim();
    if (foundHook) {
      await rememberNuvemshopStoreId(foundHook);
      return foundHook;
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

function listingFromVariant(product: NuvemshopProduct, variant: NuvemshopVariant | undefined): MarketplaceListing | null {
  if (product.id === undefined || product.id === null) return null;
  return {
    externalId: String(product.id),
    title: productName(product),
    price: asMoney(variant?.price),
    stock: typeof variant?.stock === 'number' ? variant.stock : null,
    images: (product.images ?? []).map((image) => image.src ?? '').filter((url) => url.startsWith('http')),
    status: product.published === false ? 'Rascunho' : 'Ativo',
  };
}

function listingFromProduct(product: NuvemshopProduct, sku: string, allowSingleUnnamedFallback = false): MarketplaceListing | null {
  if (product.id === undefined || product.id === null) return null;
  const variants = product.variants ?? [];
  const exact = variants.find((item) => sameSku(item.sku, sku));
  if (exact) return listingFromVariant(product, exact);
  if (allowSingleUnnamedFallback && variants.length === 1 && normalizeSku(variants[0]?.sku) === '') {
    return listingFromVariant(product, variants[0]);
  }
  return null;
}

async function nuvemshopGet(url: string, headers: Record<string, string>): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    lastRes = res;
    const remaining = Number(res.headers.get('x-rate-limit-remaining') ?? '');
    if (Number.isFinite(remaining) && remaining >= 0 && remaining <= 2) {
      await sleep(600);
    }
    if (res.status !== 429 && res.status < 500) return res;
    const resetMs = Number(res.headers.get('x-rate-limit-reset') ?? '');
    const waitMs = Number.isFinite(resetMs) && resetMs > 0 ? Math.min(10_000, resetMs) : 1000 * (attempt + 1);
    await sleep(waitMs);
  }
  return lastRes!;
}

/**
 * Baixa o catálogo da Nuvemshop em páginas de 200 produtos e indexa por SKU normalizado.
 * Retorna null se a Nuvemshop não estiver conectada ou sem store_id resolvido.
 */
export async function fetchNuvemshopCatalogIndex(): Promise<Map<string, MarketplaceListing> | null> {
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId) return null;
  const tokens = new OAuthTokenManager();
  const stored = await tokens.getToken('nuvemshop');
  if (!stored) return null;

  const headers = nuvemshopHeaders(stored.accessToken);
  const base = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
  const bySku = new Map<string, MarketplaceListing>();

  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    const res = await nuvemshopGet(`${base}/products?page=${page}&per_page=${PAGE_SIZE}`, headers);
    if (res.status === 404) break;
    if (!res.ok) {
      throw new Error(`nuvemshop_list_failed:${res.status}`);
    }
    const items = (await res.json()) as NuvemshopProduct[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const product of items) {
      for (const variant of product.variants ?? []) {
        const key = normalizeSku(variant.sku);
        if (!key || bySku.has(key)) continue;
        const listing = listingFromVariant(product, variant);
        if (listing) bySku.set(key, listing);
      }
    }

    if (items.length < PAGE_SIZE) break;
  }

  return bySku;
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
  const bySku = await nuvemshopGet(`${base}/products/sku/${encodeURIComponent(sku)}`, headers);
  if (bySku.ok) {
    const body = (await bySku.json()) as NuvemshopProduct & {
      product_id?: number | string;
      sku?: string | null;
      price?: string | number | null;
      stock?: number | null;
    };
    if (body.product_id !== undefined && body.product_id !== null && sameSku(body.sku ?? sku, sku)) {
      const price = asMoney(body.price);
      const stock = typeof body.stock === 'number' ? body.stock : null;
      return {
        externalId: String(body.product_id),
        title: productName(body),
        price,
        stock,
        images: [],
        status: 'Ativo',
      };
    }
    const listing = listingFromProduct(body, sku, true);
    if (listing) return listing;
  } else if (bySku.status !== 404 && bySku.status !== 422) {
    throw new Error(`nuvemshop_sku_lookup_failed:${bySku.status}`);
  }

  const response = await nuvemshopGet(`${base}/products?q=${encodeURIComponent(sku)}`, headers);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`nuvemshop_search_failed:${response.status}`);
  }
  const payload = (await response.json()) as NuvemshopProduct[];
  const match = (Array.isArray(payload) ? payload : []).find((item) =>
    (item.variants ?? []).some((variant) => sameSku(variant.sku, sku))
  );
  if (!match) return null;
  return listingFromProduct(match, sku, false);
}
