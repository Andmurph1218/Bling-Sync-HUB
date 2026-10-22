/**
 * Passo 7 — Primeira sincronização REAL de catálogo em modo SHADOW.
 *
 * Executa (run: `npx tsx src/scripts/shadow-sync.ts` a partir de apps/api):
 * 1. Leitura real do Bling v3 (produtos, detalhe, estoques/saldos, produtos/lojas)
 *    respeitando o rate limiter global de 3 req/s (sharedBlingRateLimiter, 'full_enrich').
 * 2. Upsert no catálogo local + saldos + preços de loja (runFullProductCatalogPipeline).
 * 3. Leitura real do Mercado Livre (itens do seller) e Nuvemshop (produtos da loja 6667412).
 * 4. PIRE por família User Product / item legado / produto Nuvemshop; VIR quando auto_linked.
 * 5. GVE (EANs externos), NVE (observações de NCM do ML), CQS em shadow e IQRE (enqueue).
 * 6. Resumo JSON no stdout. CQS/controles permanecem em mode='shadow'.
 */

import { getPool, query } from '../db/pool.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import { sharedBlingRateLimiter } from '../connectors/bling-rate-limiter.js';
import { refreshBlingTokenViaHttp } from '../routes/oauth.js';
import {
  runFullProductCatalogPipeline,
} from '../orchestrator/pipeline.js';
import {
  cleanDigitsOnly,
  extractMlSku,
  mapMercadoLivreListingGroup,
  mapNuvemshopProduct,
  MappedMlProductGroup,
  MappedNuvemshopProduct,
} from '../contracts/mappers.js';
import {
  BlingProductPayload,
  BlingStockBalanceItem,
} from '../contracts/fixtures/bling.fixtures.js';
import {
  MlAttributePayload,
  MlItemPayload,
} from '../contracts/fixtures/mercadolivre.fixtures.js';
import { NuvemshopProductPayload } from '../contracts/fixtures/nuvemshop.fixtures.js';
import {
  PireExternalItemInput,
  resolveMlUserProductFamilyPire,
  resolvePlatformItemPire,
} from '../engines/pire.js';
import {
  ExternalChannelVariantInput,
  RawExternalAttribute,
  resolveProductVariantsVir,
} from '../engines/vir.js';
import { evaluateProductGve, VariantExternalEanCandidate } from '../engines/gve.js';
import { evaluateProductNve, VariantNcmObservation } from '../engines/nve.js';
import { evaluateAndApplyCqsEnrichment } from '../engines/cqs.js';
import {
  EnqueueImageCandidate,
  enqueueProductImagesForSync,
} from '../engines/iqre.js';
import { VariantReadinessResult } from '../engines/cre.js';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';
const ML_BASE = 'https://api.mercadolibre.com';
const NS_BASE = 'https://api.nuvemshop.com.br/2025-03';
const NS_STORE_ID = '6667412';
const ML_SELLER_ID = '184060242';
const BLING_PRODUCT_LIMIT = 15;

const tokenManager = new OAuthTokenManager();
const neverRefresh = async (): Promise<never> => {
  throw new Error('Refresh token indisponível para este provider');
};

interface ProductRunRecord {
  blingId: string;
  sku: string;
  name: string;
  masterProductId: string;
  variantIdsBySku: Record<string, string>;
  readiness: VariantReadinessResult[];
  error?: string;
}

const summary = {
  bling: {
    productsFetched: 0,
    productsUpserted: 0,
    productsSkippedNonP: 0,
    variantsUpserted: 0,
    stockBalancesApplied: 0,
    storePriceRowsApplied: 0,
    apiErrors: [] as string[],
  },
  mercadolivre: {
    itemsFetched: 0,
    familiesProcessed: 0,
    legacyItemsProcessed: 0,
    autoLinked: 0,
    suggestions: 0,
    quarantines: 0,
    virVariantsLinked: 0,
    apiErrors: [] as string[],
  },
  nuvemshop: {
    productsFetched: 0,
    autoLinked: 0,
    suggestions: 0,
    quarantines: 0,
    virVariantsLinked: 0,
    apiErrors: [] as string[],
  },
  enrichment: {
    gveExternalEansEvaluated: 0,
    nveObservations: 0,
    cqsRuns: 0,
    cqsShadowOutcomes: 0,
    imagesEnqueued: 0,
  },
  controls: {
    enrichmentControls: [] as Array<{ platform: string; mode: string; kill_switch: boolean }>,
    shadowModeVerified: false,
  },
  products: [] as ProductRunRecord[],
  errors: [] as string[],
};

let blingAccessToken: string | null = null;

async function refreshBlingAccessToken(staleToken?: string): Promise<string> {
  blingAccessToken = await tokenManager.getValidAccessToken('bling', refreshBlingTokenViaHttp, {
    forceRefresh: true,
    knownStaleAccessToken: staleToken,
  });
  return blingAccessToken;
}

async function blingGet<T>(_accessToken: string, path: string): Promise<T> {
  return sharedBlingRateLimiter.schedule('full_enrich', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${BLING_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${blingAccessToken}`,
          Accept: 'application/json',
        },
      });
      if (res.status === 401 && attempt === 0) {
        await refreshBlingAccessToken(blingAccessToken ?? undefined);
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    }
    throw new Error(`GET ${path} -> 401 persistente após refresh`);
  });
}

async function mlGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${ML_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function nsGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${NS_BASE}${path}`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      'User-Agent': 'BlingSyncHUB (shadow-sync)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Normaliza um item real do ML (/items) no shape MlItemPayload esperado pelos mappers. */
function normalizeMlItem(raw: Record<string, unknown>): MlItemPayload {
  const attrs = Array.isArray(raw.attributes) ? (raw.attributes as MlAttributePayload[]) : [];
  const variations = Array.isArray(raw.variations)
    ? (raw.variations as MlItemPayload['variations'])
    : [];
  return {
    id: String(raw.id ?? ''),
    site_id: 'MLB',
    title: String(raw.title ?? ''),
    seller_id: Number(raw.seller_id ?? ML_SELLER_ID),
    category_id: String(raw.category_id ?? ''),
    price: Number(raw.price ?? 0),
    currency_id: 'BRL',
    available_quantity: Number(raw.available_quantity ?? 0),
    status: (raw.status as MlItemPayload['status']) ?? 'active',
    seller_custom_field: (raw.seller_custom_field as string | null | undefined) ?? null,
    user_product_id: (raw.user_product_id as string | null | undefined) ?? null,
    family_id: (raw.family_id as string | null | undefined) ?? null,
    family_name: (raw.family_name as string | null | undefined) ?? null,
    inventory_id: (raw.inventory_id as string | null | undefined) ?? null,
    shipping: raw.shipping as MlItemPayload['shipping'],
    attributes: attrs,
    variations: variations.map((v) => ({
      ...v,
      attributes: Array.isArray(v.attributes) ? v.attributes : [],
      attribute_combinations: Array.isArray(v.attribute_combinations)
        ? v.attribute_combinations
        : [],
      picture_ids: Array.isArray(v.picture_ids) ? v.picture_ids : [],
    })),
  };
}

function gtinsFromMlCarrier(carrier: {
  attributes?: MlAttributePayload[];
}): string[] {
  return (carrier.attributes ?? [])
    .filter((a) => a.id === 'GTIN' && a.value_name)
    .map((a) => cleanDigitsOnly(a.value_name))
    .filter((v): v is string => Boolean(v));
}

function collectMlSkusAndEans(items: MlItemPayload[]): { skus: string[]; eans: string[] } {
  const skus = new Set<string>();
  const eans = new Set<string>();
  for (const item of items) {
    const { sku } = extractMlSku(item);
    if (sku) skus.add(sku);
    for (const e of gtinsFromMlCarrier(item)) eans.add(e);
    for (const v of item.variations) {
      const vs = extractMlSku(v);
      if (vs.sku) skus.add(vs.sku);
      for (const e of gtinsFromMlCarrier(v)) eans.add(e);
    }
  }
  return { skus: Array.from(skus), eans: Array.from(eans) };
}

function mlGroupToVirVariants(group: MappedMlProductGroup, items: MlItemPayload[]): ExternalChannelVariantInput[] {
  // raw_attributes: variações legadas usam attribute_combinations; User Product usa attributes com allow_variations/CHILD_PK
  const attrsByUpId = new Map<string, RawExternalAttribute[]>();
  for (const item of items) {
    if (item.user_product_id) {
      const raw = (item.attributes ?? [])
        .filter((a) => a.tags?.allow_variations || a.tags?.CHILD_PK || ['COLOR', 'SIZE'].includes(a.id))
        .map((a) => ({ axisNameOrId: a.id, value: a.value_name ?? '' }));
      if (raw.length > 0) attrsByUpId.set(item.user_product_id, raw);
    }
  }
  const attrsByVariationId = new Map<string, RawExternalAttribute[]>();
  for (const item of items) {
    for (const v of item.variations) {
      attrsByVariationId.set(
        String(v.id),
        (v.attribute_combinations ?? [])
          .filter((a) => a.value_name)
          .map((a) => ({ axisNameOrId: a.id, value: a.value_name ?? '' }))
      );
    }
  }

  return group.variants.map((v) => ({
    platform_variant_id: v.platform_variant_id,
    user_product_id: v.user_product_id,
    sku: v.platform_sku_raw,
    platform_sku_field: v.platform_sku_field,
    ean: v.platform_ean,
    price: v.platform_price,
    stock: v.platform_stock,
    raw_attributes:
      (v.user_product_id ? attrsByUpId.get(v.user_product_id) : undefined) ??
      attrsByVariationId.get(v.platform_variant_id) ??
      [],
    selling_conditions: v.selling_conditions.map((sc) => ({
      item_id: sc.item_id,
      listing_status: sc.listing_status,
      price: sc.price,
      logistic_type: sc.logistic_type,
      inventory_id: sc.inventory_id,
    })),
  }));
}

function nsMappedToVirVariants(mapped: MappedNuvemshopProduct, payload: NuvemshopProductPayload): ExternalChannelVariantInput[] {
  const axisNames = (payload.attributes ?? []).map(
    (a) => a.pt ?? a.es ?? a.en ?? ''
  );
  const valuesByVariantId = new Map<string, RawExternalAttribute[]>();
  for (const v of payload.variants ?? []) {
    const raw: RawExternalAttribute[] = [];
    const values = v.values ?? [];
    for (let i = 0; i < values.length; i++) {
      const axis = axisNames[i];
      const val = values[i]?.pt ?? values[i]?.es ?? values[i]?.en;
      if (axis && val) raw.push({ axisNameOrId: axis, value: val });
    }
    valuesByVariantId.set(String(v.id), raw);
  }
  return mapped.variants.map((v) => ({
    platform_variant_id: v.platform_variant_id,
    sku: v.sku,
    ean: v.ean,
    price: v.price,
    stock: v.stock,
    raw_attributes: valuesByVariantId.get(v.platform_variant_id) ?? [],
  }));
}

async function runShadowSync(): Promise<void> {
  // 0. Verifica controles em modo shadow (não altera nada)
  const controlsRes = await query<{ platform: string; mode: string; kill_switch: boolean }>(
    `SELECT platform, mode, kill_switch FROM enrichment_controls ORDER BY platform`
  );
  summary.controls.enrichmentControls = controlsRes.rows;
  summary.controls.shadowModeVerified =
    controlsRes.rows.length > 0 && controlsRes.rows.every((r) => r.mode === 'shadow');
  if (!summary.controls.shadowModeVerified) {
    throw new Error('enrichment_controls não está integralmente em mode=shadow — abortando');
  }

  blingAccessToken = await tokenManager.getValidAccessToken('bling', refreshBlingTokenViaHttp);
  const blingToken = blingAccessToken;
  const mlToken = await tokenManager.getValidAccessToken('mercadolivre', neverRefresh);
  const nsToken = await tokenManager.getValidAccessToken('nuvemshop', neverRefresh);

  // Lojas (channel_stores) -> plataforma
  const storesRes = await query<{ platform: string; bling_loja_id: string }>(
    `SELECT platform, bling_loja_id FROM channel_stores`
  );
  const storeIdToPlatform = new Map(storesRes.rows.map((r) => [r.bling_loja_id, r.platform]));

  // ---------- 1. BLING: lista + detalhes ----------
  const listRes = await blingGet<{ data?: Array<{ id: number | string }> }>(
    blingToken,
    `/produtos?limite=${BLING_PRODUCT_LIMIT}&pagina=1`
  );
  const listedIds = (listRes.data ?? []).map((p) => String(p.id)).slice(0, BLING_PRODUCT_LIMIT);
  summary.bling.productsFetched = listedIds.length;

  const payloads: BlingProductPayload[] = [];
  for (const id of listedIds) {
    try {
      const det = await blingGet<{ data?: BlingProductPayload }>(blingToken, `/produtos/${id}`);
      const payload = det.data;
      if (!payload || payload.tipo !== 'P') {
        summary.bling.productsSkippedNonP += 1;
        continue;
      }
      payloads.push(payload);
    } catch (err) {
      summary.bling.apiErrors.push(
        `produto ${id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Mapa blingId -> sku (pai + variações)
  const blingIdToSku = new Map<string, string>();
  const allProductIds = new Set<string>();
  for (const p of payloads) {
    blingIdToSku.set(String(p.id), p.codigo);
    allProductIds.add(String(p.id));
    for (const v of p.variacoes ?? []) {
      blingIdToSku.set(String(v.id), v.codigo);
      allProductIds.add(String(v.id));
    }
  }

  // ---------- 2. BLING: estoques/saldos ----------
  const balancesByBlingId = new Map<string, BlingStockBalanceItem>();
  const idParams = Array.from(allProductIds)
    .map((id) => `idsProdutos[]=${encodeURIComponent(id)}`)
    .join('&');
  try {
    const saldosRes = await blingGet<{ data?: BlingStockBalanceItem[] }>(
      blingToken,
      `/estoques/saldos?${idParams}`
    );
    for (const item of saldosRes.data ?? []) {
      balancesByBlingId.set(String(item.produto?.id), item);
    }
  } catch (err) {
    summary.bling.apiErrors.push(
      `estoques/saldos: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ---------- 3. BLING: produtos/lojas (preços por loja) ----------
  // sku -> platform -> price row
  const storePricesBySku: Record<
    string,
    Partial<Record<'mercadolivre' | 'nuvemshop', { store_price: number | null; store_promotional_price: number | null }>>
  > = {};
  for (const [lojaId, platform] of storeIdToPlatform) {
    if (platform !== 'mercadolivre' && platform !== 'nuvemshop') continue;
    try {
      const lojasRes = await blingGet<{
        data?: Array<{
          codigo?: string;
          preco?: number | null;
          precoPromocional?: number | null;
          produto?: { id: number | string };
        }>;
      }>(blingToken, `/produtos/lojas?idLoja=${encodeURIComponent(lojaId)}`);
      for (const row of lojasRes.data ?? []) {
        const sku =
          (row.produto?.id !== undefined ? blingIdToSku.get(String(row.produto.id)) : undefined) ??
          row.codigo;
        if (!sku) continue;
        const entry = (storePricesBySku[sku] = storePricesBySku[sku] ?? {});
        entry[platform] = {
          store_price: row.preco ?? null,
          store_promotional_price: row.precoPromocional ?? null,
        };
      }
    } catch (err) {
      summary.bling.apiErrors.push(
        `produtos/lojas idLoja=${lojaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ---------- 4. Upsert + estoque + preços + CRE por produto ----------
  const productRuns: ProductRunRecord[] = [];
  const skuToVariantId = new Map<string, string>();
  for (const payload of payloads) {
    const stockBalancesBySku: Record<string, BlingStockBalanceItem> = {};
    stockBalancesBySku[payload.codigo] =
      balancesByBlingId.get(String(payload.id)) ??
      ({ produto: { id: payload.id }, saldoFisicoTotal: 0, saldoVirtualTotal: 0, depositos: [] } as BlingStockBalanceItem);
    for (const v of payload.variacoes ?? []) {
      const bal = balancesByBlingId.get(String(v.id));
      if (bal) stockBalancesBySku[v.codigo] = bal;
    }
    if (!balancesByBlingId.has(String(payload.id))) {
      delete stockBalancesBySku[payload.codigo];
    }

    try {
      const report = await runFullProductCatalogPipeline({
        blingPayload: payload,
        stockBalancesBySku,
        storePricesBySku: Object.fromEntries(
          Object.entries(storePricesBySku).filter(([sku]) =>
            sku === payload.codigo || (payload.variacoes ?? []).some((v) => v.codigo === sku)
          )
        ),
      });
      summary.bling.productsUpserted += 1;
      const variantSkus = Object.keys(report.variantIdsBySku);
      summary.bling.variantsUpserted += variantSkus.length;
      for (const sku of variantSkus) {
        skuToVariantId.set(sku, report.variantIdsBySku[sku]!);
      }
      summary.bling.stockBalancesApplied += Object.keys(stockBalancesBySku).length;
      productRuns.push({
        blingId: String(payload.id),
        sku: payload.codigo,
        name: payload.nome,
        masterProductId: report.masterProductId,
        variantIdsBySku: report.variantIdsBySku,
        readiness: report.readinessReport.variants,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`pipeline produto ${payload.codigo}: ${msg}`);
      productRuns.push({
        blingId: String(payload.id),
        sku: payload.codigo,
        name: payload.nome,
        masterProductId: '',
        variantIdsBySku: {},
        readiness: [],
        error: msg,
      });
    }
  }

  // ---------- 5. MERCADO LIVRE: itens do seller ----------
  const mlItems: MlItemPayload[] = [];
  try {
    const search = await mlGet<{ results?: string[] }>(
      mlToken,
      `/users/${ML_SELLER_ID}/items/search?limit=50`
    );
    const ids = (search.results ?? []).slice(0, 50);
    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);
      const rows = await mlGet<Array<{ code?: number; body?: Record<string, unknown> }>>(
        mlToken,
        `/items?ids=${batch.join(',')}`
      );
      for (const row of rows) {
        if (row.code === 200 && row.body) mlItems.push(normalizeMlItem(row.body));
      }
    }
  } catch (err) {
    summary.mercadolivre.apiErrors.push(err instanceof Error ? err.message : String(err));
  }
  summary.mercadolivre.itemsFetched = mlItems.length;

  // Agrupa por família (family_id || user_product_id) ou item solto
  const mlGroups = new Map<string, MlItemPayload[]>();
  for (const item of mlItems) {
    const key = item.family_id ?? item.user_product_id ?? item.id;
    const arr = mlGroups.get(key) ?? [];
    arr.push(item);
    mlGroups.set(key, arr);
  }

  const imagesByMaster = new Map<string, EnqueueImageCandidate[]>();
  const externalEanCandidates: VariantExternalEanCandidate[] = [];
  const ncmObservationsByMaster = new Map<string, VariantNcmObservation[]>();
  const addImage = (masterId: string, cand: EnqueueImageCandidate) => {
    const arr = imagesByMaster.get(masterId) ?? [];
    arr.push(cand);
    imagesByMaster.set(masterId, arr);
  };
  const variantIdForSku = (sku: string | null | undefined): string | null =>
    sku ? skuToVariantId.get(sku) ?? null : null;

  const runCqsForLinked = async (
    masterId: string,
    platform: 'mercadolivre' | 'nuvemshop',
    linked: Array<{ variant_id: string; platform_variant_id: string }>,
    variants: ExternalChannelVariantInput[],
    candidateBase: { title?: string | null; description?: string | null; brand?: string | null }
  ) => {
    for (const lv of linked) {
      try {
        const rep = await evaluateAndApplyCqsEnrichment({
          masterProductId: masterId,
          variantId: lv.variant_id,
          candidate: { platform, ...candidateBase },
        });
        summary.enrichment.cqsRuns += 1;
        summary.enrichment.cqsShadowOutcomes += rep.outcomes.filter(
          (o) => o.mode === 'shadow'
        ).length;
      } catch (err) {
        summary.errors.push(`cqs ${platform} ${lv.platform_variant_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    void variants;
  };

  for (const [groupKey, items] of mlGroups) {
    try {
      const group = mapMercadoLivreListingGroup(items);
      const virVariants = mlGroupToVirVariants(group, items);
      const { skus, eans } = collectMlSkusAndEans(items);
      const brand = items[0]?.attributes.find((a) => a.id === 'BRAND')?.value_name ?? null;
      const ncm = items[0]?.attributes.find((a) => a.id === 'NCM')?.value_name ?? null;

      const pireItems: PireExternalItemInput[] = items.map((item) => ({
        platform: 'mercadolivre',
        platform_product_id: group.platform_product_id,
        item_id: item.id,
        title: item.title,
        skus: collectMlSkusAndEans([item]).skus,
        platform_sku_field: extractMlSku(item).field,
        eans: collectMlSkusAndEans([item]).eans,
        price: item.price,
        ml_model: group.ml_model,
        family_id: group.family_id,
        family_name: group.family_name,
        raw_payload: item as unknown as Record<string, unknown>,
      }));

      let linkedMasterId: string | null = null;
      if (group.ml_model === 'user_product' && group.family_id) {
        summary.mercadolivre.familiesProcessed += 1;
        const res = await resolveMlUserProductFamilyPire(
          group.family_id,
          group.family_name ?? groupKey,
          pireItems
        );
        if (res.outcome === 'auto_linked' || res.outcome === 'already_terminal') {
          linkedMasterId = res.master_product_id;
          summary.mercadolivre.autoLinked += 1;
        } else if (res.outcome === 'suggestion') summary.mercadolivre.suggestions += 1;
        else summary.mercadolivre.quarantines += 1;
      } else {
        summary.mercadolivre.legacyItemsProcessed += 1;
        const res = await resolvePlatformItemPire({
          platform: 'mercadolivre',
          platform_product_id: group.platform_product_id,
          title: items[0]?.title ?? '',
          skus,
          eans,
          price: items[0]?.price ?? null,
          ml_model: 'legacy_variations',
          raw_payload: items[0] as unknown as Record<string, unknown>,
        });
        if (res.outcome === 'auto_linked' || res.outcome === 'already_terminal') {
          linkedMasterId = res.master_product_id;
          summary.mercadolivre.autoLinked += 1;
        } else if (res.outcome === 'suggestion') summary.mercadolivre.suggestions += 1;
        else summary.mercadolivre.quarantines += 1;
      }

      if (linkedMasterId) {
        const vir = await resolveProductVariantsVir({
          masterProductId: linkedMasterId,
          platform: 'mercadolivre',
          platformProductId: group.platform_product_id,
          channelVariants: virVariants,
        });
        summary.mercadolivre.virVariantsLinked += vir.linkedVariants.length;

        for (const v of virVariants) {
          const vid = variantIdForSku(v.sku);
          if (vid && v.ean) {
            externalEanCandidates.push({ variant_id: vid, platform: 'mercadolivre', external_ean: v.ean });
          }
          if (vid && ncm) {
            const arr = ncmObservationsByMaster.get(linkedMasterId) ?? [];
            arr.push({ variant_id: vid, ml_attribute_ncm: ncm });
            ncmObservationsByMaster.set(linkedMasterId, arr);
          }
        }

        // Imagens do anúncio (pictures no payload real do /items)
        for (const rawItem of items) {
          const pics = (rawItem as unknown as { pictures?: Array<{ url?: string }> }).pictures ?? [];
          for (const pic of pics) {
            if (pic.url) addImage(linkedMasterId, { source_url: pic.url, source_platform: 'mercadolivre' });
          }
        }

        await runCqsForLinked(linkedMasterId, 'mercadolivre', vir.linkedVariants, virVariants, {
          title: items[0]?.title ?? null,
          brand,
        });
      }
    } catch (err) {
      summary.mercadolivre.apiErrors.push(
        `grupo ${groupKey}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ---------- 6. NUVEMSHOP ----------
  let nsProducts: NuvemshopProductPayload[] = [];
  try {
    const res = await nsGet<NuvemshopProductPayload[] | { data?: NuvemshopProductPayload[] }>(
      nsToken,
      `/${NS_STORE_ID}/products?per_page=50`
    );
    nsProducts = Array.isArray(res) ? res : res.data ?? [];
  } catch (err) {
    summary.nuvemshop.apiErrors.push(err instanceof Error ? err.message : String(err));
  }
  summary.nuvemshop.productsFetched = nsProducts.length;

  for (const nsPayload of nsProducts) {
    try {
      const mapped = mapNuvemshopProduct(nsPayload);
      const virVariants = nsMappedToVirVariants(mapped, nsPayload);
      const skus = Array.from(
        new Set(mapped.variants.map((v) => v.sku).filter((s): s is string => Boolean(s)))
      );
      const eans = Array.from(
        new Set(mapped.variants.map((v) => v.ean).filter((e): e is string => Boolean(e)))
      );
      const pireRes = await resolvePlatformItemPire({
        platform: 'nuvemshop',
        platform_product_id: mapped.platform_product_id,
        title: mapped.title,
        skus,
        eans,
        price: mapped.variants[0]?.price ?? null,
        raw_payload: nsPayload as unknown as Record<string, unknown>,
      });
      let linkedMasterId: string | null = null;
      if (pireRes.outcome === 'auto_linked' || pireRes.outcome === 'already_terminal') {
        linkedMasterId = pireRes.master_product_id;
        summary.nuvemshop.autoLinked += 1;
      } else if (pireRes.outcome === 'suggestion') summary.nuvemshop.suggestions += 1;
      else summary.nuvemshop.quarantines += 1;

      if (linkedMasterId) {
        const vir = await resolveProductVariantsVir({
          masterProductId: linkedMasterId,
          platform: 'nuvemshop',
          platformProductId: mapped.platform_product_id,
          channelVariants: virVariants,
        });
        summary.nuvemshop.virVariantsLinked += vir.linkedVariants.length;

        for (const v of virVariants) {
          const vid = variantIdForSku(v.sku);
          if (vid && v.ean) {
            externalEanCandidates.push({ variant_id: vid, platform: 'nuvemshop', external_ean: v.ean });
          }
        }

        const images = (nsPayload as unknown as { images?: Array<{ src?: string }> }).images ?? [];
        for (const img of images) {
          if (img.src) addImage(linkedMasterId, { source_url: img.src, source_platform: 'nuvemshop' });
        }

        await runCqsForLinked(linkedMasterId, 'nuvemshop', vir.linkedVariants, virVariants, {
          title: mapped.title,
          description: mapped.description,
          brand: mapped.brand,
        });
      }
    } catch (err) {
      summary.nuvemshop.apiErrors.push(
        `produto ${nsPayload.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ---------- 7. GVE (EANs externos), NVE (observações ML), IQRE ----------
  const eansByMaster = new Map<string, VariantExternalEanCandidate[]>();
  const masterByVariantId = new Map<string, string>();
  for (const run of productRuns) {
    for (const vid of Object.values(run.variantIdsBySku)) {
      masterByVariantId.set(vid, run.masterProductId);
    }
  }
  for (const cand of externalEanCandidates) {
    const mid = masterByVariantId.get(cand.variant_id);
    if (!mid) continue;
    const arr = eansByMaster.get(mid) ?? [];
    arr.push(cand);
    eansByMaster.set(mid, arr);
  }
  for (const [mid, cands] of eansByMaster) {
    try {
      await evaluateProductGve(mid, cands);
      summary.enrichment.gveExternalEansEvaluated += cands.length;
    } catch (err) {
      summary.errors.push(`gve ${mid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const [mid, obs] of ncmObservationsByMaster) {
    try {
      await evaluateProductNve(mid, obs);
      summary.enrichment.nveObservations += obs.length;
    } catch (err) {
      summary.errors.push(`nve ${mid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const [mid, cands] of imagesByMaster) {
    try {
      const res = await enqueueProductImagesForSync(mid, cands);
      summary.enrichment.imagesEnqueued += res.enqueuedCount;
    } catch (err) {
      summary.errors.push(`iqre ${mid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------- 8. Contagens finais no banco ----------
  const count = async (sql: string): Promise<number> => {
    const r = await query<{ count: number }>(sql);
    return r.rows[0]?.count ?? 0;
  };
  const [links, platformItemsByStatus, matchingPending, eanPending, ncmSugg, imgQueued, pricesCount] =
    await Promise.all([
      count(`SELECT count(*)::int AS count FROM platform_links`),
      query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM platform_items GROUP BY status`
      ),
      count(`SELECT count(*)::int AS count FROM matching_queue WHERE status = 'pending'`),
      count(`SELECT count(*)::int AS count FROM ean_pending_validation WHERE status = 'pending'`),
      count(`SELECT count(*)::int AS count FROM ncm_manual_suggestions`),
      count(`SELECT count(*)::int AS count FROM image_processing_queue WHERE stage = 'queued'`),
      count(`SELECT count(*)::int AS count FROM variant_channel_prices`),
    ]);
  summary.bling.storePriceRowsApplied = pricesCount;
  summary.products = productRuns;

  const blockerSample: string[] = [];
  for (const run of productRuns) {
    for (const v of run.readiness) {
      for (const b of v.blockers) {
        if (!blockerSample.includes(b)) blockerSample.push(b);
      }
    }
  }

  const finalSummary = {
    ...summary,
    dbCounts: {
      platformLinksTotal: links,
      platformItemsByStatus: Object.fromEntries(
        platformItemsByStatus.rows.map((r) => [r.status, r.count])
      ),
      matchingQueuePending: matchingPending,
      eanPendingValidation: eanPending,
      ncmSuggestions: ncmSugg,
      imagesQueued: imgQueued,
    },
    creTopBlockers: blockerSample.slice(0, 10),
  };

  console.log(JSON.stringify(finalSummary, null, 2));
}

runShadowSync()
  .then(async () => {
    await getPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('SHADOW SYNC FAILED:', err instanceof Error ? err.message : String(err));
    try {
      console.log(JSON.stringify(summary, null, 2));
    } catch {
      /* noop */
    }
    await getPool().end();
    process.exit(1);
  });
