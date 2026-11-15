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

export interface NuvemshopAuth {
  storeId: string;
  accessToken: string;
}

async function nuvemshopAuth(): Promise<NuvemshopAuth> {
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId) throw new NuvemshopPublishError(401, 'Loja da Nuvemshop não configurada.');
  const stored = await new OAuthTokenManager().getToken('nuvemshop');
  if (!stored) throw new NuvemshopPublishError(401, 'Token da Nuvemshop ausente.');
  return { storeId, accessToken: stored.accessToken };
}

function apiBase(storeId: string): string {
  return `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
}

function apiHeaders(auth: NuvemshopAuth, json = false): Record<string, string> {
  return {
    Authentication: `bearer ${auth.accessToken}`,
    'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

/**
 * O worker já bloqueia quando há vínculo em channel_listing_links; este lookup
 * cobre anúncio criado fora do HUB. Para no primeiro anúncio encontrado e
 * interrompe a sequência no primeiro 429/5xx.
 */
export async function findExistingNuvemshopListing(skus: string[]): Promise<{ externalId: string } | null> {
  const seen = new Set<string>();
  for (const raw of skus) {
    const sku = raw.trim();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const probe: MasterProduct = { id: sku, sku, ean: null, price: null, stock: null };
    try {
      const found = await fetchNuvemshopListing(probe, {
        timeoutMs: NUVEMSHOP_EXISTENCE_TIMEOUT_MS,
        skuOnly: true,
      });
      if (found) return { externalId: found.externalId };
    } catch (error) {
      if (error instanceof NuvemshopListingError) {
        throw new NuvemshopPublishError(error.status, error.message);
      }
      throw error;
    }
  }
  return null;
}

/** Cria o produto na loja. Se algum SKU já existe lá, devolve o id sem um segundo POST. */
export async function createNuvemshopListing(draft: ListingDraft): Promise<ListingResult> {
  const sku = draft.sku.trim();
  if (!sku) throw new NuvemshopPublishError(400, 'Sem SKU — não sincroniza');

  // Valida o payload antes de qualquer chamada de rede (falha rápida e determinística).
  const body = buildNuvemshopProductBody(draft);

  const auth = await nuvemshopAuth();
  const existing = await findExistingNuvemshopListing([
    sku,
    ...(draft.variants ?? []).map((variant) => variant.sku),
  ]);
  if (existing) {
    await syncNuvemshopImages(existing.externalId, draft.images, auth);
    return { performed: true, reason: 'ja_existia', externalId: existing.externalId };
  }

  const response = await nuvemshopFetch(`${apiBase(auth.storeId)}/products`, {
    method: 'POST',
    headers: apiHeaders(auth, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status !== 200 && response.status !== 201) {
    throw new NuvemshopPublishError(response.status, publishMessage(response.status, payload));
  }
  const id = payload && typeof payload === 'object' ? (payload as { id?: unknown }).id : undefined;
  if (id === undefined || id === null || String(id).trim() === '') {
    throw new NuvemshopPublishError(502, 'Nuvemshop não devolveu o id do anúncio.');
  }
  await syncNuvemshopImages(String(id), draft.images, auth);
  return { performed: true, reason: 'criado', externalId: String(id) };
}

interface NuvemshopImage {
  src?: unknown;
}

async function readNuvemshopImageSrcs(externalId: string, auth: NuvemshopAuth): Promise<string[]> {
  const response = await nuvemshopFetch(
    `${apiBase(auth.storeId)}/products/${encodeURIComponent(externalId)}/images?per_page=200`,
    { headers: apiHeaders(auth), signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS) }
  );
  if (response.status < 200 || response.status >= 300) {
    throw new NuvemshopPublishError(
      response.status,
      `Nuvemshop respondeu ${response.status} ao listar as imagens do anúncio ${externalId}.`
    );
  }
  const body = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(body)) return [];
  return body
    .map((item) => (item && typeof item === 'object' ? (item as NuvemshopImage).src : null))
    .map((src) => (typeof src === 'string' ? src.trim() : ''))
    .filter((src) => src.length > 0);
}

/**
 * Reconcilia imagens por URL: só envia o src que não existe no anúncio.
 * Capa primeiro porque o draft já vem ordenado; position = existentes + i + 1.
 * Limitação V1: a Nuvemshop pode reescrever src para o CDN dela, e nesse caso
 * o Set não casa no retry. Resolver em P1 com mapa listing/position/sha256.
 */
export async function syncNuvemshopImages(
  externalId: string,
  images: string[] | undefined,
  auth: NuvemshopAuth
): Promise<void> {
  const planned = [...new Set((images ?? []).map((src) => src.trim()).filter(Boolean))].slice(
    0,
    NUVEMSHOP_MAX_IMAGES
  );
  if (planned.length === 0) return;

  const existing = new Set(await readNuvemshopImageSrcs(externalId, auth));
  const missing = planned.filter((src) => !existing.has(src));

  let position = existing.size;
  for (const src of missing) {
    if (position >= NUVEMSHOP_MAX_IMAGES) break;
    position += 1;
    const response = await nuvemshopFetch(
      `${apiBase(auth.storeId)}/products/${encodeURIComponent(externalId)}/images`,
      {
        method: 'POST',
        headers: apiHeaders(auth, true),
        body: JSON.stringify({ src, position }),
        signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS),
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new NuvemshopPublishError(response.status, `Nuvemshop respondeu ${response.status} ao enviar a imagem.`);
    }
  }
}
