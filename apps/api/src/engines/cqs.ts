/**
 * Motor CQS — Content Quality Scoring & Enrichment Engine (Seções 7, 8.5, 9.4, 9.5, 10.1 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Grades: F (0..20), D (21..40), C (41..60), B (61..80), A (81..100).
 * - Árvore de decisão (a primeira regra que casar vence):
 *   1. Externo grade F, ou score externo < 15 -> KEEP
 *   2. Bling grade A -> KEEP
 *   3. Bling grade F e externo pelo menos C (>= 41) -> REPLACE
 *   4. Bling grade D, externo B ou A (>= 61), delta >= 15 -> REPLACE
 *   5. Delta >= 30 com Bling em C ou D -> REPLACE
 *   6. Delta 15..29, ou Bling grade B com qualquer delta positivo -> SUGGEST
 *   7. Qualquer outro caso -> KEEP
 * - Invariante absoluta: REPLACE automático NUNCA ocorre em grade A nem em grade B.
 * - Nome e descrição do Bling NUNCA recebem texto de canal; título e descrição de canal ficam em channel_content_overrides.
 * - Categoria interna do Bling nunca é sobrescrita por path de canal.
 * - Peso e dimensões só aceitam REPLACE se as 3 medidas estiverem preenchidas e concordarem dentro de 5%; senão vira SUGGEST.
 * - Modo padrão é 'shadow' (applied = false em quality_history). Em 'live', respeita kill_switch e max_replaces_per_run
 *   (excedente vira SUGGEST), grava hub_writes e permite reversão pelo quality_history (linhas shadow não são revertidas).
 */

import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type EnrichmentDecision = 'KEEP' | 'REPLACE' | 'SUGGEST';

export interface FieldScoreResult {
  score: number;
  grade: QualityGrade;
  penalties: string[];
}

export function scoreToGrade(score: number): QualityGrade {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped >= 81) return 'A';
  if (clamped >= 61) return 'B';
  if (clamped >= 41) return 'C';
  if (clamped >= 21) return 'D';
  return 'F';
}

const GENERIC_NAMES = ['produto', 'item', 'a definir', 'sem nome', 'cadastro', 'teste'];
const PLACEHOLDER_DESCRIPTIONS = ['a definir', 'consulte', 'ver imagem', 'sem descricao', 'sem descrição'];
const GENERIC_BRANDS = ['generico', 'genérico', 'sem marca', 'n/a', 'na', 'outros', 'importado'];
const SENTINEL_WEIGHTS = new Set([0.001, 0.01, 1, 100]);
const GENERIC_CATEGORIES = ['geral', 'outros', 'sem categoria', 'diversos'];

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function evaluateNameQuality(raw?: string | null): FieldScoreResult {
  if (!raw || raw.trim().length === 0) {
    return { score: 0, grade: 'F', penalties: ['empty'] };
  }
  const text = raw.trim();
  const lower = text.toLowerCase();
  const penalties: string[] = [];
  let score = 90;

  if (text.length < 10) {
    score -= 60;
    penalties.push('too_short_lt_10');
  } else if (text.length < 20) {
    score -= 20;
    penalties.push('short_lt_20');
  }

  if (GENERIC_NAMES.some((g) => lower === g || lower.startsWith(`${g} `))) {
    score -= 65;
    penalties.push('generic_name');
  }

  const letters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) {
    score -= 25;
    penalties.push('all_caps');
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, grade: scoreToGrade(finalScore), penalties };
}

export function evaluateDescriptionQuality(raw?: string | null): FieldScoreResult {
  if (!raw || raw.trim().length === 0) {
    return { score: 0, grade: 'F', penalties: ['empty'] };
  }
  const clean = stripHtmlTags(raw);
  const lower = clean.toLowerCase();
  const penalties: string[] = [];

  // Regra da Seção 7: menos de 30 caracteres é obrigatoriamente F
  if (clean.length < 30) {
    return {
      score: Math.min(15, Math.floor(clean.length / 2)),
      grade: 'F',
      penalties: ['under_30_chars'],
    };
  }

  let score = clean.length >= 180 ? 92 : clean.length >= 80 ? 75 : 55;

  if (PLACEHOLDER_DESCRIPTIONS.some((p) => lower.includes(p))) {
    score -= 45;
    penalties.push('placeholder_phrase');
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, grade: scoreToGrade(finalScore), penalties };
}

export function evaluateBrandQuality(raw?: string | null): FieldScoreResult {
  if (!raw || raw.trim().length === 0) {
    return { score: 0, grade: 'F', penalties: ['empty'] };
  }
  const text = raw.trim();
  const lower = text.toLowerCase();
  const penalties: string[] = [];

  if (GENERIC_BRANDS.includes(lower)) {
    return { score: 10, grade: 'F', penalties: ['generic_brand'] };
  }

  let score = 90;
  if (text.length <= 2) {
    score -= 55;
    penalties.push('too_short_1_2_chars');
  } else if (text.length > 40) {
    score -= 50;
    penalties.push('too_long_gt_40');
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, grade: scoreToGrade(finalScore), penalties };
}

export function evaluateWeightQuality(weightKg?: number | null): FieldScoreResult {
  if (weightKg === null || weightKg === undefined || weightKg <= 0) {
    return { score: 0, grade: 'F', penalties: ['zero_or_empty'] };
  }
  const penalties: string[] = [];
  let score = 90;

  if (SENTINEL_WEIGHTS.has(Number(weightKg))) {
    score = 25;
    penalties.push('sentinel_weight');
  } else if (weightKg > 50) {
    score = 30;
    penalties.push('above_50kg');
  }

  return { score, grade: scoreToGrade(score), penalties };
}

export interface DimensionsTuple {
  width: number | null;
  height: number | null;
  depth: number | null;
}

export function evaluateDimensionsQuality(dims?: DimensionsTuple | null): FieldScoreResult {
  if (!dims) {
    return { score: 0, grade: 'F', penalties: ['empty'] };
  }
  const { width, height, depth } = dims;
  const filledCount = [width, height, depth].filter(
    (v) => v !== null && v !== undefined && v > 0
  ).length;

  if (filledCount === 0) {
    return { score: 0, grade: 'F', penalties: ['all_zero_or_null'] };
  }

  // Regra da Seção 7: as três medidas ou nenhuma
  if (filledCount < 3) {
    return { score: 15, grade: 'F', penalties: ['incomplete_dimensions'] };
  }

  if (width === 1 && height === 1 && depth === 1) {
    return { score: 20, grade: 'F', penalties: ['sentinel_1x1x1'] };
  }

  return { score: 90, grade: 'A', penalties: [] };
}

export function evaluateInternalCategoryQuality(raw?: string | null): FieldScoreResult {
  if (!raw || raw.trim().length === 0) {
    return { score: 0, grade: 'F', penalties: ['empty'] };
  }
  const lower = raw.trim().toLowerCase();
  if (GENERIC_CATEGORIES.includes(lower)) {
    return { score: 25, grade: 'D', penalties: ['generic_category'] };
  }
  return { score: 85, grade: 'A', penalties: [] };
}

/**
 * Árvore de decisão de enriquecimento (Seção 7):
 * A primeira regra que casar vence.
 * Garante que Grade A e Grade B no Bling NUNCA sofrem REPLACE.
 */
export function decideEnrichmentAction(
  blingEval: FieldScoreResult,
  externalEval: FieldScoreResult
): EnrichmentDecision {
  const delta = externalEval.score - blingEval.score;

  // 1. Externo grade F, ou score externo menor que 15: KEEP
  if (externalEval.grade === 'F' || externalEval.score < 15) {
    return 'KEEP';
  }

  // 2. Bling grade A: KEEP
  if (blingEval.grade === 'A') {
    return 'KEEP';
  }

  // 3. Bling grade F e externo pelo menos C: REPLACE
  if (
    blingEval.grade === 'F' &&
    (externalEval.grade === 'C' || externalEval.grade === 'B' || externalEval.grade === 'A')
  ) {
    return 'REPLACE';
  }

  // 4. Bling grade D, externo B ou A, delta de pelo menos 15: REPLACE
  if (
    blingEval.grade === 'D' &&
    (externalEval.grade === 'B' || externalEval.grade === 'A') &&
    delta >= 15
  ) {
    return 'REPLACE';
  }

  // 5. Delta de pelo menos 30 com Bling em C ou D: REPLACE
  if ((blingEval.grade === 'C' || blingEval.grade === 'D') && delta >= 30) {
    return 'REPLACE';
  }

  // 6. Delta 15–29, ou Bling grade B com qualquer delta positivo: SUGGEST
  if ((delta >= 15 && delta <= 29) || (blingEval.grade === 'B' && delta > 0)) {
    return 'SUGGEST';
  }

  // 7. Qualquer outro caso: KEEP
  return 'KEEP';
}

export function dimensionsAgreeWithin5Percent(
  a: DimensionsTuple,
  b: DimensionsTuple
): boolean {
  if (
    !a.width ||
    !a.height ||
    !a.depth ||
    !b.width ||
    !b.height ||
    !b.depth
  ) {
    return false;
  }
  const diffW = Math.abs(a.width - b.width) / Math.max(a.width, b.width);
  const diffH = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  const diffD = Math.abs(a.depth - b.depth) / Math.max(a.depth, b.depth);
  return diffW <= 0.05 && diffH <= 0.05 && diffD <= 0.05;
}

export interface ExternalChannelContentCandidate {
  platform: 'mercadolivre' | 'nuvemshop';
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  net_weight?: number | null;
  dimensions?: DimensionsTuple | null;
  /** Quando uma segunda fonte concordante within 5% é exigida ou informada para medidas */
  corroboratingDimensions?: DimensionsTuple | null;
}

export interface CqsFieldOutcome {
  field: 'brand' | 'net_weight' | 'dimensions' | 'channel_title' | 'channel_description';
  decision: EnrichmentDecision;
  effectiveDecisionAfterCap: EnrichmentDecision;
  appliedToBling: boolean;
  mode: 'shadow' | 'live';
  oldValue: string | null;
  newValue: string | null;
}

export interface ProductCqsRunReport {
  master_product_id: string;
  variant_id: string;
  platform: 'mercadolivre' | 'nuvemshop';
  skippedReason: 'kill_switch_active' | 'insufficient_link_confidence' | null;
  replacesAppliedInRun: number;
  outcomes: CqsFieldOutcome[];
}

/**
 * Executa o motor CQS para um produto/variante contra um candidato de canal vinculado (Seções 7 e 8.5):
 * - Exige vínculo confirmado (match_confidence >= 95).
 * - Respeita enrichment_controls (mode: shadow | live, kill_switch, max_replaces_per_run).
 * - Nome e descrição do Bling NUNCA são alterados; título e descrição do canal vão para channel_content_overrides.
 * - Marca, peso e dimensões passam pela árvore de decisão CQS (Grade A e Grade B nunca sofrem REPLACE).
 */
export async function evaluateAndApplyCqsEnrichment(input: {
  masterProductId: string;
  variantId: string;
  candidate: ExternalChannelContentCandidate;
  currentRunReplaceCounter?: { count: number };
  applyToBlingCallback?: (
    blingId: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
}): Promise<ProductCqsRunReport> {
  const runCounter = input.currentRunReplaceCounter ?? { count: 0 };

  return withTransaction(async (client: PoolClient) => {
    // 1. Verifica controles de enriquecimento da plataforma (mode, kill_switch, max_replaces_per_run)
    const ctrlRes = await client.query<{
      mode: 'shadow' | 'live';
      kill_switch: boolean;
      max_replaces_per_run: number;
    }>(
      `SELECT mode, kill_switch, max_replaces_per_run
       FROM enrichment_controls
       WHERE platform = $1`,
      [input.candidate.platform]
    );

    const ctrl = ctrlRes.rows[0] ?? {
      mode: 'shadow' as const,
      kill_switch: false,
      max_replaces_per_run: 25,
    };

    if (ctrl.kill_switch) {
      return {
        master_product_id: input.masterProductId,
        variant_id: input.variantId,
        platform: input.candidate.platform,
        skippedReason: 'kill_switch_active',
        replacesAppliedInRun: runCounter.count,
        outcomes: [],
      };
    }

    // 2. Verifica se há vínculo confirmado ou auto-vínculo >= 95 (Seção 8.1)
    const linkRes = await client.query<{
      match_confidence: number | null;
      confirmed_by: string | null;
    }>(
      `SELECT match_confidence, confirmed_by
       FROM platform_links
       WHERE master_product_id = $1 AND platform = $2`,
      [input.masterProductId, input.candidate.platform]
    );

    const link = linkRes.rows[0];
    const hasHighConfidenceLink =
      link &&
      (link.confirmed_by !== null || (link.match_confidence ?? 0) >= 95);

    if (!hasHighConfidenceLink) {
      return {
        master_product_id: input.masterProductId,
        variant_id: input.variantId,
        platform: input.candidate.platform,
        skippedReason: 'insufficient_link_confidence',
        replacesAppliedInRun: runCounter.count,
        outcomes: [],
      };
    }

    const prodRes = await client.query<{
      id: string;
      bling_id: string;
      name: string | null;
      description: string | null;
      brand: string | null;
      category: string | null;
    }>(
      `SELECT id, bling_id, name, description, brand, category
       FROM master_products
       WHERE id = $1
       FOR UPDATE`,
      [input.masterProductId]
    );
    const prod = prodRes.rows[0]!;

    const varRes = await client.query<{
      id: string;
      net_weight: string | number | null;
      width: string | number | null;
      height: string | number | null;
      depth: string | number | null;
    }>(
      `SELECT id, net_weight, width, height, depth
       FROM product_variants
       WHERE id = $1
       FOR UPDATE`,
      [input.variantId]
    );
    const variant = varRes.rows[0]!;

    const outcomes: CqsFieldOutcome[] = [];

    // 3. Título e descrição do canal -> gravam APENAS em channel_content_overrides (NUNCA em master_products.name / description)
    if (input.candidate.title) {
      const titleEval = evaluateNameQuality(input.candidate.title);
      if (titleEval.grade !== 'F' && titleEval.score >= 15) {
        await client.query(
          `INSERT INTO channel_content_overrides (
             master_product_id, variant_id, platform, field, value, source, status, updated_at
           ) VALUES ($1, $2, $3, 'title', $4, $5, $6, now())
           ON CONFLICT (master_product_id, variant_id, platform, field) DO UPDATE
             SET value = EXCLUDED.value,
                 source = EXCLUDED.source,
                 status = EXCLUDED.status,
                 updated_at = now()`,
          [
            input.masterProductId,
            input.variantId,
            input.candidate.platform,
            input.candidate.title.trim(),
            `cqs:${input.candidate.platform}`,
            ctrl.mode,
          ]
        );
      }
    }

    if (input.candidate.description) {
      const descEval = evaluateDescriptionQuality(input.candidate.description);
      if (descEval.grade !== 'F' && descEval.score >= 15) {
        await client.query(
          `INSERT INTO channel_content_overrides (
             master_product_id, variant_id, platform, field, value, source, status, updated_at
           ) VALUES ($1, $2, $3, 'description', $4, $5, $6, now())
           ON CONFLICT (master_product_id, variant_id, platform, field) DO UPDATE
             SET value = EXCLUDED.value,
                 source = EXCLUDED.source,
                 status = EXCLUDED.status,
                 updated_at = now()`,
          [
            input.masterProductId,
            input.variantId,
            input.candidate.platform,
            input.candidate.description.trim(),
            `cqs:${input.candidate.platform}`,
            ctrl.mode,
          ]
        );
      }
    }

    const blingPatchPayload: Record<string, unknown> = {};

    // 4. Avaliação de Marca (brand)
    if (input.candidate.brand !== undefined && input.candidate.brand !== null) {
      const blingBrandEval = evaluateBrandQuality(prod.brand);
      const extBrandEval = evaluateBrandQuality(input.candidate.brand);
      const rawDecision = decideEnrichmentAction(blingBrandEval, extBrandEval);

      // Matriz de fonte: empate de grade na marca fica no Bling e vira SUGGEST se não for KEEP
      let effectiveDecision = rawDecision;
      if (
        rawDecision === 'REPLACE' &&
        blingBrandEval.grade === extBrandEval.grade
      ) {
        effectiveDecision = 'SUGGEST';
      }

      if (
        effectiveDecision === 'REPLACE' &&
        ctrl.mode === 'live' &&
        runCounter.count >= ctrl.max_replaces_per_run
      ) {
        effectiveDecision = 'SUGGEST';
      }

      const appliedLive =
        effectiveDecision === 'REPLACE' && ctrl.mode === 'live';

      if (appliedLive) {
        runCounter.count += 1;
        await client.query(
          `UPDATE master_products SET brand = $2, updated_at = now() WHERE id = $1`,
          [input.masterProductId, input.candidate.brand.trim()]
        );
        blingPatchPayload.marca = input.candidate.brand.trim();
      } else if (effectiveDecision === 'SUGGEST') {
        await client.query(
          `INSERT INTO enrichment_suggestions (
             master_product_id, variant_id, source_platform, field_name,
             bling_value, bling_score, bling_grade,
             suggested_value, suggested_score, suggested_grade, status
           ) VALUES ($1, $2, $3, 'brand', $4, $5, $6, $7, $8, $9, 'pending')`,
          [
            input.masterProductId,
            input.variantId,
            input.candidate.platform,
            prod.brand,
            blingBrandEval.score,
            blingBrandEval.grade,
            input.candidate.brand.trim(),
            extBrandEval.score,
            extBrandEval.grade,
          ]
        );
      }

      await client.query(
        `INSERT INTO quality_history (
           master_product_id, variant_id, field_name, old_value, new_value,
           old_score, new_score, decision, source, mode, applied
         ) VALUES ($1, $2, 'brand', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.masterProductId,
          input.variantId,
          prod.brand,
          input.candidate.brand.trim(),
          blingBrandEval.score,
          extBrandEval.score,
          effectiveDecision,
          input.candidate.platform,
          ctrl.mode,
          appliedLive,
        ]
      );

      outcomes.push({
        field: 'brand',
        decision: rawDecision,
        effectiveDecisionAfterCap: effectiveDecision,
        appliedToBling: appliedLive,
        mode: ctrl.mode,
        oldValue: prod.brand,
        newValue: input.candidate.brand.trim(),
      });
    }

    // 5. Avaliação de Peso (net_weight)
    if (input.candidate.net_weight !== undefined && input.candidate.net_weight !== null) {
      const currentWeight =
        variant.net_weight !== null ? Number(variant.net_weight) : null;
      const blingWeightEval = evaluateWeightQuality(currentWeight);
      const extWeightEval = evaluateWeightQuality(input.candidate.net_weight);
      const rawDecision = decideEnrichmentAction(blingWeightEval, extWeightEval);

      let effectiveDecision = rawDecision;
      if (
        effectiveDecision === 'REPLACE' &&
        ctrl.mode === 'live' &&
        runCounter.count >= ctrl.max_replaces_per_run
      ) {
        effectiveDecision = 'SUGGEST';
      }

      const appliedLive =
        effectiveDecision === 'REPLACE' && ctrl.mode === 'live';

      if (appliedLive) {
        runCounter.count += 1;
        await client.query(
          `UPDATE product_variants SET net_weight = $2, updated_at = now() WHERE id = $1`,
          [input.variantId, input.candidate.net_weight]
        );
        blingPatchPayload.pesoLiquido = input.candidate.net_weight;
      } else if (effectiveDecision === 'SUGGEST') {
        await client.query(
          `INSERT INTO enrichment_suggestions (
             master_product_id, variant_id, source_platform, field_name,
             bling_value, bling_score, bling_grade,
             suggested_value, suggested_score, suggested_grade, status
           ) VALUES ($1, $2, $3, 'net_weight', $4, $5, $6, $7, $8, $9, 'pending')`,
          [
            input.masterProductId,
            input.variantId,
            input.candidate.platform,
            currentWeight !== null ? String(currentWeight) : null,
            blingWeightEval.score,
            blingWeightEval.grade,
            String(input.candidate.net_weight),
            extWeightEval.score,
            extWeightEval.grade,
          ]
        );
      }

      await client.query(
        `INSERT INTO quality_history (
           master_product_id, variant_id, field_name, old_value, new_value,
           old_score, new_score, decision, source, mode, applied
         ) VALUES ($1, $2, 'net_weight', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.masterProductId,
          input.variantId,
          currentWeight !== null ? String(currentWeight) : null,
          String(input.candidate.net_weight),
          blingWeightEval.score,
          extWeightEval.score,
          effectiveDecision,
          input.candidate.platform,
          ctrl.mode,
          appliedLive,
        ]
      );

      outcomes.push({
        field: 'net_weight',
        decision: rawDecision,
        effectiveDecisionAfterCap: effectiveDecision,
        appliedToBling: appliedLive,
        mode: ctrl.mode,
        oldValue: currentWeight !== null ? String(currentWeight) : null,
        newValue: String(input.candidate.net_weight),
      });
    }

    // 6. Avaliação de Dimensões (width, height, depth): exige as 3 medidas preenchidas e concordância dentro de 5%; senão SUGGEST
    if (input.candidate.dimensions) {
      const currentDims: DimensionsTuple = {
        width: variant.width !== null ? Number(variant.width) : null,
        height: variant.height !== null ? Number(variant.height) : null,
        depth: variant.depth !== null ? Number(variant.depth) : null,
      };
      const blingDimsEval = evaluateDimensionsQuality(currentDims);
      const extDimsEval = evaluateDimensionsQuality(input.candidate.dimensions);
      const rawDecision = decideEnrichmentAction(blingDimsEval, extDimsEval);

      const hasCorroboration5Pct =
        input.candidate.corroboratingDimensions !== undefined &&
        input.candidate.corroboratingDimensions !== null &&
        dimensionsAgreeWithin5Percent(
          input.candidate.dimensions,
          input.candidate.corroboratingDimensions
        );

      let effectiveDecision = rawDecision;
      if (rawDecision === 'REPLACE' && !hasCorroboration5Pct) {
        effectiveDecision = 'SUGGEST';
      }

      if (
        effectiveDecision === 'REPLACE' &&
        ctrl.mode === 'live' &&
        runCounter.count >= ctrl.max_replaces_per_run
      ) {
        effectiveDecision = 'SUGGEST';
      }

      const appliedLive =
        effectiveDecision === 'REPLACE' && ctrl.mode === 'live';
      const oldDimsStr =
        currentDims.width && currentDims.height && currentDims.depth
          ? `${currentDims.width}x${currentDims.height}x${currentDims.depth}`
          : null;
      const newDimsStr = `${input.candidate.dimensions.width}x${input.candidate.dimensions.height}x${input.candidate.dimensions.depth}`;

      if (appliedLive) {
        runCounter.count += 1;
        await client.query(
          `UPDATE product_variants
           SET width = $2, height = $3, depth = $4, updated_at = now()
           WHERE id = $1`,
          [
            input.variantId,
            input.candidate.dimensions.width,
            input.candidate.dimensions.height,
            input.candidate.dimensions.depth,
          ]
        );
        blingPatchPayload.dimensoes = {
          largura: input.candidate.dimensions.width,
          altura: input.candidate.dimensions.height,
          profundidade: input.candidate.dimensions.depth,
        };
      } else if (effectiveDecision === 'SUGGEST') {
        await client.query(
          `INSERT INTO enrichment_suggestions (
             master_product_id, variant_id, source_platform, field_name,
             bling_value, bling_score, bling_grade,
             suggested_value, suggested_score, suggested_grade, status
           ) VALUES ($1, $2, $3, 'dimensions', $4, $5, $6, $7, $8, $9, 'pending')`,
          [
            input.masterProductId,
            input.variantId,
            input.candidate.platform,
            oldDimsStr,
            blingDimsEval.score,
            blingDimsEval.grade,
            newDimsStr,
            extDimsEval.score,
            extDimsEval.grade,
          ]
        );
      }

      await client.query(
        `INSERT INTO quality_history (
           master_product_id, variant_id, field_name, old_value, new_value,
           old_score, new_score, decision, source, mode, applied
         ) VALUES ($1, $2, 'dimensions', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.masterProductId,
          input.variantId,
          oldDimsStr,
          newDimsStr,
          blingDimsEval.score,
          extDimsEval.score,
          effectiveDecision,
          input.candidate.platform,
          ctrl.mode,
          appliedLive,
        ]
      );

      outcomes.push({
        field: 'dimensions',
        decision: rawDecision,
        effectiveDecisionAfterCap: effectiveDecision,
        appliedToBling: appliedLive,
        mode: ctrl.mode,
        oldValue: oldDimsStr,
        newValue: newDimsStr,
      });
    }

    // Se houve REPLACE aplicado em modo live, registra hub_writes e dispara callback applyToBling
    const changedBlingKeys = Object.keys(blingPatchPayload);
    if (changedBlingKeys.length > 0) {
      await client.query(
        `INSERT INTO hub_writes (bling_id, request_id, changed_fields)
         VALUES ($1, $2, $3)`,
        [prod.bling_id, crypto.randomUUID(), changedBlingKeys]
      );
      if (input.applyToBlingCallback) {
        await input.applyToBlingCallback(prod.bling_id, blingPatchPayload);
      }
    }

    return {
      master_product_id: input.masterProductId,
      variant_id: input.variantId,
      platform: input.candidate.platform,
      skippedReason: null,
      replacesAppliedInRun: runCounter.count,
      outcomes,
    };
  });
}

/**
 * Reverte uma escrita aplicada pelo CQS a partir do quality_history (Seção 8.5):
 * - Linha de shadow (applied = false) NÃO é revertida, porque não chegou a ser escrita.
 * - Lê old_value, grava de volta no banco e em hub_writes, e abre outra linha em quality_history com source = 'revert' e decision = 'REVERT'.
 */
export async function revertCqsQualityHistoryChange(input: {
  qualityHistoryId: string;
  actorUserId: string;
}): Promise<{
  revertedField: string;
  restoredValue: string | null;
}> {
  return withTransaction(async (client: PoolClient) => {
    const qhRes = await client.query<{
      id: string;
      master_product_id: string;
      variant_id: string | null;
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      old_score: number | null;
      new_score: number | null;
      mode: 'shadow' | 'live';
      applied: boolean;
    }>(
      `SELECT id, master_product_id, variant_id, field_name, old_value, new_value,
              old_score, new_score, mode, applied
       FROM quality_history
       WHERE id = $1`,
      [input.qualityHistoryId]
    );

    const row = qhRes.rows[0];
    if (!row) {
      throw new Error(`quality_history ${input.qualityHistoryId} não encontrado`);
    }

    if (!row.applied || row.mode === 'shadow') {
      throw new Error('Linha de shadow (applied = false) não pode ser revertida porque não foi escrita no Bling');
    }

    const prodRes = await client.query<{ bling_id: string }>(
      `SELECT bling_id FROM master_products WHERE id = $1`,
      [row.master_product_id]
    );
    const blingId = prodRes.rows[0]!.bling_id;

    if (row.field_name === 'brand') {
      await client.query(
        `UPDATE master_products SET brand = $2, updated_at = now() WHERE id = $1`,
        [row.master_product_id, row.old_value]
      );
    } else if (row.field_name === 'net_weight' && row.variant_id) {
      const numVal = row.old_value !== null ? Number(row.old_value) : null;
      await client.query(
        `UPDATE product_variants SET net_weight = $2, updated_at = now() WHERE id = $1`,
        [row.variant_id, numVal]
      );
    } else if (row.field_name === 'dimensions' && row.variant_id) {
      const parts = row.old_value ? row.old_value.split('x').map(Number) : [null, null, null];
      await client.query(
        `UPDATE product_variants
         SET width = $2, height = $3, depth = $4, updated_at = now()
         WHERE id = $1`,
        [row.variant_id, parts[0] ?? null, parts[1] ?? null, parts[2] ?? null]
      );
    }

    await client.query(
      `INSERT INTO hub_writes (bling_id, request_id, changed_fields)
       VALUES ($1, $2, $3)`,
      [blingId, crypto.randomUUID(), [row.field_name]]
    );

    await client.query(
      `INSERT INTO quality_history (
         master_product_id, variant_id, field_name, old_value, new_value,
         old_score, new_score, decision, source, mode, applied, actor_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'REVERT', 'revert', 'live', true, $8)`,
      [
        row.master_product_id,
        row.variant_id,
        row.field_name,
        row.new_value,
        row.old_value,
        row.new_score,
        row.old_score,
        input.actorUserId,
      ]
    );

    return {
      revertedField: row.field_name,
      restoredValue: row.old_value,
    };
  });
}
