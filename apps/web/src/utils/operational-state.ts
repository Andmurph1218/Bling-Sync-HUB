import { apiFetch } from './api-client';

export interface OperationalKpiMetric {
  value: number;
  definition: string;
  source: string;
  period: string;
  targetHref: string;
}

export interface CatalogProductSummary {
  id: string;
  bling_id: string;
  bling_sku: string;
  name: string | null;
  brand: string | null;
  ncm: string | null;
  ncm_status: string;
  ncm_fiscal_risk: boolean;
  catalog_status: string;
  last_bling_sync: string | null;
  variant_id: string | null;
  price: string | null;
  cost_price: string | null;
  stock: string | null;
  ean: string | null;
  ean_status: string | null;
  score_bling: number | null;
  score_ml: number | null;
  score_ns: number | null;
  publishable_ml: boolean | null;
  publishable_ns: boolean | null;
  blockers: string[] | null;
}

export interface OperationalStatePayload {
  calculatedAt: string;
  kpis: {
    monitoredProducts: OperationalKpiMetric & { variantsCount: number };
    readyToPublish: OperationalKpiMetric & { totalEvaluated: number };
    actionPendings: OperationalKpiMetric & {
      breakdown: {
        matchingSuggestions: number;
        matchingQuarantine: number;
        eanPending: number;
        eanDuplicates: number;
        ncmPendingFirst: number;
        ncmPendingSecond: number;
        fiscalBlocks: number;
      };
    };
    syncFailures: OperationalKpiMetric & { belowCostAlerts: number };
  };
  channels: {
    oauth: Array<{ provider: string; expires_at: string; updated_at: string }>;
    syncOwners: Array<{ platform: string; stock_price: string; content: string }>;
    enrichmentControls: Array<{
      platform: string;
      mode: string;
      kill_switch: boolean;
      max_replaces_per_run: number;
    }>;
    warehouses: Array<{
      bling_warehouse_id: string;
      name: string;
      role: string;
      include_in_push: boolean;
    }>;
  };
  recentWebhooks: Array<{
    id: string;
    source: string;
    event_type: string;
    resource_id: string;
    status: string;
    ignore_reason: string | null;
    processed_at: string | null;
  }>;
  catalogProducts: CatalogProductSummary[];
  emptySkuCount: number;
  contentIncompleteCount: number;
}

/**
 * Traduz bloqueios técnicos do CRE/GVE/NVE para linguagem operacional sem siglas obrigatórias.
 */
export function translateBlockerToPlainPortuguese(code: string): {
  title: string;
  nextStep: string;
  engineCode: string;
} {
  switch (code) {
    case 'ean_invalid_or_risk':
      return {
        title: 'Código de barras (EAN/GTIN) ausente ou inválido no Bling',
        nextStep: 'Revisar sugestão de EAN externo ou preencher código GS1 válido de 13 dígitos',
        engineCode: 'GVE · ean_invalid_or_risk',
      };
    case 'ncm_invalid_or_conflict':
      return {
        title: 'NCM ausente, inválido ou divergente entre variações',
        nextStep: 'Iniciar aprovação fiscal por duas pessoas com consulta à tabela TIPI',
        engineCode: 'NVE · ncm_invalid_or_conflict',
      };
    case 'ml_category_not_verified':
      return {
        title: 'Categoria do Mercado Livre ainda não mapeada para este produto',
        nextStep: 'Vincular anúncio existente ou confirmar categoria oficial antes de criar anúncio',
        engineCode: 'CRE · ml_category_not_verified',
      };
    case 'score_ml_below_50':
      return {
        title: 'Conteúdo abaixo do mínimo para publicar no Mercado Livre (< 50 pts)',
        nextStep: 'Expandir descrição técnica (>= 180 caracteres) e adicionar fotos >= 500x500',
        engineCode: 'CRE · score_ml_below_50',
      };
    case 'score_ns_below_45':
      return {
        title: 'Conteúdo e SEO abaixo do mínimo para publicar na Nuvemshop (< 45 pts)',
        nextStep: 'Preencher título, descrição rica, tags de busca e meta description',
        engineCode: 'CRE · score_ns_below_45',
      };
    default:
      return {
        title: `Requisito pendente (${code})`,
        nextStep: 'Abrir ficha do produto para revisar campo obrigatório',
        engineCode: code,
      };
  }
}

export async function fetchOperationalState(): Promise<OperationalStatePayload> {
  return apiFetch<OperationalStatePayload>('/api/dashboard/operational-state');
}
