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

/** Busca o anúncio da loja pelo SKU. Sem loja configurada, devolve null e não chama a API. */
export async function fetchNuvemshopListing(product: MasterProduct): Promise<MarketplaceListing | null> {
  const storeId = (process.env.NUVEMSHOP_STORE_ID ?? '').trim();
  if (!storeId || !product.sku.trim()) return null;
  const tokens = new OAuthTokenManager();
  const stored = await tokens.getToken('nuvemshop');
  if (!stored) return null;
  const response = await fetch(
    `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}/products?q=${encodeURIComponent(product.sku.trim())}`,
    {
      headers: {
        Authentication: `bearer ${stored.accessToken}`,
        'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
        Accept: 'application/json',
      },
    }
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as NuvemshopProduct[];
  const match = (Array.isArray(payload) ? payload : []).find((item) =>
    (item.variants ?? []).some((variant) => (variant.sku ?? '').trim() === product.sku.trim())
  );
  if (!match || match.published === false || match.id === undefined || match.id === null) return null;
  const variant = (match.variants ?? []).find((item) => (item.sku ?? '').trim() === product.sku.trim());
  return {
    externalId: String(match.id),
    title: productName(match),
    price: asMoney(variant?.price),
    stock: typeof variant?.stock === 'number' ? variant.stock : null,
    images: (match.images ?? []).map((image) => image.src ?? '').filter((url) => url.startsWith('http')),
    status: 'Ativo',
  };
}
