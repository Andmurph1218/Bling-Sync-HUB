import {
  BlingProductPayload,
  BlingStockBalanceItem,
} from './fixtures/bling.fixtures.js';
import {
  MlAttributePayload,
  MlItemPayload,
  MlUserProductStockResponse,
  MlUptinMigrationNotification,
} from './fixtures/mercadolivre.fixtures.js';
import { NuvemshopProductPayload } from './fixtures/nuvemshop.fixtures.js';

export interface MappedVariantAttribute {
  axisCanonicalName: string;
  axisDisplayName: string;
  value: string;
}

export interface MappedComponent {
  component_bling_id: string;
  quantity: number;
}

export interface MappedProductVariant {
  bling_variant_id: string | null;
  bling_sku: string;
  is_default: boolean;
  bling_formato: 'S' | 'E';
  stock_mode: 'physical' | 'virtual' | null;
  price: number;
  cost_price: number | null;
  /** Nasce SEMPRE nulo no mapper de produto; só GET /estoques/saldos preenche */
  stock: null;
  net_weight: number | null;
  gross_weight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  ean: string | null;
  is_active: boolean;
  variant_status: 'active' | 'inactive' | 'discontinued';
  attributes: MappedVariantAttribute[];
  comboKey: string | null;
  components: MappedComponent[];
  raw_variation_ncm: string | null;
}

export interface MappedMasterProduct {
  bling_id: string;
  bling_sku: string;
  bling_tipo: 'P';
  bling_formato: 'S' | 'V' | 'E';
  name: string;
  short_description: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  unit: string | null;
  ncm: string | null;
  cest: string | null;
  tax_origin: number | null;
  requires_cest: boolean;
  catalog_status: 'active' | 'inactive' | 'deleted';
  product_axes: string[];
  variants: MappedProductVariant[];
}

export type MapBlingProductResult =
  | { kind: 'mapped'; product: MappedMasterProduct }
  | { kind: 'ignored_service'; reason: 'service'; bling_id: string };

export function cleanDigitsOnly(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  return digits.length > 0 ? digits : null;
}

export function parseBlingVariationSpec(specName: string): MappedVariantAttribute[] {
  if (!specName || !specName.trim()) return [];
  const pairs = specName
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);

  const attrs: MappedVariantAttribute[] = [];
  for (const pair of pairs) {
    const [rawAxis, ...rest] = pair.split(':');
    const rawValue = rest.join(':').trim();
    if (!rawAxis || !rawValue) continue;
    const displayName = rawAxis.trim();
    const canonicalName = displayName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    attrs.push({
      axisCanonicalName: canonicalName,
      axisDisplayName: displayName,
      value: rawValue,
    });
  }

  return attrs.sort((a, b) => a.axisCanonicalName.localeCompare(b.axisCanonicalName));
}

export function buildComboKey(attrs: MappedVariantAttribute[]): string | null {
  if (attrs.length === 0) return null;
  const sorted = [...attrs].sort((a, b) =>
    a.axisCanonicalName.localeCompare(b.axisCanonicalName)
  );
  return sorted.map((a) => `${a.axisCanonicalName}:${a.value}`).join('|');
}

function mapSituacaoToCatalogStatus(situacao: 'A' | 'I' | 'E'): 'active' | 'inactive' | 'deleted' {
  if (situacao === 'I') return 'inactive';
  if (situacao === 'E') return 'deleted';
  return 'active';
}

function mapSituacaoToVariantStatus(
  situacao: 'A' | 'I' | 'E'
): 'active' | 'inactive' | 'discontinued' {
  if (situacao === 'I') return 'inactive';
  if (situacao === 'E') return 'discontinued';
  return 'active';
}

/**
 * Mapeia o payload de produto do Bling v3 para master_products + product_variants.
 * Garante as regras das seções 2, 9.2, 10.3 e 10.7:
 * - Serviço (tipo != 'P') é ignorado (reason = 'service').
 * - Simples (S): 1 variante default, sem bling_variant_id, mesmo SKU do pai.
 * - Kit sem grade (E): 1 variante default com formato E, stock_mode e componentes.
 * - Grade (V): nenhuma variante is_default, cada variação com bling_variant_id e formato S ou E.
 * - product_variants.stock nasce SEMPRE nulo (nunca copia estoque.saldoVirtualTotal).
 * - cest, tax_origin e requires_cest são espelhados do Bling.
 */
export function mapBlingProductToCatalog(payload: BlingProductPayload): MapBlingProductResult {
  if (payload.tipo !== 'P') {
    return {
      kind: 'ignored_service',
      reason: 'service',
      bling_id: String(payload.id),
    };
  }

  const ncmDigits = cleanDigitsOnly(payload.tributacao?.ncm);
  const cestDigits = cleanDigitsOnly(payload.tributacao?.cest);
  const catalogStatus = mapSituacaoToCatalogStatus(payload.situacao);
  const variantStatus = mapSituacaoToVariantStatus(payload.situacao);

  if (payload.formato === 'S' || payload.formato === 'E') {
    const isKit = payload.formato === 'E';
    const stockMode = isKit
      ? payload.estrutura?.tipoEstoque === 'F'
        ? 'physical'
        : 'virtual'
      : null;
    const components: MappedComponent[] = isKit
      ? (payload.estrutura?.componentes ?? []).map((c) => ({
          component_bling_id: String(c.produto.id),
          quantity: c.quantidade,
        }))
      : [];

    const defaultVariant: MappedProductVariant = {
      bling_variant_id: null,
      bling_sku: payload.codigo,
      is_default: true,
      bling_formato: payload.formato,
      stock_mode: stockMode,
      price: payload.preco,
      cost_price: payload.precoCusto ?? null,
      stock: null,
      net_weight: payload.pesoLiquido ?? null,
      gross_weight: payload.pesoBruto ?? null,
      width: payload.dimensoes?.largura ?? null,
      height: payload.dimensoes?.altura ?? null,
      depth: payload.dimensoes?.profundidade ?? null,
      ean: cleanDigitsOnly(payload.gtin),
      is_active: catalogStatus === 'active',
      variant_status: variantStatus,
      attributes: [],
      comboKey: null,
      components,
      raw_variation_ncm: ncmDigits,
    };

    return {
      kind: 'mapped',
      product: {
        bling_id: String(payload.id),
        bling_sku: payload.codigo,
        bling_tipo: 'P',
        bling_formato: payload.formato,
        name: payload.nome,
        short_description: payload.descricaoCurta ?? null,
        description: payload.descricaoComplementar ?? null,
        brand: payload.marca ?? null,
        category: payload.categoria?.descricao ?? null,
        unit: payload.unidade ?? null,
        ncm: ncmDigits,
        cest: cestDigits,
        tax_origin: payload.tributacao?.origem ?? null,
        requires_cest: Boolean(cestDigits),
        catalog_status: catalogStatus,
        product_axes: [],
        variants: [defaultVariant],
      },
    };
  }

  // formato === 'V' (Grade de variações)
  const rawVariacoes = payload.variacoes ?? [];
  if (rawVariacoes.length === 0) {
    throw new Error(`Produto formato V (${payload.id}) sem variações no payload`);
  }

  const axesSet = new Set<string>();
  const mappedVariants: MappedProductVariant[] = rawVariacoes.map((v) => {
    const attrs = parseBlingVariationSpec(v.variacao.nome);
    for (const a of attrs) {
      axesSet.add(a.axisCanonicalName);
    }
    const isVarKit = v.formato === 'E';
    const stockMode = isVarKit
      ? v.estrutura?.tipoEstoque === 'F'
        ? 'physical'
        : 'virtual'
      : null;
    const components: MappedComponent[] = isVarKit
      ? (v.estrutura?.componentes ?? []).map((c) => ({
          component_bling_id: String(c.produto.id),
          quantity: c.quantidade,
        }))
      : [];
    const varStatus = mapSituacaoToVariantStatus(v.situacao);

    return {
      bling_variant_id: String(v.id),
      bling_sku: v.codigo,
      is_default: false,
      bling_formato: v.formato,
      stock_mode: stockMode,
      price: v.preco,
      cost_price: v.precoCusto ?? payload.precoCusto ?? null,
      stock: null,
      net_weight: v.pesoLiquido ?? payload.pesoLiquido ?? null,
      gross_weight: v.pesoBruto ?? payload.pesoBruto ?? null,
      width: v.dimensoes?.largura ?? payload.dimensoes?.largura ?? null,
      height: v.dimensoes?.altura ?? payload.dimensoes?.altura ?? null,
      depth: v.dimensoes?.profundidade ?? payload.dimensoes?.profundidade ?? null,
      ean: cleanDigitsOnly(v.gtin),
      is_active: varStatus === 'active' && catalogStatus === 'active',
      variant_status: catalogStatus === 'active' ? varStatus : variantStatus,
      attributes: attrs,
      comboKey: buildComboKey(attrs),
      components,
      raw_variation_ncm: cleanDigitsOnly(v.tributacao?.ncm),
    };
  });

  const productAxes = Array.from(axesSet).sort();

  return {
    kind: 'mapped',
    product: {
      bling_id: String(payload.id),
      bling_sku: payload.codigo,
      bling_tipo: 'P',
      bling_formato: 'V',
      name: payload.nome,
      short_description: payload.descricaoCurta ?? null,
      description: payload.descricaoComplementar ?? null,
      brand: payload.marca ?? null,
      category: payload.categoria?.descricao ?? null,
      unit: payload.unidade ?? null,
      ncm: ncmDigits,
      cest: cestDigits,
      tax_origin: payload.tributacao?.origem ?? null,
      requires_cest: Boolean(cestDigits),
      catalog_status: catalogStatus,
      product_axes: productAxes,
      variants: mappedVariants,
    },
  };
}

export interface WarehouseConfig {
  bling_warehouse_id: string;
  role: 'unclassified' | 'seller' | 'ml_full' | 'other';
  include_in_push: boolean;
}

export interface ComputedStockResult {
  /** Valor numérico exato gravado em product_variants.stock */
  variantStockColumn: number;
  /** Inteiro enviado aos canais no passo stock e no CREATE */
  publishableFloor: number;
  emptySellerPushWarehousesAlert: boolean;
  unclassifiedWarehouseIds: string[];
}

/**
 * Calcula o estoque publicado a partir de GET /estoques/saldos (Seções 2 e 10.7):
 * - Soma apenas saldo_virtual dos depósitos com role = 'seller' e include_in_push = true.
 * - Depósitos ml_full, other e unclassified nunca entram na soma.
 * - Nunca usa saldoVirtualTotal nem subtrai meli_facility.
 */
export function computePublishableStockFromBalances(
  balanceItem: BlingStockBalanceItem,
  warehouses: WarehouseConfig[]
): ComputedStockResult {
  const warehouseMap = new Map<string, WarehouseConfig>(
    warehouses.map((w) => [w.bling_warehouse_id, w])
  );

  const activeSellerWarehouses = warehouses.filter(
    (w) => w.role === 'seller' && w.include_in_push
  );

  const unclassifiedWarehouseIds: string[] = [];
  let sumVirtual = 0;

  for (const dep of balanceItem.depositos) {
    const depId = String(dep.id);
    const cfg = warehouseMap.get(depId);
    if (!cfg || cfg.role === 'unclassified') {
      unclassifiedWarehouseIds.push(depId);
      continue;
    }
    if (cfg.role === 'seller' && cfg.include_in_push) {
      sumVirtual += dep.saldoVirtual;
    }
  }

  const normalizedSum = Number(sumVirtual.toFixed(3));
  return {
    variantStockColumn: normalizedSum,
    publishableFloor: Math.max(0, Math.floor(normalizedSum)),
    emptySellerPushWarehousesAlert: activeSellerWarehouses.length === 0,
    unclassifiedWarehouseIds,
  };
}

export interface ResolveChannelPriceInput {
  catalogPrice: number;
  catalogPromotionalPrice: number | null;
  usePromotional: boolean;
  costPrice: number | null;
  hasChannelStoreConfigured: boolean;
  storePriceRow:
    | {
        store_price: number | null;
        store_promotional_price: number | null;
      }
    | null;
}

export interface ResolvedChannelPriceResult {
  waitingForStoreRead: boolean;
  effectivePrice: number | null;
  source: 'waiting_store_read' | 'catalog_no_store' | 'catalog_fallback' | 'store';
  blockedPriceZero: boolean;
  belowCostCriticalAlert: boolean;
  catalogStoreDivergenceAlert: boolean;
}

/**
 * Resolve o preço publicado por variante segundo os 4 passos da Seção 10.7.
 */
export function resolveVariantChannelPrice(
  input: ResolveChannelPriceInput
): ResolvedChannelPriceResult {
  const effectiveCatalogPrice =
    input.usePromotional &&
    input.catalogPromotionalPrice !== null &&
    input.catalogPromotionalPrice > 0
      ? input.catalogPromotionalPrice
      : input.catalogPrice;

  if (!input.hasChannelStoreConfigured) {
    const blocked = effectiveCatalogPrice <= 0;
    const belowCost =
      !blocked &&
      input.costPrice !== null &&
      effectiveCatalogPrice < input.costPrice;
    return {
      waitingForStoreRead: false,
      effectivePrice: effectiveCatalogPrice,
      source: 'catalog_no_store',
      blockedPriceZero: blocked,
      belowCostCriticalAlert: belowCost,
      catalogStoreDivergenceAlert: false,
    };
  }

  if (input.storePriceRow === null) {
    return {
      waitingForStoreRead: true,
      effectivePrice: null,
      source: 'waiting_store_read',
      blockedPriceZero: false,
      belowCostCriticalAlert: false,
      catalogStoreDivergenceAlert: false,
    };
  }

  if (input.storePriceRow.store_price === null) {
    const blocked = effectiveCatalogPrice <= 0;
    const belowCost =
      !blocked &&
      input.costPrice !== null &&
      effectiveCatalogPrice < input.costPrice;
    return {
      waitingForStoreRead: false,
      effectivePrice: effectiveCatalogPrice,
      source: 'catalog_fallback',
      blockedPriceZero: blocked,
      belowCostCriticalAlert: belowCost,
      catalogStoreDivergenceAlert: false,
    };
  }

  const effectiveStorePrice =
    input.storePriceRow.store_promotional_price !== null &&
    input.storePriceRow.store_promotional_price > 0
      ? input.storePriceRow.store_promotional_price
      : input.storePriceRow.store_price;

  const blocked = effectiveStorePrice <= 0;
  const belowCost =
    !blocked &&
    input.costPrice !== null &&
    effectiveStorePrice < input.costPrice;
  const divergesFromCatalog =
    Math.abs(effectiveStorePrice - effectiveCatalogPrice) >= 0.01;

  return {
    waitingForStoreRead: false,
    effectivePrice: effectiveStorePrice,
    source: 'store',
    blockedPriceZero: blocked,
    belowCostCriticalAlert: belowCost,
    catalogStoreDivergenceAlert: divergesFromCatalog,
  };
}

export type BlingLifecycleInput =
  | {
      type: 'product.updated';
      situacao?: 'A' | 'I' | 'E';
      followUpGetStatus?: 200 | 404;
      followUpGetSituacao?: 'A' | 'I' | 'E';
    }
  | {
      type: 'product.deleted';
      followUpGetStatus: 200 | 404;
    }
  | {
      type: 'scan_poll';
      consecutive404Count: number;
      lastHttpStatus: 200 | 404 | 429 | 500 | 504;
    };

export interface BlingLifecycleResolution {
  statusChanged: boolean;
  catalog_status: 'active' | 'inactive' | 'deleted' | null;
  variant_status: 'active' | 'inactive' | 'discontinued' | null;
  cancelPendingContentAndCreate: boolean;
  commercialExitZeroStockAndPause: boolean;
  prematureDeleteEventAlert: boolean;
}

/**
 * Resolve transições de situação e exclusão do Bling (Seção 10.4):
 * - product.updated com situacao I -> inactive
 * - product.updated com situacao E -> deleted / variantes discontinued
 * - product.deleted + GET 404 -> deleted / variantes discontinued
 * - product.deleted + GET 200 -> NÃO muda status e gera alerta de evento adiantado/divergente
 * - varredura com 1 único 404 ou 429 -> NÃO muda status; 2 GET 404 seguidos -> deleted
 */
export function resolveBlingLifecycleSignal(
  input: BlingLifecycleInput
): BlingLifecycleResolution {
  if (input.type === 'product.updated') {
    const situacao =
      input.situacao ??
      (input.followUpGetStatus === 404 ? 'E' : input.followUpGetSituacao);

    if (!situacao) {
      return {
        statusChanged: false,
        catalog_status: null,
        variant_status: null,
        cancelPendingContentAndCreate: false,
        commercialExitZeroStockAndPause: false,
        prematureDeleteEventAlert: false,
      };
    }

    if (situacao === 'A') {
      return {
        statusChanged: true,
        catalog_status: 'active',
        variant_status: 'active',
        cancelPendingContentAndCreate: false,
        commercialExitZeroStockAndPause: false,
        prematureDeleteEventAlert: false,
      };
    }

    if (situacao === 'I') {
      return {
        statusChanged: true,
        catalog_status: 'inactive',
        variant_status: 'inactive',
        cancelPendingContentAndCreate: true,
        commercialExitZeroStockAndPause: true,
        prematureDeleteEventAlert: false,
      };
    }

    return {
      statusChanged: true,
      catalog_status: 'deleted',
      variant_status: 'discontinued',
      cancelPendingContentAndCreate: true,
      commercialExitZeroStockAndPause: true,
      prematureDeleteEventAlert: false,
    };
  }

  if (input.type === 'product.deleted') {
    if (input.followUpGetStatus === 404) {
      return {
        statusChanged: true,
        catalog_status: 'deleted',
        variant_status: 'discontinued',
        cancelPendingContentAndCreate: true,
        commercialExitZeroStockAndPause: true,
        prematureDeleteEventAlert: false,
      };
    }

    return {
      statusChanged: false,
      catalog_status: null,
      variant_status: null,
      cancelPendingContentAndCreate: false,
      commercialExitZeroStockAndPause: false,
      prematureDeleteEventAlert: true,
    };
  }

  // scan_poll
  if (input.lastHttpStatus === 404 && input.consecutive404Count >= 2) {
    return {
      statusChanged: true,
      catalog_status: 'deleted',
      variant_status: 'discontinued',
      cancelPendingContentAndCreate: true,
      commercialExitZeroStockAndPause: true,
      prematureDeleteEventAlert: false,
    };
  }

  return {
    statusChanged: false,
    catalog_status: null,
    variant_status: null,
    cancelPendingContentAndCreate: false,
    commercialExitZeroStockAndPause: false,
    prematureDeleteEventAlert: false,
  };
}

export interface ClassifiedApiError {
  category:
    | 'rate_limit_429'
    | 'not_found_404'
    | 'version_conflict_409'
    | 'unauthorized_401'
    | 'transient_5xx'
    | 'client_error_4xx';
  retryable: boolean;
  retryAfterMs: number | null;
}

export function classifyApiHttpError(
  status: number,
  headers?: Record<string, string | undefined>
): ClassifiedApiError {
  if (status === 429) {
    const rawRetryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
    const parsedSeconds = rawRetryAfter ? Number(rawRetryAfter) : NaN;
    const retryAfterMs =
      Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds * 1000 : 1000;
    return {
      category: 'rate_limit_429',
      retryable: true,
      retryAfterMs,
    };
  }

  if (status === 404) {
    return { category: 'not_found_404', retryable: false, retryAfterMs: null };
  }

  if (status === 409) {
    return { category: 'version_conflict_409', retryable: true, retryAfterMs: 0 };
  }

  if (status === 401) {
    return { category: 'unauthorized_401', retryable: true, retryAfterMs: 0 };
  }

  if (status >= 500) {
    return { category: 'transient_5xx', retryable: true, retryAfterMs: 1000 };
  }

  return { category: 'client_error_4xx', retryable: false, retryAfterMs: null };
}

export function extractMlSku(
  carrier: {
    seller_sku?: string | null;
    seller_custom_field?: string | null;
    attributes?: MlAttributePayload[];
  }
): { sku: string | null; field: 'seller_sku' | 'seller_custom_field' | 'attributes[SELLER_SKU]' | null } {
  if (carrier.seller_sku && carrier.seller_sku.trim().length > 0) {
    return { sku: carrier.seller_sku.trim(), field: 'seller_sku' };
  }
  if (carrier.seller_custom_field && carrier.seller_custom_field.trim().length > 0) {
    return { sku: carrier.seller_custom_field.trim(), field: 'seller_custom_field' };
  }
  const attr = carrier.attributes?.find((a) => a.id === 'SELLER_SKU');
  if (attr?.value_name && attr.value_name.trim().length > 0) {
    return { sku: attr.value_name.trim(), field: 'attributes[SELLER_SKU]' };
  }
  return { sku: null, field: null };
}

export interface MappedMlSellingCondition {
  item_id: string;
  listing_status: string;
  price: number;
  follow_store_price: boolean;
  follow_set_by: null;
  logistic_type: string | null;
  inventory_id: string | null;
  control_change_entry: {
    target: 'selling_condition';
    target_key: string;
    field: 'follow_store_price';
    old_value: null;
    new_value: 'true' | 'false';
    origin: 'system';
    changed_by: null;
  };
}

export interface MappedMlVariantLink {
  platform_product_id: string;
  platform_variant_id: string;
  user_product_id: string | null;
  platform_sku_raw: string | null;
  platform_sku_field: string | null;
  platform_ean: string | null;
  platform_price: number;
  platform_stock: number;
  selling_conditions: MappedMlSellingCondition[];
}

export interface MappedMlProductGroup {
  ml_model: 'legacy_variations' | 'user_product';
  platform_product_id: string;
  family_id: string | null;
  family_name: string | null;
  variants: MappedMlVariantLink[];
}

/**
 * Mapeia item(ns) do Mercado Livre no modelo Legado ou User Product (Seções 8.1, 8.2, 9.3):
 * - No Legado: platform_product_id = item.id, platform_variant_id = variation.id (ou '' no simples).
 * - No User Product: agrupa por family_id; cada user_product_id é 1 variante na matriz, e múltiplos
 *   itens com o mesmo user_product_id viram linhas em ml_selling_conditions (a 1ª condição nasce
 *   follow_store_price = true e a 2ª nasce false, ambas com registro em control_changes origin = system).
 */
export function mapMercadoLivreListingGroup(items: MlItemPayload[]): MappedMlProductGroup {
  const first = items[0];
  if (!first) {
    throw new Error('Lista de itens do Mercado Livre vazia');
  }

  const isUserProduct = Boolean(first.family_id || first.user_product_id);
  if (!isUserProduct) {
    if (first.variations.length === 0) {
      const { sku, field } = extractMlSku(first);
      const gtinAttr = first.attributes.find((a) => a.id === 'GTIN');
      return {
        ml_model: 'legacy_variations',
        platform_product_id: first.id,
        family_id: null,
        family_name: null,
        variants: [
          {
            platform_product_id: first.id,
            platform_variant_id: '',
            user_product_id: null,
            platform_sku_raw: sku,
            platform_sku_field: field,
            platform_ean: cleanDigitsOnly(gtinAttr?.value_name),
            platform_price: first.price,
            platform_stock: first.available_quantity,
            selling_conditions: [
              {
                item_id: first.id,
                listing_status: first.status,
                price: first.price,
                follow_store_price: true,
                follow_set_by: null,
                logistic_type: first.shipping?.logistic_type ?? null,
                inventory_id: first.inventory_id ?? null,
                control_change_entry: {
                  target: 'selling_condition',
                  target_key: first.id,
                  field: 'follow_store_price',
                  old_value: null,
                  new_value: 'true',
                  origin: 'system',
                  changed_by: null,
                },
              },
            ],
          },
        ],
      };
    }

    const variants: MappedMlVariantLink[] = first.variations.map((v) => {
      const { sku, field } = extractMlSku(v);
      const gtinAttr = v.attributes?.find((a) => a.id === 'GTIN');
      return {
        platform_product_id: first.id,
        platform_variant_id: String(v.id),
        user_product_id: null,
        platform_sku_raw: sku,
        platform_sku_field: field,
        platform_ean: cleanDigitsOnly(gtinAttr?.value_name),
        platform_price: v.price,
        platform_stock: v.available_quantity,
        selling_conditions: [],
      };
    });

    return {
      ml_model: 'legacy_variations',
      platform_product_id: first.id,
      family_id: null,
      family_name: null,
      variants,
    };
  }

  // Modelo User Product: agrupa por user_product_id dentro da mesma family_id
  const familyId = first.family_id ?? first.id;
  const familyName = first.family_name ?? first.title;
  const byUserProduct = new Map<string, MlItemPayload[]>();

  for (const item of items) {
    const upId = item.user_product_id;
    if (!upId) {
      throw new Error(`Item ${item.id} em família User Product sem user_product_id`);
    }
    const group = byUserProduct.get(upId) ?? [];
    group.push(item);
    byUserProduct.set(upId, group);
  }

  const variants: MappedMlVariantLink[] = [];
  for (const [upId, groupItems] of byUserProduct.entries()) {
    const primaryItem = groupItems[0]!;
    const { sku, field } = extractMlSku(primaryItem);
    const gtinAttr = primaryItem.attributes.find((a) => a.id === 'GTIN');
    const isSingleCondition = groupItems.length === 1;

    const conditions: MappedMlSellingCondition[] = groupItems.map((condItem, idx) => {
      const followStore = isSingleCondition ? true : idx === 0;
      return {
        item_id: condItem.id,
        listing_status: condItem.status,
        price: condItem.price,
        follow_store_price: followStore,
        follow_set_by: null,
        logistic_type: condItem.shipping?.logistic_type ?? null,
        inventory_id: condItem.inventory_id ?? null,
        control_change_entry: {
          target: 'selling_condition',
          target_key: condItem.id,
          field: 'follow_store_price',
          old_value: null,
          new_value: followStore ? 'true' : 'false',
          origin: 'system',
          changed_by: null,
        },
      };
    });

    variants.push({
      platform_product_id: familyId,
      platform_variant_id: upId,
      user_product_id: upId,
      platform_sku_raw: sku,
      platform_sku_field: field,
      platform_ean: cleanDigitsOnly(gtinAttr?.value_name),
      platform_price: primaryItem.price,
      platform_stock: primaryItem.available_quantity,
      selling_conditions: conditions,
    });
  }

  return {
    ml_model: 'user_product',
    platform_product_id: familyId,
    family_id: familyId,
    family_name: familyName,
    variants,
  };
}

export interface MappedMlStockLocationsResult {
  user_product_id: string;
  stock_version: number;
  locations: Array<{
    location_type: 'meli_facility' | 'seller_warehouse' | 'selling_address';
    store_id: string;
    network_node_id: string;
    quantity: number;
  }>;
  canWriteSellerWarehouse: boolean;
  skipStockStepReason: 'ml_full' | null;
}

/**
 * Mapeia a leitura de GET /user-products/{id}/stock (Seção 10.8):
 * - Só meli_facility -> passo stock fica skipped (motivo ml_full).
 * - seller_warehouse + meli_facility -> escreve apenas em seller_warehouse com x-version.
 * - selling_address nunca é escrito na conta MLB.
 */
export function mapMercadoLivreStockLocations(
  res: MlUserProductStockResponse
): MappedMlStockLocationsResult {
  const version = Number(res.headers['x-version']);
  const locations = res.body.locations.map((loc) => ({
    location_type: loc.type,
    store_id: loc.store_id ?? '',
    network_node_id: loc.network_node_id ?? '',
    quantity: loc.quantity,
  }));

  const hasSellerWarehouse = locations.some((l) => l.location_type === 'seller_warehouse');
  const hasMeliFacility = locations.some((l) => l.location_type === 'meli_facility');
  const onlyMeliFacility = hasMeliFacility && !hasSellerWarehouse;

  return {
    user_product_id: res.body.id,
    stock_version: version,
    locations,
    canWriteSellerWarehouse: hasSellerWarehouse,
    skipStockStepReason: onlyMeliFacility ? 'ml_full' : null,
  };
}

export function applyMlUptinMigration(
  existingLink: {
    master_product_id: string;
    variant_id: string;
    match_confidence: number;
  },
  notification: MlUptinMigrationNotification
) {
  return {
    master_product_id: existingLink.master_product_id,
    variant_id: existingLink.variant_id,
    ml_model: 'user_product' as const,
    platform_product_id: notification.migration.family_id,
    family_id: notification.migration.family_id,
    family_name: notification.migration.family_name,
    // Regra da Seção 8.2: family_confidence copia o match_confidence já gravado no vínculo legado
    family_confidence: existingLink.match_confidence,
    match_confidence: existingLink.match_confidence,
    platform_variant_id: notification.migration.new_user_product_id,
    user_product_id: notification.migration.new_user_product_id,
    item_id: notification.migration.new_item_id,
  };
}

export interface MappedNuvemshopProduct {
  platform_product_id: string;
  title: string;
  description: string;
  seo_slug: string | null;
  brand: string | null;
  variants: Array<{
    platform_variant_id: string;
    sku: string | null;
    ean: string | null;
    price: number;
    promotional_price: number | null;
    stock: number;
    inventory_levels: Array<{ location_id: string; stock: number }>;
    measuresPayload: {
      id: number;
      weight?: string;
      width?: string;
      height?: string;
      depth?: string;
    };
  }>;
}

/**
 * Mapeia produto da Nuvemshop (Seção 8.8 e 11):
 * - Considera inventory_levels por location_id.
 * - O builder do passo measures envia APENAS id, weight, width, height e depth (sem price e sem stock).
 */
export function mapNuvemshopProduct(payload: NuvemshopProductPayload): MappedNuvemshopProduct {
  return {
    platform_product_id: String(payload.id),
    title: payload.name.pt ?? payload.name.es ?? payload.name.en ?? '',
    description: payload.description.pt ?? payload.description.es ?? payload.description.en ?? '',
    seo_slug: payload.handle.pt ?? null,
    brand: payload.brand,
    variants: payload.variants.map((v) => {
      const totalFromLevels =
        v.inventory_levels.length > 0
          ? v.inventory_levels.reduce((acc, lvl) => acc + lvl.stock, 0)
          : (v.stock ?? 0);

      const measuresPayload: {
        id: number;
        weight?: string;
        width?: string;
        height?: string;
        depth?: string;
      } = { id: v.id };
      if (v.weight !== null) measuresPayload.weight = v.weight;
      if (v.width !== null) measuresPayload.width = v.width;
      if (v.height !== null) measuresPayload.height = v.height;
      if (v.depth !== null) measuresPayload.depth = v.depth;

      return {
        platform_variant_id: String(v.id),
        sku: v.sku,
        ean: cleanDigitsOnly(v.barcode),
        price: Number(v.price),
        promotional_price: v.promotional_price ? Number(v.promotional_price) : null,
        stock: totalFromLevels,
        inventory_levels: v.inventory_levels.map((l) => ({
          location_id: l.location_id,
          stock: l.stock,
        })),
        measuresPayload,
      };
    }),
  };
}
