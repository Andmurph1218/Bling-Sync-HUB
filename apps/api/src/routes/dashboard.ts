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
