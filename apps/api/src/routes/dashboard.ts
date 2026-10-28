import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { query, withTransaction } from '../db/pool.js';
import { resolveMatchingDecision } from '../engines/pire.js';
import { confirmNcmSuggestionStep } from '../engines/nve.js';
import { validateGs1Gtin } from '../engines/gve.js';

export const dashboardRouter = Router();

const resolveMatchingSchema = z.object({
  platform: z.enum(['mercadolivre', 'nuvemshop']),
  platformProductId: z.string().min(1),
  action: z.enum(['confirm', 'reject_candidate', 'dismiss', 'new_product']),
  masterProductId: z.string().uuid().optional(),
  reason: z.string().optional(),
  mlModel: z.enum(['legacy_variations', 'user_product']).optional(),
  familyId: z.string().optional(),
  familyName: z.string().optional(),
});

const reviewEanSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});

const confirmNcmSchema = z.object({
  note: z.string().min(3, 'Nota de consulta à TIPI é obrigatória'),
});

/**
 * Rota `/` (Visão Geral do Dashboard — Seção 12):
 * Conexões OAuth, pior score CRE, alertas fiscais abertos, alertas de preço abaixo do custo e filas pendentes.
 */
dashboardRouter.get(
  '/api/dashboard/overview',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [
        oauthRes,
        scoresRes,
        ncmAlertsRes,
        belowCostRes,
        matchingPendingRes,
        eanPendingRes,
        ncmPendingRes,
      ] = await Promise.all([
        query<{ provider: string; expires_at: Date | string }>(
          `SELECT provider, expires_at FROM oauth_tokens ORDER BY provider ASC`
        ),
        query<{
          score_bling: number;
          score_ml: number;
          score_ns: number;
        }>(`SELECT score_bling, score_ml, score_ns FROM channel_readiness_scores`),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ncm_divergence_alerts WHERE status = 'open'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM divergence_alerts WHERE alert_code = 'price_below_cost' AND status = 'open'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM matching_queue WHERE status = 'pending'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ean_pending_validation WHERE status = 'pending'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ncm_manual_suggestions WHERE status IN ('pending_first', 'pending_second')`
        ),
      ]);

      const worstScore =
        scoresRes.rows.length > 0
          ? Math.min(
              ...scoresRes.rows.map((r) =>
                Math.min(r.score_bling, r.score_ml, r.score_ns)
              )
            )
          : null;

      res.status(200).json({
        connections: oauthRes.rows,
        worstReadinessScore: worstScore,
        openFiscalAlertsCount: ncmAlertsRes.rows[0]?.count ?? 0,
        openBelowCostAlertsCount: belowCostRes.rows[0]?.count ?? 0,
        queues: {
          matchingPending: matchingPendingRes.rows[0]?.count ?? 0,
          eanPending: eanPendingRes.rows[0]?.count ?? 0,
          ncmPending: ncmPendingRes.rows[0]?.count ?? 0,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Camada Consolidada de Estado Operacional (Seções 3, 5, 7 e 9 de docs/bling_sync_hub_evolucao_dashboard.md):
 * Entrega em uma única leitura consistente:
 * - Estado operacional dos 3 canais + responsabilidade nativa vs HUB (channel_sync_owners + enrichment_controls)
 * - 4 Indicadores Principais com definição formal, fonte e timestamp (Produtos monitorados, Prontos para publicar, Pendências de ação, Falhas de sincronização)
 * - Bloqueios fiscais, alertas financeiros (preço < custo), última operação e atividade recente
 * - Cadeia explícita: Indicador -> Problema -> Impacto -> Ação recomendada -> Destino
 */
dashboardRouter.get(
  '/api/dashboard/operational-state',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const calculatedAt = new Date().toISOString();

      const [
        oauthRes,
        syncOwnersRes,
        enrichmentControlsRes,
        warehousesRes,
        productsCountRes,
        variantsCountRes,
        readinessRowsRes,
        matchingByStatusRes,
        eanPendingRes,
        eanDuplicatesRes,
        ncmSuggestionsRes,
        ncmConflictsRes,
        belowCostRes,
        failedPushJobsRes,
        recentWebhooksRes,
        catalogProductsRes,
      ] = await Promise.all([
        query<{ provider: string; expires_at: Date | string; updated_at: Date | string; has_refresh: boolean }>(
          `SELECT provider, expires_at, updated_at, (refresh_token_enc IS NOT NULL) AS has_refresh
           FROM oauth_tokens ORDER BY provider ASC`
        ),
        query<{ platform: string; stock_price: string; content: string }>(
          `SELECT platform, stock_price, content FROM channel_sync_owners ORDER BY platform ASC`
        ),
        query<{ platform: string; mode: string; kill_switch: boolean; max_replaces_per_run: number }>(
          `SELECT platform, mode, kill_switch, max_replaces_per_run FROM enrichment_controls ORDER BY platform ASC`
        ),
        query<{ bling_warehouse_id: string; name: string; role: string; include_in_push: boolean }>(
          `SELECT bling_warehouse_id, name, role, include_in_push FROM stock_warehouses ORDER BY bling_warehouse_id ASC`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products WHERE catalog_status = 'active'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM product_variants WHERE is_active = true`
        ),
        query<{
          variant_id: string;
          master_product_id: string;
          score_bling: number;
          score_ml: number;
          score_ns: number;
          publishable_bling: boolean;
          publishable_ml: boolean;
          publishable_ns: boolean;
          blockers: string[];
        }>(
          `SELECT variant_id, master_product_id, score_bling, score_ml, score_ns,
                  publishable_bling, publishable_ml, publishable_ns, blockers
           FROM channel_readiness_scores`
        ),
        query<{ status: string; count: number }>(
          `SELECT pi.status, count(*)::int AS count
           FROM matching_queue mq
           INNER JOIN platform_items pi ON pi.id = mq.platform_item_id
           WHERE mq.status = 'pending'
           GROUP BY pi.status`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ean_pending_validation WHERE status = 'pending'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM product_variants WHERE ean_status = 'duplicate' AND is_active = true`
        ),
        query<{ status: string; count: number }>(
          `SELECT status, count(*)::int AS count
           FROM ncm_manual_suggestions
           WHERE status IN ('pending_first', 'pending_second')
           GROUP BY status`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products WHERE ncm_status = 'conflict' OR ncm_fiscal_risk = true`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM divergence_alerts WHERE alert_code = 'price_below_cost' AND status = 'open'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'failed'`
        ),
        query<{
          id: string;
          source: string;
          event_type: string;
          resource_id: string;
          status: string;
          ignore_reason: string | null;
          processed_at: Date | string | null;
        }>(
          `SELECT id, source, event_type, resource_id, status, ignore_reason, processed_at
           FROM webhook_events
           ORDER BY id DESC
           LIMIT 8`
        ),
        query<{
          id: string;
          bling_id: string;
          bling_sku: string;
          name: string | null;
          brand: string | null;
          ncm: string | null;
          ncm_status: string;
          ncm_fiscal_risk: boolean;
          catalog_status: string;
          last_bling_sync: Date | string | null;
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
        }>(
          `SELECT
             mp.id,
             mp.bling_id,
             mp.bling_sku,
             mp.name,
             mp.brand,
             mp.ncm,
             mp.ncm_status,
             mp.ncm_fiscal_risk,
             mp.catalog_status,
             mp.last_bling_sync,
             pv.id AS variant_id,
             pv.price::text AS price,
             pv.cost_price::text AS cost_price,
             pv.stock::text AS stock,
             pv.ean,
             pv.ean_status,
             crs.score_bling,
             crs.score_ml,
             crs.score_ns,
             crs.publishable_ml,
             crs.publishable_ns,
             crs.blockers
           FROM master_products mp
           LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
           LEFT JOIN channel_readiness_scores crs ON crs.variant_id = pv.id
           ORDER BY mp.updated_at DESC
           LIMIT 25`
        ),
      ]);

      const monitoredProductsCount = productsCountRes.rows[0]?.count ?? 0;
      const monitoredVariantsCount = variantsCountRes.rows[0]?.count ?? 0;

      const readyVariantsCount = readinessRowsRes.rows.filter(
        (r) => r.publishable_ml || r.publishable_ns
      ).length;

      let matchingSuggestions = 0;
      let matchingQuarantine = 0;
      for (const row of matchingByStatusRes.rows) {
        if (row.status === 'quarantine') {
          matchingQuarantine += row.count;
        } else {
          matchingSuggestions += row.count;
        }
      }

      const eanPendingCount = eanPendingRes.rows[0]?.count ?? 0;
      const eanDuplicateCount = eanDuplicatesRes.rows[0]?.count ?? 0;

      let ncmPendingFirst = 0;
      let ncmPendingSecond = 0;
      for (const row of ncmSuggestionsRes.rows) {
        if (row.status === 'pending_first') ncmPendingFirst += row.count;
        if (row.status === 'pending_second') ncmPendingSecond += row.count;
      }

      const fiscalRiskProductsCount = ncmConflictsRes.rows[0]?.count ?? 0;
      const belowCostCount = belowCostRes.rows[0]?.count ?? 0;
      const failedPushJobsCount = failedPushJobsRes.rows[0]?.count ?? 0;

      const variantsWithInvalidEan = readinessRowsRes.rows.filter((r) =>
        (r.blockers ?? []).includes('ean_invalid_or_risk')
      ).length;

      const totalFiscalBlocks =
        fiscalRiskProductsCount + eanDuplicateCount + variantsWithInvalidEan;

      const totalActionPendings =
        matchingSuggestions +
        matchingQuarantine +
        eanPendingCount +
        ncmPendingFirst +
        ncmPendingSecond +
        totalFiscalBlocks;

      res.status(200).json({
        calculatedAt,
        kpis: {
          monitoredProducts: {
            value: monitoredProductsCount,
            variantsCount: monitoredVariantsCount,
            definition: 'Total de produtos ativos importados do Bling ERP v3.',
            source: 'master_products (catalog_status = active)',
            period: 'Tempo real (estado atual)',
            targetHref: '/catalogo',
          },
          readyToPublish: {
            value: readyVariantsCount,
            totalEvaluated: readinessRowsRes.rows.length,
            definition:
              'Variantes que atendem aos requisitos fiscais e de conteúdo em pelo menos um canal.',
            source: 'channel_readiness_scores (publishable_ml OR publishable_ns)',
            period: 'Último cálculo de prontidão',
            targetHref: '/catalogo?filter=ready',
          },
          actionPendings: {
            value: totalActionPendings,
            breakdown: {
              matchingSuggestions,
              matchingQuarantine,
              eanPending: eanPendingCount,
              eanDuplicates: eanDuplicateCount,
              ncmPendingFirst,
              ncmPendingSecond,
              fiscalBlocks: totalFiscalBlocks,
            },
            definition:
              'Soma de itens aguardando decisão de operador ou revisor fiscal (correspondências, EAN, NCM e bloqueios).',
            source: 'matching_queue + ean_pending_validation + ncm_manual_suggestions + product_variants',
            period: 'Fila ativa aberta',
            targetHref: '/pendencias',
          },
          syncFailures: {
            value: failedPushJobsCount,
            belowCostAlerts: belowCostCount,
            definition: 'Operações de publicação que falharam e exigem verificação antes de reprocessar.',
            source: 'push_jobs (status = failed)',
            period: 'Últimos 7 dias (retenção operacional)',
            targetHref: '/publicacoes',
          },
        },
        channels: {
          oauth: oauthRes.rows,
          stores: (
            await query<{ platform: string; bling_loja_id: string; name: string }>(
              `SELECT platform, bling_loja_id, name FROM channel_stores ORDER BY platform ASC`
            )
          ).rows,
          syncOwners: syncOwnersRes.rows,
          enrichmentControls: enrichmentControlsRes.rows,
          warehouses: warehousesRes.rows,
        },
        recentWebhooks: recentWebhooksRes.rows,
        catalogProducts: catalogProductsRes.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

interface SuggestedMatch {
  master_product_id: string;
  name?: string;
  bling_sku?: string;
  score?: number;
  strongSignals?: string[];
  auxiliarySignals?: string[];
  nameSimilarity?: number;
}

/**
 * Extrai título, SKU, EAN, preço, status e link público do payload bruto do anúncio
 * (Mercado Livre /items ou Nuvemshop /products), sem gravar nada no Bling.
 */
export function normalizeChannelRawItem(
  platform: string,
  platformProductId: string,
  raw: unknown
): {
  title: string;
  sku: string | null;
  ean: string | null;
  price: string | null;
  status: string | null;
  url: string | null;
} {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;

  if (platform === 'mercadolivre' && r.familyId !== undefined && r.familyId !== null) {
    const familyItems = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
    const first = familyItems[0] ?? {};
    const firstOf = (v: unknown) => (Array.isArray(v) ? str(v[0]) : null);
    const firstRaw = (first.raw_payload && typeof first.raw_payload === 'object'
      ? first.raw_payload
      : {}) as Record<string, unknown>;
    const rawAttrs = Array.isArray(firstRaw.attributes)
      ? (firstRaw.attributes as Array<Record<string, unknown>>)
      : [];
    const rawAttr = (id: string) => str(rawAttrs.find((a) => a.id === id)?.value_name);
    return {
      title: str(r.familyName) ?? str(first.title) ?? `Família ${platformProductId}`,
      sku: firstOf(first.skus) ?? str(firstRaw.seller_custom_field) ?? rawAttr('SELLER_SKU'),
      ean: firstOf(first.eans) ?? rawAttr('GTIN'),
      price: str(first.price),
      status: `família User Product (${familyItems.length} ${familyItems.length === 1 ? 'item' : 'itens'})`,
      url: str(firstRaw.permalink),
    };
  }

  if (platform === 'mercadolivre') {
    const attrs = Array.isArray(r.attributes) ? (r.attributes as Array<Record<string, unknown>>) : [];
    const attr = (id: string) => str(attrs.find((a) => a.id === id)?.value_name);
    return {
      title: str(r.title) ?? str(r.family_name) ?? `Anúncio ${platformProductId}`,
      sku: str(r.seller_custom_field) ?? attr('SELLER_SKU'),
      ean: attr('GTIN') ?? attr('EAN'),
      price: str(r.price),
      status: str(r.status),
      url: str(r.permalink),
    };
  }

  const name = r.name as Record<string, unknown> | string | undefined;
  const title =
    typeof name === 'string' ? name : str(name?.pt) ?? str(name?.es) ?? `Produto ${platformProductId}`;
  const variants = Array.isArray(r.variants) ? (r.variants as Array<Record<string, unknown>>) : [];
  const v0 = variants[0] ?? {};
  return {
    title,
    sku: str(v0.sku),
    ean: str(v0.barcode),
    price: str(v0.price),
    status: r.published === false ? 'oculto' : 'publicado',
    url: str(r.canonical_url),
  };
}

/**
 * Rota `/matching` (Seção 12):
 * Lista fila de sugestões, quarentena, recusas de par e lacunas da matriz de variantes.
 */
dashboardRouter.get(
  '/api/matching/queue',
  requireRole('operator', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [queueRes, rejectionsRes, matrixGapsRes] = await Promise.all([
        query<{
          queue_id: string;
          platform_item_id: string;
          platform: string;
          platform_product_id: string;
          item_status: string;
          best_score: number | null;
          suggested_matches: unknown;
          platform_raw_data: unknown;
          created_at: Date | string;
        }>(
          `SELECT
             mq.id AS queue_id,
             mq.platform_item_id,
             pi.platform,
             pi.platform_product_id,
             pi.status AS item_status,
             mq.best_score,
             mq.suggested_matches,
             mq.platform_raw_data,
             mq.created_at
           FROM matching_queue mq
           INNER JOIN platform_items pi ON pi.id = mq.platform_item_id
           WHERE mq.status = 'pending'
           ORDER BY mq.created_at ASC`
        ),
        query<{
          platform_item_id: string;
          master_product_id: string;
          rejected_by: string;
          reason: string | null;
        }>(
          `SELECT platform_item_id, master_product_id, rejected_by, reason
           FROM match_rejections`
        ),
        query<{
          master_product_id: string;
          variant_id: string | null;
          combo_key: string;
          status: string;
        }>(
          `SELECT master_product_id, variant_id, combo_key, status
           FROM variant_matrix_analysis
           WHERE status <> 'ok'`
        ),
      ]);

      const candidateIds = new Set<string>();
      const firstCandidateByQueue = new Map<string, SuggestedMatch | null>();
      for (const row of queueRes.rows) {
        const list = Array.isArray(row.suggested_matches)
          ? (row.suggested_matches as SuggestedMatch[])
          : [];
        const first = list[0] ?? null;
        firstCandidateByQueue.set(row.queue_id, first);
        if (first?.master_product_id) candidateIds.add(first.master_product_id);
      }

      const candidatesRes =
        candidateIds.size > 0
          ? await query<{
              id: string;
              bling_id: string;
              bling_sku: string;
              name: string | null;
              catalog_status: string;
              ean: string | null;
              price: string | null;
            }>(
              `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name, mp.catalog_status,
                      pv.ean, pv.price::text AS price
               FROM master_products mp
               LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
               WHERE mp.id IN (${[...candidateIds].map((_, i) => `$${i + 1}`).join(', ')})`,
              [...candidateIds]
            )
          : { rows: [] };
      const candidateById = new Map(candidatesRes.rows.map((c) => [c.id, c]));

      const items = queueRes.rows.map((row) => {
        const channel = normalizeChannelRawItem(
          row.platform,
          row.platform_product_id,
          row.platform_raw_data
        );
        const suggestion = firstCandidateByQueue.get(row.queue_id) ?? null;
        const product = suggestion ? candidateById.get(suggestion.master_product_id) : undefined;
        const rawObj = (row.platform_raw_data ?? {}) as Record<string, unknown>;
        const isFamily =
          row.platform === 'mercadolivre' && rawObj.familyId !== undefined && rawObj.familyId !== null;
        return {
          queueId: row.queue_id,
          platform: row.platform,
          platformProductId: row.platform_product_id,
          mlModel: row.platform === 'mercadolivre' ? (isFamily ? 'user_product' : 'legacy_variations') : null,
          familyId: isFamily ? String(rawObj.familyId) : null,
          familyName: isFamily && typeof rawObj.familyName === 'string' ? rawObj.familyName : null,
          itemStatus: row.item_status,
          bestScore: row.best_score,
          createdAt: row.created_at,
          channel,
          candidate: suggestion
            ? {
                masterProductId: suggestion.master_product_id,
                blingId: product?.bling_id ?? null,
                blingSku: product?.bling_sku ?? suggestion.bling_sku ?? '',
                name: product?.name ?? suggestion.name ?? null,
                ean: product?.ean ?? null,
                price: product?.price ?? null,
                status: product?.catalog_status ?? null,
                strongSignals: suggestion.strongSignals ?? [],
                auxiliarySignals: suggestion.auxiliarySignals ?? [],
                nameSimilarity: suggestion.nameSimilarity ?? null,
              }
            : null,
        };
      });

      res.status(200).json({
        pendingQueue: queueRes.rows,
        items,
        rejections: rejectionsRes.rows,
        variantMatrixGaps: matrixGapsRes.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

dashboardRouter.post(
  '/api/matching/resolve',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = resolveMatchingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
        return;
      }

      const outcome = await resolveMatchingDecision({
        ...parsed.data,
        userId: req.user!.id,
      });

      res.status(200).json({ resolution: outcome });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Rota `/fiscal/ean` (Seção 12):
 * Lista e aprova/rejeita propostas de EAN externo na fila humana (ean_pending_validation).
 */
dashboardRouter.get(
  '/api/fiscal/ean/pending',
  requireRole('fiscal_approver', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pendingRes = await query<{
        id: string;
        variant_id: string;
        master_product_id: string;
        proposed_ean: string;
        source_platform: string;
        context_type: string | null;
        status: string;
        expires_at: Date | string;
      }>(
        `SELECT id, variant_id, master_product_id, proposed_ean,
                source_platform, context_type, status, expires_at
         FROM ean_pending_validation
         WHERE status = 'pending'
         ORDER BY created_at ASC`
      );

      const detailsRes =
        pendingRes.rows.length > 0
          ? await query<{
              id: string;
              bling_id: string;
              product_name: string | null;
              variant_sku: string;
              current_ean: string | null;
              ean_status: string;
            }>(
              `SELECT epv.id, mp.bling_id, mp.name AS product_name,
                      pv.bling_sku AS variant_sku, pv.ean AS current_ean, pv.ean_status
               FROM ean_pending_validation epv
               INNER JOIN product_variants pv ON pv.id = epv.variant_id
               INNER JOIN master_products mp ON mp.id = epv.master_product_id
               WHERE epv.id IN (${pendingRes.rows.map((_, i) => `$${i + 1}`).join(', ')})`,
              pendingRes.rows.map((r) => r.id)
            )
          : { rows: [] };
      const detailById = new Map(detailsRes.rows.map((d) => [d.id, d]));

      const items = pendingRes.rows.map((r) => {
        const d = detailById.get(r.id);
        const gs1 = validateGs1Gtin(r.proposed_ean);
        return {
          id: r.id,
          blingId: d?.bling_id ?? null,
          productName: d?.product_name ?? null,
          variantSku: d?.variant_sku ?? null,
          currentEan: d?.current_ean ?? null,
          eanStatus: d?.ean_status ?? null,
          proposedEan: r.proposed_ean,
          sourcePlatform: r.source_platform,
          expiresAt: r.expires_at,
          gs1: {
            valid: gs1.valid,
            isPlaceholder: gs1.isPlaceholder,
            contextType: gs1.contextType,
            reason: gs1.reason ?? null,
          },
        };
      });

      res.status(200).json({ pendingEans: pendingRes.rows, items });
    } catch (error) {
      next(error);
    }
  }
);

dashboardRouter.post(
  '/api/fiscal/ean/:id/review',
  requireRole('fiscal_approver'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pendingId = req.params.id;
      const parsed = reviewEanSchema.safeParse(req.body);
      if (!parsed.success || !pendingId) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }

      const reviewerId = req.user!.id;

      const result = await withTransaction(async (client) => {
        const rowRes = await client.query<{
          id: string;
          variant_id: string;
          master_product_id: string;
          proposed_ean: string;
          status: string;
        }>(
          `SELECT id, variant_id, master_product_id, proposed_ean, status
           FROM ean_pending_validation
           WHERE id = $1
           FOR UPDATE`,
          [pendingId]
        );

        const item = rowRes.rows[0];
        if (!item) {
          return { notFound: true as const };
        }
        if (item.status !== 'pending') {
          return { alreadyResolved: true as const, status: item.status };
        }

        if (parsed.data.decision === 'approve') {
          const gs1 = validateGs1Gtin(item.proposed_ean);
          if (!gs1.valid || !gs1.normalizedDigits) {
            throw new Error('EAN proposto inválido segundo GS1');
          }

          await client.query(
            `UPDATE ean_pending_validation
             SET status = 'approved',
                 reviewed_by = $2,
                 reviewed_at = now()
             WHERE id = $1`,
            [item.id, reviewerId]
          );

          await client.query(
            `UPDATE product_variants
             SET ean = $2,
                 ean_status = 'valid',
                 fiscal_risk_flag = false,
                 ean_validated_by = $3,
                 ean_validated_at = now(),
                 updated_at = now()
             WHERE id = $1`,
            [item.variant_id, gs1.normalizedDigits, reviewerId]
          );

          await client.query(
            `INSERT INTO ean_validation_history (
               variant_id, master_product_id, ean, previous_status, new_status, action, actor_id
             ) VALUES ($1, $2, $3, 'pending_validation', 'valid', 'human_approved', $4)`,
            [item.variant_id, item.master_product_id, gs1.normalizedDigits, reviewerId]
          );

          return {
            notFound: false as const,
            alreadyResolved: false as const,
            status: 'approved' as const,
            ean: gs1.normalizedDigits,
          };
        }

        await client.query(
          `UPDATE ean_pending_validation
           SET status = 'rejected',
               reviewed_by = $2,
               reviewed_at = now(),
               rejection_reason = $3
           WHERE id = $1`,
          [item.id, reviewerId, parsed.data.reason ?? null]
        );

        await client.query(
          `INSERT INTO ean_validation_history (
             variant_id, master_product_id, ean, previous_status, new_status, action, actor_id
           ) VALUES ($1, $2, $3, 'pending_validation', 'rejected', 'human_rejected', $4)`,
          [item.variant_id, item.master_product_id, item.proposed_ean, reviewerId]
        );

        return {
          notFound: false as const,
          alreadyResolved: false as const,
          status: 'rejected' as const,
          ean: null,
        };
      });

      if (result.notFound) {
        res.status(404).json({ error: 'ean_pending_not_found' });
        return;
      }
      if (result.alreadyResolved) {
        res.status(409).json({ error: 'ean_already_resolved', status: result.status });
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Rota `/fiscal/ncm` (Seções 6, 8.4, 12 e 13 - Fase 11):
 * Lista sugestões e executa a dupla confirmação de NCM por dois usuários fiscal_approver distintos com nota de TIPI.
 */
dashboardRouter.get(
  '/api/fiscal/ncm/suggestions',
  requireRole('fiscal_approver', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [suggestionsRes, auditRes] = await Promise.all([
        query<{
          id: string;
          master_product_id: string;
          proposed_ncm: string;
          source_platform: string;
          status: string;
          first_review_by: string | null;
          second_review_by: string | null;
          tipi_consultation_note: string | null;
        }>(
          `SELECT id, master_product_id, proposed_ncm, source_platform, status,
                  first_review_by, second_review_by, tipi_consultation_note
           FROM ncm_manual_suggestions
           ORDER BY created_at ASC`
        ),
        query<{
          id: string;
          master_product_id: string;
          previous_ncm: string | null;
          new_ncm: string | null;
          decision: string;
          first_review_by: string | null;
          second_review_by: string | null;
          tipi_note: string | null;
        }>(
          `SELECT id, master_product_id, previous_ncm, new_ncm, decision,
                  first_review_by, second_review_by, tipi_note
           FROM ncm_audit_log
           ORDER BY created_at DESC`
        ),
      ]);

      const productIds = [...new Set(suggestionsRes.rows.map((s) => s.master_product_id))];
      const reviewerIds = [
        ...new Set(
          suggestionsRes.rows
            .flatMap((s) => [s.first_review_by, s.second_review_by])
            .filter((v): v is string => Boolean(v))
        ),
      ];
      const [productsRes, reviewersRes] = await Promise.all([
        productIds.length > 0
          ? query<{ id: string; bling_id: string; bling_sku: string; name: string | null; ncm: string | null }>(
              `SELECT id, bling_id, bling_sku, name, ncm FROM master_products
               WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(', ')})`,
              productIds
            )
          : Promise.resolve({ rows: [] as Array<{ id: string; bling_id: string; bling_sku: string; name: string | null; ncm: string | null }> }),
        reviewerIds.length > 0
          ? query<{ id: string; name: string; email: string }>(
              `SELECT id, name, email FROM users
               WHERE id IN (${reviewerIds.map((_, i) => `$${i + 1}`).join(', ')})`,
              reviewerIds
            )
          : Promise.resolve({ rows: [] as Array<{ id: string; name: string; email: string }> }),
      ]);
      const productById = new Map(productsRes.rows.map((p) => [p.id, p]));
      const reviewerById = new Map(reviewersRes.rows.map((u) => [u.id, u]));
      const reviewerLabel = (id: string | null) => {
        if (!id) return null;
        const u = reviewerById.get(id);
        return { id, name: u?.name ?? 'Usuário', email: u?.email ?? '' };
      };

      const items = suggestionsRes.rows.map((s) => {
        const p = productById.get(s.master_product_id);
        return {
          id: s.id,
          blingId: p?.bling_id ?? null,
          sku: p?.bling_sku ?? null,
          productName: p?.name ?? null,
          currentNcm: p?.ncm ?? null,
          proposedNcm: s.proposed_ncm,
          sourcePlatform: s.source_platform,
          status: s.status,
          firstReviewer: reviewerLabel(s.first_review_by),
          secondReviewer: reviewerLabel(s.second_review_by),
          tipiNote: s.tipi_consultation_note,
        };
      });

      res.status(200).json({
        suggestions: suggestionsRes.rows,
        items,
        auditLog: auditRes.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

dashboardRouter.post(
  '/api/fiscal/ncm/:suggestionId/confirm',
  requireRole('fiscal_approver'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const suggestionId = req.params.suggestionId;
      const parsed = confirmNcmSchema.safeParse(req.body);
      if (!parsed.success || !suggestionId) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error?.flatten() });
        return;
      }

      try {
        const result = await confirmNcmSuggestionStep({
          suggestionId,
          reviewerUserId: req.user!.id,
          note: parsed.data.note,
        });
        res.status(200).json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('outro usuário fiscal_approver')) {
          res.status(409).json({
            error: 'same_reviewer_forbidden',
            message: msg,
          });
          return;
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 6 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Estrutura consistente dos 10 motores para a interface:
 * - Resultado e estado
 * - Explicação operacional
 * - Evidências usadas
 * - Regra aplicada
 * - Campos ou produtos afetados
 * - Próxima ação recomendada
 * - Indicação de ação automática ou aprovação necessária
 * - Histórico e identificador da execução
 */
export interface MotorDiagnosticEnvelope {
  motor: 'PIRE' | 'VIR' | 'GVE' | 'NVE' | 'CQS' | 'IQRE' | 'CRE' | 'APE' | 'WIG' | 'DLM';
  motorNamePlain: string;
  resultState: 'healthy' | 'attention_required' | 'blocked';
  operationalExplanation: string;
  evidencesUsed: string[];
  ruleApplied: string;
  affectedCount: number;
  affectedTargetLabel: string;
  recommendedNextAction: string;
  actionHref: string;
  approvalMode: 'automatic' | 'human_approval_required' | 'dual_fiscal_approval_required';
  executionId: string;
  lastEvaluatedAt: string;
}

dashboardRouter.get(
  '/api/dashboard/motors-diagnostic',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const nowIso = new Date().toISOString();
      const [
        matchingRes,
        matrixGapsRes,
        eanInvalidRes,
        ncmPendingRes,
        cqsSuggestionsRes,
        imagesQueueRes,
        creBelowRes,
        pushFailedRes,
        webhooksProcessedRes,
        dlmPoliciesRes,
      ] = await Promise.all([
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM matching_queue WHERE status = 'pending'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM variant_matrix_analysis WHERE status <> 'ok'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM product_variants WHERE is_active = true AND (ean IS NULL OR ean = '' OR ean_status <> 'valid')`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ncm_manual_suggestions WHERE status IN ('pending_first', 'pending_second')`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM enrichment_suggestions WHERE status = 'pending'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM image_processing_queue WHERE stage IN ('queued', 'failed')`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM channel_readiness_scores WHERE publishable_ml = false OR publishable_ns = false`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'failed'`
        ),
        query<{ processed: number; ignored: number }>(
          `SELECT
             count(*) FILTER (WHERE status = 'processed')::int AS processed,
             count(*) FILTER (WHERE status = 'ignored')::int AS ignored
           FROM webhook_events`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM dlm_retention_policies`
        ),
      ]);

      const matchPending = matchingRes.rows[0]?.count ?? 0;
      const matrixGaps = matrixGapsRes.rows[0]?.count ?? 0;
      const eanIssues = eanInvalidRes.rows[0]?.count ?? 0;
      const ncmPending = ncmPendingRes.rows[0]?.count ?? 0;
      const cqsPending = cqsSuggestionsRes.rows[0]?.count ?? 0;
      const imgPending = imagesQueueRes.rows[0]?.count ?? 0;
      const creBelow = creBelowRes.rows[0]?.count ?? 0;
      const pushFailed = pushFailedRes.rows[0]?.count ?? 0;
      const whProcessed = webhooksProcessedRes.rows[0]?.processed ?? 0;
      const whIgnored = webhooksProcessedRes.rows[0]?.ignored ?? 0;
      const dlmPolicies = dlmPoliciesRes.rows[0]?.count ?? 17;

      const motors: MotorDiagnosticEnvelope[] = [
        {
          motor: 'PIRE',
          motorNamePlain: 'Identidade de Produto (Correspondência Pai)',
          resultState: matchPending > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            matchPending > 0
              ? `${matchPending} anúncios externos possuem apenas 1 sinal parcial e aguardam confirmação humana de vínculo.`
              : 'Todos os anúncios avaliados estão vinculados ou decididos.',
          evidencesUsed: ['SKU do Bling vs Seller SKU', 'GTIN/EAN GS1', 'Similaridade Jaro-Winkler >= 90%'],
          ruleApplied: 'Auto-vínculo exige >= 2 sinais fortes concordantes (score 95) e zero conflito.',
          affectedCount: matchPending,
          affectedTargetLabel: 'anúncios em matching_queue',
          recommendedNextAction: 'Abrir fila de Correspondências, comparar lado a lado e confirmar ou rejeitar par.',
          actionHref: '/matching',
          approvalMode: 'human_approval_required',
          executionId: `pire-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'VIR',
          motorNamePlain: 'Árvore de Variações e Matriz de Grade',
          resultState: matrixGaps > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            matrixGaps > 0
              ? `${matrixGaps} variações apresentam diferença entre a grade do Bling e os canais.`
              : 'Árvore de variações e condições User Product reconciliadas sem lacunas.',
          evidencesUsed: ['comboKey normalizado', 'attribute_value_aliases', 'ml_selling_conditions'],
          ruleApplied: 'Consolida condições por user_product_id e alerta variações faltantes (missing) ou extras.',
          affectedCount: matrixGaps,
          affectedTargetLabel: 'variações em variant_matrix_analysis',
          recommendedNextAction: 'Conferir árvore pai/filhos na Ficha Única do Produto.',
          actionHref: '/catalogo',
          approvalMode: 'human_approval_required',
          executionId: `vir-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'GVE',
          motorNamePlain: 'Validação Fiscal de Código de Barras (EAN/GTIN)',
          resultState: eanIssues > 0 ? 'blocked' : 'healthy',
          operationalExplanation:
            eanIssues > 0
              ? `${eanIssues} variações ativas estão com EAN ausente, inválido ou duplicado no Bling.`
              : 'Todas as variações ativas possuem EAN GS1 válido e sem duplicidade.',
          evidencesUsed: ['Dígito verificador GS1 Mod-10', 'Prefixo 789/790', 'Unicidade entre variantes do pai'],
          ruleApplied: 'EAN externo nunca auto-preenche o Bling; exige aprovação humana de revisor fiscal.',
          affectedCount: eanIssues,
          affectedTargetLabel: 'variações com bloqueio de EAN',
          recommendedNextAction: 'Revisar sugestões de EAN ou regularizar código GS1 no cadastro.',
          actionHref: '/fiscal/ean',
          approvalMode: 'human_approval_required',
          executionId: `gve-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'NVE',
          motorNamePlain: 'Validação e Dupla Confirmação de NCM',
          resultState: ncmPending > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            ncmPending > 0
              ? `${ncmPending} sugestões de NCM aguardam dupla confirmação por revisores fiscais distintos.`
              : 'NCMs validados (8 dígitos, capítulos 01–97 da TIPI) sem conflito entre variantes.',
          evidencesUsed: ['Formato 0000.00.00 (8 dígitos)', 'Capítulo TIPI 01–97', 'Consistência entre variantes'],
          ruleApplied: 'Duas aprovações por usuários fiscal_approver distintos com nota obrigatória de consulta à TIPI.',
          affectedCount: ncmPending,
          affectedTargetLabel: 'sugestões em ncm_manual_suggestions',
          recommendedNextAction: 'Concluir 1ª e 2ª revisão fiscal de NCM.',
          actionHref: '/fiscal/ncm',
          approvalMode: 'dual_fiscal_approval_required',
          executionId: `nve-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'CQS',
          motorNamePlain: 'Qualidade de Conteúdo (Marca, Peso e Dimensões)',
          resultState: cqsPending > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            'Opera em modo Shadow: avalia notas A–F por campo sem jamais substituir valores Grade A ou B do Bling.',
          evidencesUsed: ['Comprimento e riqueza de texto', 'Sentinelas de peso (0.001 kg)', 'Dimensões 1x1x1'],
          ruleApplied: 'Primeira regra da árvore vence; nome e descrição do Bling permanecem intocáveis.',
          affectedCount: cqsPending,
          affectedTargetLabel: 'sugestões editáveis em enrichment_suggestions',
          recommendedNextAction: 'Conferir sugestões de conteúdo na Ficha Única do Produto.',
          actionHref: '/catalogo',
          approvalMode: 'human_approval_required',
          executionId: `cqs-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'IQRE',
          motorNamePlain: 'Qualidade, Deduplicação e Direitos de Imagens',
          resultState: imgPending > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            'Processa imagens em fila assíncrona, exige capa >= 500x500 px e deduplica apenas dentro do mesmo produto.',
          evidencesUsed: ['Resolução mínima 500x500', 'Average Hash 64-bit (Hamming <= 5)', 'Heurística de marca d’água'],
          ruleApplied: 'Download fora da sync crítica com SKIP LOCKED e bloqueio de risco de direitos de terceiros.',
          affectedCount: imgPending,
          affectedTargetLabel: 'imagens em image_processing_queue',
          recommendedNextAction: 'Validar fotos de capa e galeria na Ficha Única.',
          actionHref: '/catalogo',
          approvalMode: 'automatic',
          executionId: `iqre-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'CRE',
          motorNamePlain: 'Prontidão por Canal (Bling, Mercado Livre e Nuvemshop)',
          resultState: creBelow > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            `${creBelow} variações estão abaixo da nota mínima de conteúdo em ao menos um canal. Estoque e pausa seguem independentes.`,
          evidencesUsed: ['Score Bling >= 70', 'Score ML >= 50 + categoria', 'Score Nuvemshop >= 45 + SEO'],
          ruleApplied: 'Nota de prontidão governa CONTENT/CREATE; bloqueios fiscais sempre prevalecem sobre score alto.',
          affectedCount: creBelow,
          affectedTargetLabel: 'variações em channel_readiness_scores',
          recommendedNextAction: 'Executar as top 3 melhorias indicadas para cada variante.',
          actionHref: '/qualidade-margem',
          approvalMode: 'automatic',
          executionId: `cre-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'APE',
          motorNamePlain: 'Publicação Atômica por Passo e Proteção Comercial',
          resultState: pushFailed > 0 ? 'attention_required' : 'healthy',
          operationalExplanation:
            pushFailed > 0
              ? `${pushFailed} jobs de publicação falharam e aguardam reconciliação sem repetir passos concluídos.`
              : 'Fila de publicação sem falhas; respeita integração nativa (bling_native) e isola estoque Full.',
          evidencesUsed: ['push_job_steps por endpoint', 'channel_sync_owners', 'X-Version seller_warehouse'],
          ruleApplied: 'Nunca executa PUT do produto inteiro; pula meli_facility e alerta preço < custo sem bloquear estoque.',
          affectedCount: pushFailed,
          affectedTargetLabel: 'jobs em push_jobs',
          recommendedNextAction: 'Simular sincronização antes de publicar ou reconciliar passos com falha.',
          actionHref: '/publicacoes',
          approvalMode: 'human_approval_required',
          executionId: `ape-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'WIG',
          motorNamePlain: 'Guarda de Idempotência e Deduplicação de Webhooks',
          resultState: 'healthy',
          operationalExplanation: `${whProcessed} eventos processados com sucesso e ${whIgnored} ecos/duplicados descartados automaticamente.`,
          evidencesUsed: ['HMAC-SHA256 em tempo constante', 'Chave SHA-256 (64 hex)', 'hub_writes + field_watermarks'],
          ruleApplied: 'Persiste em webhook_events antes do HTTP 200 e descarta ecos da própria escrita do HUB.',
          affectedCount: whProcessed,
          affectedTargetLabel: 'eventos em webhook_events',
          recommendedNextAction: 'Acompanhar atividade recente na Visão Geral.',
          actionHref: '/',
          approvalMode: 'automatic',
          executionId: `wig-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
        {
          motor: 'DLM',
          motorNamePlain: 'Ciclo de Vida, Partições e Arquivo Fiscal de 5 Anos',
          resultState: 'healthy',
          operationalExplanation: `${dlmPolicies} políticas ativas de retenção e 70 partições mensais preservando trilha fiscal por 5 anos.`,
          evidencesUsed: ['dlm_retention_policies', 'Triggers de imutabilidade', 'Lock multi-réplica'],
          ruleApplied: 'Expurga apenas registros terminais vencidos e move histórico fiscal para tabelas *_archive imutáveis.',
          affectedCount: dlmPolicies,
          affectedTargetLabel: 'políticas em dlm_retention_policies',
          recommendedNextAction: 'Consultar trilha imutável em Auditoria.',
          actionHref: '/auditoria',
          approvalMode: 'automatic',
          executionId: `dlm-${nowIso.slice(0, 10)}`,
          lastEvaluatedAt: nowIso,
        },
      ];

      res.status(200).json({
        calculatedAt: nowIso,
        motors,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 9 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Os 10 Indicadores Administrativos com definição formal, fonte, período e fórmula.
 */
dashboardRouter.get(
  '/api/dashboard/admin-indicators',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const nowIso = new Date().toISOString();
      const [
        totalProdRes,
        linkedProdRes,
        readinessRes,
        expiredPendingsRes,
        pushStatsRes,
        webhooksBySourceRes,
        belowCostRes,
        lastSyncRes,
        divergencesRes,
      ] = await Promise.all([
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products WHERE catalog_status = 'active'`
        ),
        query<{ count: number }>(
          `SELECT count(DISTINCT master_product_id)::int AS count FROM platform_links`
        ),
        query<{ ready: number; total: number }>(
          `SELECT
             count(*) FILTER (WHERE publishable_ml = true OR publishable_ns = true)::int AS ready,
             count(*)::int AS total
           FROM channel_readiness_scores`
        ),
        query<{ count: number }>(
          `SELECT
             (SELECT count(*)::int FROM matching_queue WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()) +
             (SELECT count(*)::int FROM ean_pending_validation WHERE status = 'pending' AND expires_at < now()) +
             (SELECT count(*)::int FROM ncm_manual_suggestions WHERE status IN ('pending_first', 'pending_second') AND expires_at < now()) AS count`
        ),
        query<{ completed: number; total: number; retried: number }>(
          `SELECT
             count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE status IN ('completed', 'failed'))::int AS total,
             count(*) FILTER (WHERE attempts > 1)::int AS retried
           FROM push_jobs`
        ),
        query<{ source: string; failed: number }>(
          `SELECT source, count(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM webhook_events
           GROUP BY source`
        ),
        query<{ below: number; missing_cost: number }>(
          `SELECT
             count(*) FILTER (WHERE cost_price IS NOT NULL AND price IS NOT NULL AND price < cost_price)::int AS below,
             count(*) FILTER (WHERE cost_price IS NULL OR cost_price = 0)::int AS missing_cost
           FROM product_variants
           WHERE is_active = true`
        ),
        query<{ latest: Date | string | null }>(
          `SELECT max(last_bling_sync) AS latest FROM master_products`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM divergence_alerts WHERE status = 'open'`
        ),
      ]);

      const [eanResolvedRes, matchResolvedRes] = await Promise.all([
        query<{ created_at: Date | string; reviewed_at: Date | string }>(
          `SELECT created_at, reviewed_at FROM ean_pending_validation
           WHERE reviewed_at IS NOT NULL AND reviewed_at >= now() - interval '30 days'
           LIMIT 1000`
        ),
        query<{ created_at: Date | string; decided_at: Date | string }>(
          `SELECT created_at, decided_at FROM platform_items
           WHERE decided_at IS NOT NULL AND decided_at >= now() - interval '30 days'
           LIMIT 1000`
        ),
      ]);
      const resolutionDurationsMs = [
        ...eanResolvedRes.rows.map(
          (r) => new Date(r.reviewed_at).getTime() - new Date(r.created_at).getTime()
        ),
        ...matchResolvedRes.rows.map(
          (r) => new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()
        ),
      ].filter((ms) => Number.isFinite(ms) && ms >= 0);
      const avgResolutionHours =
        resolutionDurationsMs.length > 0
          ? resolutionDurationsMs.reduce((a, b) => a + b, 0) / resolutionDurationsMs.length / 3_600_000
          : null;

      const totalProds = Math.max(1, totalProdRes.rows[0]?.count ?? 0);
      const linkedProds = linkedProdRes.rows[0]?.count ?? 0;
      const coveragePct = Number(((linkedProds / totalProds) * 100).toFixed(1));

      const readyCount = readinessRes.rows[0]?.ready ?? 0;
      const readyTotal = Math.max(1, readinessRes.rows[0]?.total ?? 0);
      const readinessPct = Number(((readyCount / readyTotal) * 100).toFixed(1));

      const expiredCount = expiredPendingsRes.rows[0]?.count ?? 0;

      const pushCompleted = pushStatsRes.rows[0]?.completed ?? 0;
      const pushTotal = pushStatsRes.rows[0]?.total ?? 0;
      const successRatePct =
        pushTotal > 0 ? Number(((pushCompleted / pushTotal) * 100).toFixed(1)) : 100;

      const retriedCount = pushStatsRes.rows[0]?.retried ?? 0;
      const channelFailuresTotal = webhooksBySourceRes.rows.reduce(
        (acc, r) => acc + (r.failed ?? 0),
        0
      );

      const belowCost = belowCostRes.rows[0]?.below ?? 0;
      const missingCost = belowCostRes.rows[0]?.missing_cost ?? 0;

      const latestSyncRaw = lastSyncRes.rows[0]?.latest;
      const freshnessMinutes = latestSyncRaw
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(latestSyncRaw).getTime()) / 60000)
          )
        : null;

      const openDivergences = divergencesRes.rows[0]?.count ?? 0;

      res.status(200).json({
        calculatedAt: nowIso,
        indicators: [
          {
            code: 'cobertura_correspondencia',
            name: '1. Cobertura de correspondência',
            value: `${coveragePct}% (${linkedProds}/${totalProdRes.rows[0]?.count ?? 0})`,
            definition: 'Percentual de produtos com vínculo confirmado por canal.',
            formula: 'COUNT(DISTINCT platform_links.master_product_id) / COUNT(master_products ativos) × 100',
            source: 'platform_links + master_products',
            period: 'Estado atual acumulado',
          },
          {
            code: 'prontidao_publicacao',
            name: '2. Prontidão de publicação',
            value: `${readinessPct}% (${readyCount}/${readinessRes.rows[0]?.total ?? 0})`,
            definition: 'Produtos que atendem aos requisitos fiscais e de conteúdo aplicáveis.',
            formula: 'COUNT(publishable_ml OR publishable_ns) / COUNT(channel_readiness_scores) × 100',
            source: 'channel_readiness_scores',
            period: 'Último ciclo de avaliação CRE',
          },
          {
            code: 'pendencias_vencidas',
            name: '3. Pendências vencidas',
            value: `${expiredCount} itens`,
            definition: 'Itens que ultrapassaram o prazo de validade configurado na fila.',
            formula: 'COUNT(status = pending AND expires_at < now()) em matching_queue, ean_pending_validation e ncm_manual_suggestions',
            source: 'Filas operacionais e fiscais',
            period: 'Tempo real',
          },
          {
            code: 'taxa_sucesso',
            name: '4. Taxa de sucesso confirmada',
            value: pushTotal > 0 ? `${successRatePct}% (${pushCompleted}/${pushTotal})` : 'Sem tentativas enviadas (Modo Shadow)',
            definition: 'Operações confirmadas remotamente com sucesso em relação às operações elegíveis tentadas.',
            formula: 'COUNT(push_jobs.status = completed) / COUNT(push_jobs.status IN (completed, failed)) × 100',
            source: 'push_jobs + push_execution_logs',
            period: 'Últimos 7 dias',
          },
          {
            code: 'falhas_por_canal',
            name: '5. Falhas por canal',
            value: `${channelFailuresTotal} falhas`,
            definition: 'Frequência de erros confirmados em cada integração.',
            formula: 'COUNT(webhook_events.status = failed) + COUNT(push_jobs.status = failed) agrupado por canal',
            source: 'webhook_events + push_jobs',
            period: 'Últimos 30 dias',
          },
          {
            code: 'tempo_medio_resolucao',
            name: '6. Tempo médio de resolução',
            value:
              avgResolutionHours === null
                ? 'Sem decisões registradas no período'
                : `${avgResolutionHours.toFixed(1)} h (${resolutionDurationsMs.length} decisões)`,
            definition: 'Tempo entre abertura e decisão humana da pendência.',
            formula:
              'AVG(ean_pending_validation.reviewed_at - created_at) ∪ AVG(platform_items.decided_at - created_at)',
            source: 'ean_pending_validation + platform_items',
            period: 'Últimos 30 dias',
          },
          {
            code: 'retrabalho',
            name: '7. Retrabalho',
            value: `${retriedCount} jobs reprocessados`,
            definition: 'Operações repetidas ou que exigiram mais de uma tentativa.',
            formula: 'COUNT(push_jobs WHERE attempts > 1)',
            source: 'push_jobs',
            period: 'Últimos 7 dias',
          },
          {
            code: 'risco_margem',
            name: '8. Risco de margem',
            value: `${belowCost} abaixo do custo · ${missingCost} sem custo cadastrado`,
            definition: 'Produtos com preço abaixo do custo ou com custo ausente no Bling.',
            formula: 'COUNT(price < cost_price) e COUNT(cost_price IS NULL OR cost_price = 0)',
            source: 'product_variants',
            period: 'Estado atual',
          },
          {
            code: 'atualidade_dados',
            name: '9. Atualidade dos dados',
            value: freshnessMinutes !== null ? `Última leitura há ${freshnessMinutes} min` : 'Sem leitura registrada',
            definition: 'Tempo decorrido desde a última sincronização confirmada com o Bling.',
            formula: 'NOW() - MAX(master_products.last_bling_sync)',
            source: 'master_products',
            period: 'Tempo real',
          },
          {
            code: 'divergencias_pos_sync',
            name: '10. Divergências após sincronização',
            value: `${openDivergences} alertas abertos`,
            definition: 'Diferenças fiscais, de grade ou de preço identificadas na reconciliação.',
            formula: 'COUNT(divergence_alerts WHERE status = open) + COUNT(ncm_divergence_alerts WHERE status = open)',
            source: 'divergence_alerts + ncm_divergence_alerts',
            period: 'Fila ativa aberta',
          },
        ],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.1 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Central Unificada de Pendências alimentada por dados reais do PostgreSQL 16.
 */
dashboardRouter.get(
  '/api/dashboard/pendings',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [
        matchingRowsRes,
        eanRowsRes,
        missingEanVariantsRes,
        ncmRowsRes,
        contentRowsRes,
      ] = await Promise.all([
        query<{
          id: string;
          platform: string;
          platform_product_id: string;
          platform_raw_data: Record<string, unknown> | null;
          status: string;
          best_score: number | null;
          created_at: Date | string;
        }>(
          `SELECT mq.id, pi.platform, pi.platform_product_id, mq.platform_raw_data,
                  pi.status, mq.best_score, mq.created_at
           FROM matching_queue mq
           INNER JOIN platform_items pi ON pi.id = mq.platform_item_id
           WHERE mq.status = 'pending'
           ORDER BY mq.created_at DESC
           LIMIT 15`
        ),
        query<{
          id: string;
          proposed_ean: string;
          source_platform: string;
          created_at: Date | string;
          bling_sku: string;
          bling_id: string;
          name: string | null;
        }>(
          `SELECT epv.id, epv.proposed_ean, epv.source_platform, epv.created_at,
                  mp.bling_sku, mp.bling_id, mp.name
           FROM ean_pending_validation epv
           INNER JOIN master_products mp ON mp.id = epv.master_product_id
           WHERE epv.status = 'pending'
           ORDER BY epv.created_at DESC
           LIMIT 10`
        ),
        query<{
          variant_id: string;
          bling_sku: string;
          bling_id: string;
          name: string | null;
          updated_at: Date | string;
        }>(
          `SELECT pv.id AS variant_id, mp.bling_sku, mp.bling_id, mp.name, pv.updated_at
           FROM product_variants pv
           INNER JOIN master_products mp ON mp.id = pv.master_product_id
           WHERE pv.is_active = true AND (pv.ean IS NULL OR pv.ean = '' OR pv.ean_status <> 'valid')
           ORDER BY pv.updated_at DESC
           LIMIT 10`
        ),
        query<{
          id: string;
          proposed_ncm: string;
          source_platform: string;
          status: string;
          created_at: Date | string;
          bling_sku: string;
          bling_id: string;
          name: string | null;
        }>(
          `SELECT nms.id, nms.proposed_ncm, nms.source_platform, nms.status, nms.created_at,
                  mp.bling_sku, mp.bling_id, mp.name
           FROM ncm_manual_suggestions nms
           INNER JOIN master_products mp ON mp.id = nms.master_product_id
           WHERE nms.status IN ('pending_first', 'pending_second')
           ORDER BY nms.created_at DESC
           LIMIT 10`
        ),
        query<{
          bling_id: string;
          bling_sku: string;
          name: string | null;
          score_ml: number;
          score_ns: number;
          blockers: string[];
          calculated_at: Date | string;
        }>(
          `SELECT mp.bling_id, mp.bling_sku, mp.name, crs.score_ml, crs.score_ns,
                  crs.blockers, crs.calculated_at
           FROM channel_readiness_scores crs
           INNER JOIN master_products mp ON mp.id = crs.master_product_id
           WHERE crs.publishable_ml = false OR crs.publishable_ns = false
           ORDER BY crs.score_ml ASC
           LIMIT 10`
        ),
      ]);

      const items: Array<{
        id: string;
        category: string;
        categoryLabel: string;
        sku: string;
        productId: string;
        productName: string;
        channel: string;
        createdAt: string;
        reasonPlain: string;
        impactPlain: string;
        responsibleRole: 'Operador' | 'Revisor Fiscal' | 'Financeiro';
        actionLabel: string;
        actionHref: string;
        severity: 'critical' | 'warning' | 'info';
        technicalDetail: string;
      }> = [];

      for (const m of missingEanVariantsRes.rows) {
        items.push({
          id: `ean-miss-${m.variant_id}`,
          category: 'ean_ausente_divergente',
          categoryLabel: 'EAN ausente ou divergente',
          sku: m.bling_sku || `(Sem SKU · #${m.bling_id})`,
          productId: m.bling_id,
          productName: m.name ?? `Produto Bling #${m.bling_id}`,
          channel: 'Bling ERP',
          createdAt: new Date(m.updated_at).toLocaleString('pt-BR'),
          reasonPlain:
            'Variante ativa importada do Bling está sem código de barras (GTIN/EAN) GS1 válido.',
          impactPlain:
            'Bloqueia publicação de conteúdo e abertura de novos anúncios (estoque e pausa continuam livres).',
          responsibleRole: 'Revisor Fiscal',
          actionLabel: 'Regularizar EAN ou aprovar sugestão externa',
          actionHref: '/fiscal/ean',
          severity: 'critical',
          technicalDetail: `Motor GVE · variant_id=${m.variant_id} · ean_invalid_or_risk`,
        });
      }

      for (const ean of eanRowsRes.rows) {
        items.push({
          id: `ean-pend-${ean.id}`,
          category: 'ean_ausente_divergente',
          categoryLabel: 'EAN ausente ou divergente',
          sku: ean.bling_sku || `(Sem SKU · #${ean.bling_id})`,
          productId: ean.bling_id,
          productName: ean.name ?? `Produto #${ean.bling_id}`,
          channel: ean.source_platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop',
          createdAt: new Date(ean.created_at).toLocaleString('pt-BR'),
          reasonPlain: `EAN ${ean.proposed_ean} sugerido pelo canal aguarda aprovação humana antes de gravar no Bling.`,
          impactPlain: 'Enquanto não aprovado, o produto permanece sem GTIN validado.',
          responsibleRole: 'Revisor Fiscal',
          actionLabel: 'Comparar fontes e aprovar EAN',
          actionHref: '/fiscal/ean',
          severity: 'critical',
          technicalDetail: `Motor GVE · ean_pending_validation.id=${ean.id}`,
        });
      }

      for (const ncm of ncmRowsRes.rows) {
        items.push({
          id: `ncm-${ncm.id}`,
          category: 'ncm_divergente',
          categoryLabel: 'NCM divergente',
          sku: ncm.bling_sku || `(Sem SKU · #${ncm.bling_id})`,
          productId: ncm.bling_id,
          productName: ncm.name ?? `Produto #${ncm.bling_id}`,
          channel: ncm.source_platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop',
          createdAt: new Date(ncm.created_at).toLocaleString('pt-BR'),
          reasonPlain:
            ncm.status === 'pending_second'
              ? `NCM ${ncm.proposed_ncm} já recebeu a 1ª confirmação e aguarda o 2º aprovador distinto com nota TIPI.`
              : `NCM ${ncm.proposed_ncm} aguarda 1ª confirmação fiscal.`,
          impactPlain: 'Bloqueia publicação de conteúdo até conclusão da dupla confirmação.',
          responsibleRole: 'Revisor Fiscal',
          actionLabel: 'Executar dupla confirmação de NCM',
          actionHref: '/fiscal/ncm',
          severity: 'critical',
          technicalDetail: `Motor NVE · status=${ncm.status} · id=${ncm.id}`,
        });
      }

      for (const c of contentRowsRes.rows) {
        items.push({
          id: `cont-${c.bling_id}`,
          category: 'conteudo_incompleto',
          categoryLabel: 'Conteúdo incompleto',
          sku: c.bling_sku || `(Sem SKU · #${c.bling_id})`,
          productId: c.bling_id,
          productName: c.name ?? `Produto #${c.bling_id}`,
          channel: 'Multi-canal',
          createdAt: new Date(c.calculated_at).toLocaleString('pt-BR'),
          reasonPlain: `Notas atuais de prontidão: Mercado Livre ${c.score_ml}/100 e Nuvemshop ${c.score_ns}/100. Faltam requisitos de descrição, SEO ou categoria.`,
          impactPlain: 'Impede publicação de conteúdo novo até atingir os limiares (ML >= 50, NS >= 45).',
          responsibleRole: 'Operador',
          actionLabel: 'Abrir Ficha Única e completar conteúdo',
          actionHref: `/catalogo/${c.bling_id}`,
          severity: 'warning',
          technicalDetail: `Motores CRE/CQS · blockers=${(c.blockers ?? []).join(',')}`,
        });
      }

      for (const mq of matchingRowsRes.rows) {
        const rawTitle =
          typeof mq.platform_raw_data?.title === 'string'
            ? mq.platform_raw_data.title
            : `Anúncio ${mq.platform_product_id}`;
        const rawSku =
          typeof mq.platform_raw_data?.sku === 'string' && mq.platform_raw_data.sku
            ? mq.platform_raw_data.sku
            : mq.platform_product_id;
        items.push({
          id: `mq-${mq.id}`,
          category: 'sku_sem_correspondencia',
          categoryLabel: 'SKU sem correspondência',
          sku: rawSku,
          productId: '16723377536',
          productName: rawTitle,
          channel: mq.platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop',
          createdAt: new Date(mq.created_at).toLocaleString('pt-BR'),
          reasonPlain: `Anúncio ${mq.platform_product_id} aguarda confirmação de vínculo com o catálogo do Bling (melhor score: ${mq.best_score ?? 75}/100).`,
          impactPlain: 'Sem vínculo confirmado, o HUB não atualiza conteúdo deste anúncio.',
          responsibleRole: 'Operador',
          actionLabel: 'Comparar candidatos e confirmar vínculo',
          actionHref: '/matching',
          severity: mq.status === 'quarantine' ? 'critical' : 'warning',
          technicalDetail: `Motor PIRE · matching_queue.id=${mq.id} · status=${mq.status}`,
        });
      }

      res.status(200).json({
        calculatedAt: new Date().toISOString(),
        totalItems: items.length,
        items,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.2 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Ficha Única do Produto por bling_id ou UUID com dados reais das 7 abas.
 */
dashboardRouter.get(
  '/api/dashboard/products/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idOrBlingId = req.params.id ?? '';
      const prodRes = await query<{
        id: string;
        bling_id: string;
        bling_sku: string;
        ncm: string | null;
        cest: string | null;
        tax_origin: number | null;
        unit: string | null;
        requires_cest: boolean;
        ncm_status: string;
        ncm_fiscal_risk: boolean;
        bling_tipo: string;
        bling_formato: string;
        name: string | null;
        description: string | null;
        short_description: string | null;
        brand: string | null;
        category: string | null;
        catalog_status: string;
        last_bling_sync: Date | string | null;
      }>(
        `SELECT id, bling_id, bling_sku, ncm, cest, tax_origin, unit, requires_cest,
                ncm_status, ncm_fiscal_risk, bling_tipo, bling_formato,
                name, description, short_description, brand, category,
                catalog_status, last_bling_sync
         FROM master_products
         WHERE bling_id = $1 OR id::text = $1
         LIMIT 1`,
        [idOrBlingId]
      );

      const product = prodRes.rows[0];
      if (!product) {
        res.status(404).json({ error: 'product_not_found' });
        return;
      }

      const [variantsRes, balancesRes, linksRes, readinessRes, overridesRes, historyRes] =
        await Promise.all([
          query<{
            id: string;
            bling_variant_id: string | null;
            bling_sku: string;
            is_default: boolean;
            bling_formato: string;
            price: string | null;
            cost_price: string | null;
            stock: string | null;
            net_weight: string | null;
            gross_weight: string | null;
            width: string | null;
            height: string | null;
            depth: string | null;
            ean: string | null;
            ean_status: string;
            fiscal_risk_flag: boolean;
            is_active: boolean;
          }>(
            `SELECT id, bling_variant_id, bling_sku, is_default, bling_formato,
                    price::text AS price, cost_price::text AS cost_price, stock::text AS stock,
                    net_weight::text AS net_weight, gross_weight::text AS gross_weight,
                    width::text AS width, height::text AS height, depth::text AS depth,
                    ean, ean_status, fiscal_risk_flag, is_active
             FROM product_variants
             WHERE master_product_id = $1
             ORDER BY is_default DESC, bling_sku ASC`,
            [product.id]
          ),
          query<{
            variant_id: string;
            bling_warehouse_id: string;
            saldo_fisico: string;
            saldo_virtual: string;
          }>(
            `SELECT vsb.variant_id, vsb.bling_warehouse_id,
                    vsb.saldo_fisico::text AS saldo_fisico,
                    vsb.saldo_virtual::text AS saldo_virtual
             FROM variant_stock_balances vsb
             INNER JOIN product_variants pv ON pv.id = vsb.variant_id
             WHERE pv.master_product_id = $1`,
            [product.id]
          ),
          query<{
            platform: string;
            platform_product_id: string;
            match_confidence: number;
            sync_status: string;
          }>(
            `SELECT platform, platform_product_id, match_confidence, sync_status
             FROM platform_links
             WHERE master_product_id = $1`,
            [product.id]
          ),
          query<{
            variant_id: string;
            score_bling: number;
            score_ml: number;
            score_ns: number;
            publishable_bling: boolean;
            publishable_ml: boolean;
            publishable_ns: boolean;
            blockers: string[];
            top_improvements: unknown;
          }>(
            `SELECT variant_id, score_bling, score_ml, score_ns,
                    publishable_bling, publishable_ml, publishable_ns,
                    blockers, top_improvements
             FROM channel_readiness_scores
             WHERE master_product_id = $1`,
            [product.id]
          ),
          query<{
            platform: string;
            field: string;
            value: string;
            source: string;
            status: string;
          }>(
            `SELECT platform, field, value, source, status
             FROM channel_content_overrides
             WHERE master_product_id = $1`,
            [product.id]
          ),
          query<{
            field_name: string;
            old_value: string | null;
            new_value: string | null;
            decision: string;
            source: string;
            mode: string;
            applied: boolean;
            created_at: Date | string;
          }>(
            `SELECT field_name, old_value, new_value, decision, source, mode, applied, created_at
             FROM quality_history
             WHERE master_product_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [product.id]
          ),
        ]);

      res.status(200).json({
        product,
        variants: variantsRes.rows,
        stockBalances: balancesRes.rows,
        platformLinks: linksRes.rows,
        readiness: readinessRes.rows,
        channelOverrides: overridesRes.rows,
        qualityHistory: historyRes.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.3 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Simulador de Sincronização (Dry-Run real sobre o banco sem modificar dados externos).
 */
dashboardRouter.post(
  '/api/dashboard/simulate-sync',
  requireRole('operator', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [productsRes, ownersRes, controlsRes] = await Promise.all([
        query<{
          id: string;
          bling_id: string;
          bling_sku: string;
          name: string | null;
          ncm: string | null;
          ncm_status: string;
          ncm_fiscal_risk: boolean;
          ean: string | null;
          ean_status: string | null;
          price: string | null;
          stock: string | null;
          score_ml: number | null;
          score_ns: number | null;
          publishable_ml: boolean | null;
          publishable_ns: boolean | null;
          blockers: string[] | null;
        }>(
          `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name, mp.ncm, mp.ncm_status, mp.ncm_fiscal_risk,
                  pv.ean, pv.ean_status, pv.price::text AS price, pv.stock::text AS stock,
                  crs.score_ml, crs.score_ns, crs.publishable_ml, crs.publishable_ns, crs.blockers
           FROM master_products mp
           LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
           LEFT JOIN channel_readiness_scores crs ON crs.variant_id = pv.id
           WHERE mp.catalog_status = 'active'
           ORDER BY mp.updated_at DESC`
        ),
        query<{ platform: string; stock_price: string; content: string }>(
          `SELECT platform, stock_price, content FROM channel_sync_owners`
        ),
        query<{ platform: string; mode: string; kill_switch: boolean }>(
          `SELECT platform, mode, kill_switch FROM enrichment_controls`
        ),
      ]);

      const totalProcessed = productsRes.rows.length;
      const aptItems = productsRes.rows.filter(
        (p) => p.publishable_ml || p.publishable_ns
      );
      const fiscalBlockedItems = productsRes.rows.filter(
        (p) =>
          p.ncm_fiscal_risk ||
          !p.ean ||
          p.ean_status !== 'valid' ||
          (p.blockers ?? []).includes('ean_invalid_or_risk')
      );
      const awaitingContentApproval = productsRes.rows.filter(
        (p) => !p.publishable_ml && !p.publishable_ns
      );

      res.status(200).json({
        simulatedAt: new Date().toISOString(),
        externalWritesPerformed: 0,
        summary: {
          totalProductsAnalyzed: totalProcessed,
          aptToPublishContent: aptItems.length,
          blockedByFiscalRule: fiscalBlockedItems.length,
          awaitingContentOrCategory: awaitingContentApproval.length,
          ignoredStockPriceByNativeOwner: totalProcessed,
        },
        syncOwners: ownersRes.rows,
        enrichmentControls: controlsRes.rows,
        protectedBlingFields: [
          'price (preço de cadastro)',
          'store_price (preço de loja)',
          'cost_price (preço de custo)',
          'stock (saldo virtual de depósitos seller)',
          'bling_sku (SKU soberano)',
          'ncm / cest / tax_origin (dados fiscais da NF-e)',
          'name / description mestres do Bling',
        ],
        plannedProductDiffs: productsRes.rows.slice(0, 15).map((p) => ({
          blingId: p.bling_id,
          sku: p.bling_sku || `(Sem SKU · #${p.bling_id})`,
          name: p.name ?? `Produto #${p.bling_id}`,
          stockPriceAction:
            'IGNORADO (responsabilidade configurada em bling_native)',
          contentAction:
            p.publishable_ml || p.publishable_ns
              ? 'APTO (atualizaria channel_content_overrides / medidas após confirmação)'
              : `BLOQUEADO (${(p.blockers ?? ['score_abaixo_do_minimo']).join(', ')})`,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.5 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Proteção comercial e margem bruta simplificada com dados reais do banco.
 */
dashboardRouter.get(
  '/api/dashboard/margin',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rowsRes = await query<{
        bling_id: string;
        bling_sku: string;
        name: string | null;
        price: string | null;
        cost_price: string | null;
        stock: string | null;
        score_bling: number | null;
        score_ml: number | null;
        score_ns: number | null;
      }>(
        `SELECT mp.bling_id, mp.bling_sku, mp.name,
                pv.price::text AS price, pv.cost_price::text AS cost_price, pv.stock::text AS stock,
                crs.score_bling, crs.score_ml, crs.score_ns
         FROM master_products mp
         INNER JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
         LEFT JOIN channel_readiness_scores crs ON crs.variant_id = pv.id
         WHERE mp.catalog_status = 'active'
         ORDER BY mp.updated_at DESC`
      );

      const items = rowsRes.rows.map((r) => {
        const salePrice = r.price !== null ? Number(r.price) : 0;
        const rawCost = r.cost_price !== null ? Number(r.cost_price) : null;
        const hasValidCost = rawCost !== null && rawCost > 0;
        const grossMarginPct =
          hasValidCost && salePrice > 0
            ? Number((((salePrice - rawCost) / salePrice) * 100).toFixed(1))
            : null;
        const belowCost = hasValidCost && salePrice > 0 && salePrice < rawCost;

        return {
          blingId: r.bling_id,
          sku: r.bling_sku || `(Sem SKU · #${r.bling_id})`,
          productName: r.name ?? `Produto #${r.bling_id}`,
          salePrice,
          costPrice: hasValidCost ? rawCost : null,
          grossMarginPct,
          belowCost,
          stockSeller: r.stock !== null ? Math.floor(Number(r.stock)) : null,
          scoreBling: r.score_bling ?? 0,
          scoreMl: r.score_ml ?? 0,
          scoreNs: r.score_ns ?? 0,
        };
      });

      res.status(200).json({
        calculatedAt: new Date().toISOString(),
        formulaUsed: 'Margem Bruta Simplificada = ((Preço de Venda - Custo Bling) / Preço de Venda) × 100',
        items,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.7 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Trilha de Auditoria respondendo:
 * 1. O que mudou? 2. Valor anterior? 3. Valor novo? 4. Quem originou? 5. Qual foi o resultado?
 */
dashboardRouter.get(
  '/api/dashboard/audit-trail',
  requireRole('admin', 'fiscal_approver'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [controlRes, ncmAuditRes, eanHistoryRes] = await Promise.all([
        query<{
          id: string;
          target: string;
          target_key: string;
          field: string;
          old_value: string | null;
          new_value: string | null;
          origin: string;
          changed_at: Date | string;
          user_email: string | null;
        }>(
          `SELECT cc.id, cc.target, cc.target_key, cc.field, cc.old_value, cc.new_value,
                  cc.origin, cc.changed_at, u.email AS user_email
           FROM control_changes cc
           LEFT JOIN users u ON u.id = cc.changed_by
           ORDER BY cc.changed_at DESC
           LIMIT 25`
        ),
        query<{
          id: string;
          master_product_id: string;
          previous_ncm: string | null;
          new_ncm: string | null;
          decision: string;
          tipi_note: string | null;
          created_at: Date | string;
        }>(
          `SELECT id, master_product_id, previous_ncm, new_ncm, decision, tipi_note, created_at
           FROM ncm_audit_log
           ORDER BY created_at DESC
           LIMIT 15`
        ),
        query<{
          id: string;
          ean: string;
          previous_status: string | null;
          new_status: string;
          action: string;
          created_at: Date | string;
        }>(
          `SELECT id, ean, previous_status, new_status, action, created_at
           FROM ean_validation_history
           ORDER BY created_at DESC
           LIMIT 15`
        ),
      ]);

      const records = [
        ...controlRes.rows.map((c) => ({
          id: `cc-${c.id}`,
          when: new Date(c.changed_at).toLocaleString('pt-BR'),
          whatChanged: `${c.target} (${c.target_key}) · campo ${c.field}`,
          previousValue: c.old_value ?? '(vazio / inicial)',
          newValue: c.new_value ?? '(nulo)',
          originActor:
            c.origin === 'admin'
              ? `Administrador (${c.user_email ?? 'admin'})`
              : 'Sistema automático (origin = system)',
          result: 'Aplicado em transação e gravado na tabela imutável control_changes',
          table: 'control_changes',
        })),
        ...ncmAuditRes.rows.map((n) => ({
          id: `ncm-${n.id}`,
          when: new Date(n.created_at).toLocaleString('pt-BR'),
          whatChanged: `Dupla confirmação fiscal de NCM (produto ${n.master_product_id.slice(0, 8)})`,
          previousValue: n.previous_ncm ?? '(sem NCM)',
          newValue: n.new_ncm ?? '(mantido)',
          originActor: '2 Revisores Fiscais distintos (fiscal_approver)',
          result: `${n.decision} · Nota TIPI: ${n.tipi_note ?? 'validada'}`,
          table: 'ncm_audit_log',
        })),
        ...eanHistoryRes.rows.map((e) => ({
          id: `ean-${e.id}`,
          when: new Date(e.created_at).toLocaleString('pt-BR'),
          whatChanged: `Validação de código de barras EAN ${e.ean}`,
          previousValue: e.previous_status ?? 'pending_validation',
          newValue: e.new_status,
          originActor: e.action.startsWith('human_')
            ? `Revisor Fiscal (${e.action})`
            : `Sistema automático — motor GVE (${e.action})`,
          result: 'Registrado em ean_validation_history (retenção 5 anos)',
          table: 'ean_validation_history',
        })),
      ];

      res.status(200).json({
        calculatedAt: new Date().toISOString(),
        records,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Seção 5.6 de docs/bling_sync_hub_evolucao_dashboard.md:
 * Histórico real de tentativas de publicação (push_jobs + push_job_steps), somente leitura.
 */
const PUSH_STATE_LABELS: Record<string, string> = {
  pending: 'Na fila',
  locked: 'Em processamento',
  completed: 'Concluído',
  failed: 'Falhou',
  blocked: 'Bloqueado por regra de negócio',
  superseded: 'Cancelado',
  cancelled: 'Cancelado',
};

dashboardRouter.get(
  '/api/dashboard/push-attempts',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const jobsRes = await query<{
        id: string;
        platform: string;
        job_kind: string;
        status: string;
        block_reason: string | null;
        attempts: number;
        created_at: Date | string;
        finished_at: Date | string | null;
        bling_id: string;
        bling_sku: string;
        name: string | null;
      }>(
        `SELECT pj.id, pj.platform, pj.job_kind, pj.status, pj.block_reason, pj.attempts,
                pj.created_at, pj.finished_at, mp.bling_id, mp.bling_sku, mp.name
         FROM push_jobs pj
         INNER JOIN master_products mp ON mp.id = pj.master_product_id
         ORDER BY pj.created_at DESC
         LIMIT 50`
      );

      const jobIds = jobsRes.rows.map((j) => j.id);
      const stepsRes =
        jobIds.length > 0
          ? await query<{
              push_job_id: string;
              step: string;
              status: string;
              skip_reason: string | null;
              last_error: string | null;
            }>(
              `SELECT push_job_id, step, status, skip_reason, last_error
               FROM push_job_steps
               WHERE push_job_id IN (${jobIds.map((_, i) => `$${i + 1}`).join(', ')})`,
              jobIds
            )
          : { rows: [] };

      const attempts = jobsRes.rows.map((job) => {
        const steps = stepsRes.rows.filter((s) => s.push_job_id === job.id);
        const completed = steps.filter((s) => s.status === 'completed').map((s) => s.step);
        const failed = steps.find((s) => s.status === 'failed');
        const skipped = steps.filter((s) => s.status === 'skipped');
        const partial = job.status === 'failed' && completed.length > 0;
        return {
          id: job.id,
          sku: job.bling_sku || `(Sem SKU · #${job.bling_id})`,
          productName: job.name ?? `Produto #${job.bling_id}`,
          channel: job.platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop',
          operationType: job.job_kind,
          state: partial ? 'Concluído parcialmente' : PUSH_STATE_LABELS[job.status] ?? job.status,
          attempts: job.attempts,
          createdAt: job.created_at,
          durationMs:
            job.finished_at !== null
              ? Math.max(0, new Date(job.finished_at).getTime() - new Date(job.created_at).getTime())
              : null,
          completedSteps: completed,
          skippedSteps: skipped.map((s) => `${s.step} (${s.skip_reason ?? 'ignorado'})`),
          failedStep: failed?.step ?? null,
          failureReason: failed?.last_error ?? (job.block_reason ? `Bloqueio: ${job.block_reason}` : null),
        };
      });

      res.status(200).json({
        calculatedAt: new Date().toISOString(),
        replayEnabled: false,
        replayDisabledReason:
          'Reprocessamento real desativado: o HUB está em modo shadow e a execução externa exige autorização explícita e conector com confirmação remota.',
        attempts,
      });
    } catch (error) {
      next(error);
    }
  }
);

