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

function listingFromProduct(product: NuvemshopProduct, sku: string): MarketplaceListing | null {
  if (product.id === undefined || product.id === null) return null;
  const variant = (product.variants ?? []).find((item) => sameSku(item.sku, sku)) ?? product.variants?.[0];
  return {
    externalId: String(product.id),
    title: productName(product),
    price: asMoney(variant?.price),
    stock: typeof variant?.stock === 'number' ? variant.stock : null,
    images: (product.images ?? []).map((image) => image.src ?? '').filter((url) => url.startsWith('http')),
    status: product.published === false ? 'Rascunho' : 'Ativo',
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
  const bySku = await fetch(`${base}/products/sku/${encodeURIComponent(sku)}`, { headers });
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
    const listing = listingFromProduct(body, sku);
    if (listing) return listing;
  }
  const response = await fetch(`${base}/products?q=${encodeURIComponent(sku)}`, { headers });
  if (!response.ok) return null;
  const payload = (await response.json()) as NuvemshopProduct[];
  const match = (Array.isArray(payload) ? payload : []).find((item) =>
    (item.variants ?? []).some((variant) => sameSku(variant.sku, sku))
  );
  if (!match) return null;
  return listingFromProduct(match, sku);
}
