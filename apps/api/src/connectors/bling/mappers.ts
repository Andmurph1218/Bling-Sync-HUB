import { BlingProductPayload } from './fixtures.js';
import {
  buildComboKey,
  cleanDigitsOnly,
  MapErpProductResult,
  MappedComponent,
  MappedProductVariant,
  MappedVariantAttribute,
} from '../../contracts/mappers.js';

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
export function mapBlingProductToCatalog(payload: BlingProductPayload): MapErpProductResult {
  if (payload.tipo !== 'P') {
    return {
      kind: 'ignored_service',
      reason: 'service',
      erp_id: String(payload.id),
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
      erp_sku: payload.codigo,
      is_default: true,
      product_format: payload.formato,
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
        erp_id: String(payload.id),
        erp_sku: payload.codigo,
        bling_tipo: 'P',
        product_format: payload.formato,
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
      erp_sku: v.codigo,
      is_default: false,
      product_format: v.formato,
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
      erp_id: String(payload.id),
      erp_sku: payload.codigo,
      bling_tipo: 'P',
      product_format: 'V',
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
