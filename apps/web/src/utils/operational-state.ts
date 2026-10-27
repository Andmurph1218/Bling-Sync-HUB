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
}

export const FALLBACK_OPERATIONAL_STATE: OperationalStatePayload = {
  calculatedAt: new Date().toISOString(),
  kpis: {
    monitoredProducts: {
      value: 25,
      variantsCount: 25,
      definition: 'Total de produtos ativos importados do Bling ERP v3.',
      source: 'master_products (catalog_status = active)',
      period: 'Tempo real (estado atual)',
      targetHref: '/catalogo',
    },
    readyToPublish: {
      value: 1,
      totalEvaluated: 15,
      definition:
        'Variantes que atendem aos requisitos fiscais e de conteúdo em pelo menos um canal.',
      source: 'channel_readiness_scores (publishable_ml OR publishable_ns)',
      period: 'Último cálculo de prontidão',
      targetHref: '/catalogo?filter=ready',
    },
    actionPendings: {
      value: 302,
      breakdown: {
        matchingSuggestions: 296,
        matchingQuarantine: 0,
        eanPending: 0,
        eanDuplicates: 0,
        ncmPendingFirst: 0,
        ncmPendingSecond: 0,
        fiscalBlocks: 6,
      },
      definition:
        'Soma de itens aguardando decisão de operador ou revisor fiscal (correspondências, EAN, NCM e bloqueios).',
      source:
        'matching_queue + ean_pending_validation + ncm_manual_suggestions + product_variants',
      period: 'Fila ativa aberta',
      targetHref: '/pendencias',
    },
    syncFailures: {
      value: 0,
      belowCostAlerts: 0,
      definition:
        'Operações de publicação que falharam e exigem verificação antes de reprocessar.',
      source: 'push_jobs (status = failed)',
      period: 'Últimos 7 dias (retenção operacional)',
      targetHref: '/publicacoes',
    },
  },
  channels: {
    oauth: [
      {
        provider: 'bling',
        expires_at: '2026-10-28T04:00:00.000Z',
        updated_at: '2026-10-27T21:00:00.000Z',
      },
      {
        provider: 'mercadolivre',
        expires_at: '2026-10-28T02:00:00.000Z',
        updated_at: '2026-10-27T20:00:00.000Z',
      },
      {
        provider: 'nuvemshop',
        expires_at: '2126-09-26T20:00:00.000Z',
        updated_at: '2026-10-20T20:00:00.000Z',
      },
    ],
    syncOwners: [
      { platform: 'mercadolivre', stock_price: 'bling_native', content: 'hub' },
      { platform: 'nuvemshop', stock_price: 'bling_native', content: 'hub' },
    ],
    enrichmentControls: [
      {
        platform: 'mercadolivre',
        mode: 'shadow',
        kill_switch: false,
        max_replaces_per_run: 25,
      },
      {
        platform: 'nuvemshop',
        mode: 'shadow',
        kill_switch: false,
        max_replaces_per_run: 25,
      },
    ],
    warehouses: [
      {
        bling_warehouse_id: '14886768228',
        name: 'Geral',
        role: 'seller',
        include_in_push: true,
      },
    ],
  },
  recentWebhooks: [
    {
      id: 'wh-1',
      source: 'nuvemshop',
      event_type: 'product/updated',
      resource_id: '314532102',
      status: 'processed',
      ignore_reason: null,
      processed_at: '2026-10-22T18:56:35.018Z',
    },
    {
      id: 'wh-2',
      source: 'bling',
      event_type: 'stock.updated',
      resource_id: '999999999',
      status: 'processed',
      ignore_reason: null,
      processed_at: '2026-10-22T18:45:13.175Z',
    },
  ],
  catalogProducts: [],
};

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

export async function fetchOperationalState(): Promise<{
  data: OperationalStatePayload;
  liveFromDatabase: boolean;
}> {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}/api/dashboard/operational-state`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as OperationalStatePayload;
    return { data: json, liveFromDatabase: true };
  } catch {
    return { data: FALLBACK_OPERATIONAL_STATE, liveFromDatabase: false };
  }
}
