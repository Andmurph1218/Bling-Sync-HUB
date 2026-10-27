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
        query<{ provider: string; expires_at: Date | string; updated_at: Date | string }>(
          `SELECT provider, expires_at, updated_at FROM oauth_tokens ORDER BY provider ASC`
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
        }>(
          `SELECT
             mq.id AS queue_id,
             mq.platform_item_id,
             pi.platform,
             pi.platform_product_id,
             pi.status AS item_status,
             mq.best_score,
             mq.suggested_matches
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

      res.status(200).json({
        pendingQueue: queueRes.rows,
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

      res.status(200).json({ pendingEans: pendingRes.rows });
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

      res.status(200).json({
        suggestions: suggestionsRes.rows,
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
