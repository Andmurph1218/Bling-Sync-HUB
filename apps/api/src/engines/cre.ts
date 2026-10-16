/**
 * Motor CRE — Channel Readiness Engine (Seções 8.7, 8.8, 9.5, 9.6 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Três scores de 0 a 100 por variante:
 *   1. Score Bling (fiscal 45, operacional 35, identificação 20). Publicar conteúdo: 70. Premium: 90.
 *   2. Score Mercado Livre (título 25, conteúdo 20, imagens 20, atributos 20, logística 15). Publicar conteúdo: 50. Premium: 75.
 *      CREATE exige categoria verificada e atributos obrigatórios em product_category_mappings.
 *   3. Score Nuvemshop (conteúdo 35, SEO 25, imagens 20, conversão 20). Publicar conteúdo: 45. Premium: 85.
 *      SEO usa keywords como tags, meta_description e seo_slug.
 * - O KPI do produto pai é o menor score entre os canais da pior variante ativa.
 * - Cada cálculo grava bloqueios e as três melhorias de maior ganho em channel_readiness_scores e channel_readiness_history.
 * - Regra de ouro (Seções 8.7 e 8.8): O score NÃO bloqueia STOCK_PRICE. Os passos 'stock', 'pause' e 'price'
 *   de anúncio já publicado NUNCA leem nem dependem do score do CRE.
 */

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import {
  evaluateBrandQuality,
  evaluateDescriptionQuality,
  evaluateDimensionsQuality,
  evaluateNameQuality,
  evaluateWeightQuality,
} from './cqs.js';

export const CRE_THRESHOLDS = {
  bling: { publishContent: 70, premium: 90 },
  mercadolivre: { publishContent: 50, premium: 75 },
  nuvemshop: { publishContent: 45, premium: 85 },
} as const;

export interface ReadinessImprovement {
  channel: 'bling' | 'mercadolivre' | 'nuvemshop';
  code: string;
  description: string;
  potentialGain: number;
}

export interface VariantReadinessResult {
  variant_id: string;
  master_product_id: string;
  score_bling: number;
  score_ml: number;
  score_ns: number;
  publishable_bling: boolean;
  publishable_ml: boolean;
  publishable_ns: boolean;
  premium_bling: boolean;
  premium_ml: boolean;
  premium_ns: boolean;
  can_create_ml: boolean;
  can_create_ns: boolean;
  blockers: string[];
  top_improvements: ReadinessImprovement[];
}

export interface ProductReadinessReport {
  master_product_id: string;
  /** Menor score entre os 3 canais da pior variante não descontinuada */
  product_kpi_worst_score: number;
  variants: VariantReadinessResult[];
}

export type PushStepType =
  | 'stock'
  | 'pause'
  | 'price'
  | 'description'
  | 'pictures'
  | 'product'
  | 'images'
  | 'measures'
  | 'CREATE';

export interface StepGateEvaluation {
  allowed: boolean;
  blockReason: 'ncm' | 'ean' | 'score' | 'unlinked' | 'price_zero' | null;
  readScoreTable: boolean;
}

/**
 * Calcula e persiste os 3 scores do CRE para todas as variantes ativas de um master_product (Seção 8.7).
 */
export async function calculateProductReadinessCre(
  masterProductId: string
): Promise<ProductReadinessReport> {
  return withTransaction(async (client: PoolClient) => {
    const prodRes = await client.query<{
      id: string;
      name: string | null;
      description: string | null;
      brand: string | null;
      ncm: string | null;
      ncm_status: string;
      ncm_fiscal_risk: boolean;
      meta_description: string | null;
      seo_slug: string | null;
      keywords: string[] | null;
    }>(
      `SELECT id, name, description, brand, ncm, ncm_status, ncm_fiscal_risk,
              meta_description, seo_slug, keywords
       FROM master_products
       WHERE id = $1`,
      [masterProductId]
    );

    const prod = prodRes.rows[0];
    if (!prod) {
      throw new Error(`master_product ${masterProductId} não encontrado`);
    }

    const varsRes = await client.query<{
      id: string;
      bling_sku: string;
      price: string | number | null;
      net_weight: string | number | null;
      width: string | number | null;
      height: string | number | null;
      depth: string | number | null;
      ean: string | null;
      ean_status: string;
      fiscal_risk_flag: boolean;
      variant_status: 'active' | 'inactive' | 'discontinued';
    }>(
      `SELECT id, bling_sku, price, net_weight, width, height, depth,
              ean, ean_status, fiscal_risk_flag, variant_status
       FROM product_variants
       WHERE master_product_id = $1 AND variant_status <> 'discontinued'
       ORDER BY created_at ASC`,
      [masterProductId]
    );

    const imagesRes = await client.query<{
      id: string;
      position_bling: number | null;
      position_ml: number | null;
      position_ns: number | null;
      is_cover_eligible: boolean;
      quality_score: number;
    }>(
      `SELECT id, position_bling, position_ml, position_ns, is_cover_eligible, quality_score
       FROM product_images
       WHERE master_product_id = $1`,
      [masterProductId]
    );

    const catMapRes = await client.query<{
      platform: 'mercadolivre' | 'nuvemshop';
      channel_category_id: string;
      required_attributes: unknown[];
      is_verified: boolean;
    }>(
      `SELECT platform, channel_category_id, required_attributes, is_verified
       FROM product_category_mappings
       WHERE master_product_id = $1`,
      [masterProductId]
    );

    const mlCatMap = catMapRes.rows.find((c) => c.platform === 'mercadolivre') ?? null;

    const overridesRes = await client.query<{
      variant_id: string;
      platform: 'mercadolivre' | 'nuvemshop';
      field: 'title' | 'description';
      value: string;
    }>(
      `SELECT variant_id, platform, field, value
       FROM channel_content_overrides
       WHERE master_product_id = $1`,
      [masterProductId]
    );

    const variantResults: VariantReadinessResult[] = [];

    for (const v of varsRes.rows) {
      const improvements: ReadinessImprovement[] = [];
      const blockers: string[] = [];

      const priceNum = v.price !== null ? Number(v.price) : 0;
      const weightNum = v.net_weight !== null ? Number(v.net_weight) : null;
      const dims = {
        width: v.width !== null ? Number(v.width) : null,
        height: v.height !== null ? Number(v.height) : null,
        depth: v.depth !== null ? Number(v.depth) : null,
      };

      const ncmOk = prod.ncm_status === 'valid' && !prod.ncm_fiscal_risk;
      const eanOk = v.ean_status === 'valid' && !v.fiscal_risk_flag;
      const priceOk = priceNum > 0;
      const weightEval = evaluateWeightQuality(weightNum);
      const dimsEval = evaluateDimensionsQuality(dims);
      const nameEval = evaluateNameQuality(prod.name);
      const brandEval = evaluateBrandQuality(prod.brand);

      if (!ncmOk) blockers.push('ncm_invalid_or_risk');
      if (!eanOk) blockers.push('ean_invalid_or_risk');
      if (!priceOk) blockers.push('price_zero_or_negative');

      // =======================================================================
      // 1. SCORE BLING (Fiscal 45 + Operacional 35 + Identificação 20 = 100)
      // =======================================================================
      let blingFiscal = 0;
      if (ncmOk) {
        blingFiscal += 25;
      } else {
        improvements.push({
          channel: 'bling',
          code: 'fix_ncm',
          description: 'Validar e aprovar NCM de 8 dígitos no cadastro fiscal do Bling',
          potentialGain: 25,
        });
      }

      if (eanOk) {
        blingFiscal += 20;
      } else {
        improvements.push({
          channel: 'bling',
          code: 'fix_ean',
          description: 'Regularizar EAN/GTIN com dígito verificador GS1 válido e sem duplicidade',
          potentialGain: 20,
        });
      }

      let blingOperational = 0;
      if (priceOk) {
        blingOperational += 15;
      } else {
        improvements.push({
          channel: 'bling',
          code: 'fix_price',
          description: 'Definir preço de venda maior que zero para a variante',
          potentialGain: 15,
        });
      }

      if (weightEval.grade === 'A' || weightEval.grade === 'B') {
        blingOperational += 10;
      } else {
        improvements.push({
          channel: 'bling',
          code: 'fix_weight',
          description: 'Preencher peso líquido real (sem valores sentinela)',
          potentialGain: 10,
        });
      }

      if (dimsEval.grade === 'A') {
        blingOperational += 10;
      } else {
        improvements.push({
          channel: 'bling',
          code: 'fix_dimensions',
          description: 'Preencher largura, altura e profundidade completas da variante',
          potentialGain: 10,
        });
      }

      let blingIdentification = 0;
      if (v.bling_sku && v.bling_sku.trim().length >= 3) {
        blingIdentification += 5;
      }
      const namePtsBling = Math.round((nameEval.score / 100) * 10);
      blingIdentification += namePtsBling;
      if (namePtsBling < 10) {
        improvements.push({
          channel: 'bling',
          code: 'improve_bling_name',
          description: 'Melhorar nome do produto no Bling',
          potentialGain: 10 - namePtsBling,
        });
      }

      const brandPtsBling = brandEval.grade === 'A' ? 5 : 0;
      blingIdentification += brandPtsBling;
      if (brandPtsBling < 5) {
        improvements.push({
          channel: 'bling',
          code: 'fill_brand',
          description: 'Preencher marca oficial do produto no Bling',
          potentialGain: 5,
        });
      }

      const scoreBling = Math.min(
        100,
        blingFiscal + blingOperational + blingIdentification
      );

      // =======================================================================
      // 2. SCORE MERCADO LIVRE (Título 25 + Conteúdo 20 + Imagens 20 + Atributos 20 + Logística 15 = 100)
      // =======================================================================
      const mlTitleOverride =
        overridesRes.rows.find(
          (o) =>
            o.variant_id === v.id &&
            o.platform === 'mercadolivre' &&
            o.field === 'title'
        )?.value ?? prod.name;
      const mlDescOverride =
        overridesRes.rows.find(
          (o) =>
            o.variant_id === v.id &&
            o.platform === 'mercadolivre' &&
            o.field === 'description'
        )?.value ?? prod.description;

      const mlTitleEval = evaluateNameQuality(mlTitleOverride);
      const mlDescEval = evaluateDescriptionQuality(mlDescOverride);

      const mlTitlePts = Math.round((mlTitleEval.score / 100) * 25);
      if (mlTitlePts < 25) {
        improvements.push({
          channel: 'mercadolivre',
          code: 'improve_ml_title',
          description: 'Otimizar título do anúncio no Mercado Livre',
          potentialGain: 25 - mlTitlePts,
        });
      }

      const mlContentPts = Math.round((mlDescEval.score / 100) * 20);
      if (mlContentPts < 20) {
        improvements.push({
          channel: 'mercadolivre',
          code: 'improve_ml_description',
          description: 'Expandir descrição técnica para o Mercado Livre (>= 180 caracteres)',
          potentialGain: 20 - mlContentPts,
        });
      }

      const mlImages = imagesRes.rows.filter((img) => img.position_ml !== null);
      const hasMlCover = mlImages.some((img) => img.is_cover_eligible);
      let mlImagePts = 0;
      if (hasMlCover && mlImages.length >= 3) {
        mlImagePts = 20;
      } else if (hasMlCover && mlImages.length >= 1) {
        mlImagePts = 14;
      } else if (mlImages.length >= 1) {
        mlImagePts = 6;
      }
      if (mlImagePts < 20) {
        improvements.push({
          channel: 'mercadolivre',
          code: 'add_ml_images_cover',
          description: 'Adicionar capa elegível (>= 500x500, score >= 55) e ao menos 3 fotos no ML',
          potentialGain: 20 - mlImagePts,
        });
      }

      let mlAttrPts = 0;
      const mlCategoryVerified = Boolean(
        mlCatMap && mlCatMap.is_verified && mlCatMap.channel_category_id
      );
      if (mlCategoryVerified) {
        mlAttrPts = 20;
      } else {
        blockers.push('ml_category_not_verified');
        improvements.push({
          channel: 'mercadolivre',
          code: 'verify_ml_category',
          description: 'Mapear e verificar categoria e ficha técnica obrigatória do Mercado Livre',
          potentialGain: 20,
        });
      }

      const mlLogisticsPts =
        weightEval.grade === 'A' && dimsEval.grade === 'A' ? 15 : 0;
      if (mlLogisticsPts < 15) {
        improvements.push({
          channel: 'mercadolivre',
          code: 'complete_ml_logistics',
          description: 'Completar peso e 3 dimensões para logística Mercado Envios',
          potentialGain: 15,
        });
      }

      const scoreMl = Math.min(
        100,
        mlTitlePts + mlContentPts + mlImagePts + mlAttrPts + mlLogisticsPts
      );

      // =======================================================================
      // 3. SCORE NUVEMSHOP (Conteúdo 35 + SEO 25 + Imagens 20 + Conversão 20 = 100)
      // =======================================================================
      const nsTitleOverride =
        overridesRes.rows.find(
          (o) =>
            o.variant_id === v.id &&
            o.platform === 'nuvemshop' &&
            o.field === 'title'
        )?.value ?? prod.name;
      const nsDescOverride =
        overridesRes.rows.find(
          (o) =>
            o.variant_id === v.id &&
            o.platform === 'nuvemshop' &&
            o.field === 'description'
        )?.value ?? prod.description;

      const nsTitleEval = evaluateNameQuality(nsTitleOverride);
      const nsDescEval = evaluateDescriptionQuality(nsDescOverride);
      const nsContentPts =
        Math.round((nsTitleEval.score / 100) * 15) +
        Math.round((nsDescEval.score / 100) * 20);
      if (nsContentPts < 35) {
        improvements.push({
          channel: 'nuvemshop',
          code: 'improve_ns_content',
          description: 'Melhorar título e descrição rica para a Nuvemshop',
          potentialGain: 35 - nsContentPts,
        });
      }

      let nsSeoPts = 0;
      const keywordsCount = prod.keywords?.length ?? 0;
      if (keywordsCount >= 3) nsSeoPts += 10;
      else if (keywordsCount >= 1) nsSeoPts += 5;

      if (prod.meta_description && prod.meta_description.trim().length >= 30) {
        nsSeoPts += 8;
      }
      if (prod.seo_slug && prod.seo_slug.trim().length >= 5) {
        nsSeoPts += 7;
      }
      if (nsSeoPts < 25) {
        improvements.push({
          channel: 'nuvemshop',
          code: 'complete_ns_seo',
          description: 'Preencher keywords (tags), meta_description e seo_slug para SEO na Nuvemshop',
          potentialGain: 25 - nsSeoPts,
        });
      }

      const nsImages = imagesRes.rows.filter((img) => img.position_ns !== null);
      const nsImagePts =
        nsImages.length >= 3 ? 20 : nsImages.length >= 1 ? 12 : 0;
      if (nsImagePts < 20) {
        improvements.push({
          channel: 'nuvemshop',
          code: 'add_ns_images',
          description: 'Adicionar ao menos 3 imagens válidas (>= 200x200) para a Nuvemshop',
          potentialGain: 20 - nsImagePts,
        });
      }

      let nsConversionPts = 0;
      if (brandEval.grade === 'A') nsConversionPts += 7;
      if (priceOk) nsConversionPts += 7;
      if (weightEval.grade === 'A' && dimsEval.grade === 'A') {
        nsConversionPts += 6;
      }

      const scoreNs = Math.min(
        100,
        nsContentPts + nsSeoPts + nsImagePts + nsConversionPts
      );

      // Ordena melhorias pelo maior ganho potencial e seleciona as Top 3 (Seção 8.7)
      improvements.sort((a, b) => b.potentialGain - a.potentialGain);
      const top3Improvements = improvements.slice(0, 3);

      const noFiscalOrPriceBlock = ncmOk && eanOk && priceOk;
      const publishableBling =
        noFiscalOrPriceBlock && scoreBling >= CRE_THRESHOLDS.bling.publishContent;
      const publishableMl =
        noFiscalOrPriceBlock && scoreMl >= CRE_THRESHOLDS.mercadolivre.publishContent;
      const publishableNs =
        noFiscalOrPriceBlock && scoreNs >= CRE_THRESHOLDS.nuvemshop.publishContent;

      if (scoreMl < CRE_THRESHOLDS.mercadolivre.publishContent) {
        blockers.push('score_ml_below_50');
      }
      if (scoreNs < CRE_THRESHOLDS.nuvemshop.publishContent) {
        blockers.push('score_ns_below_45');
      }

      await client.query(
        `INSERT INTO channel_readiness_scores (
           master_product_id, variant_id, score_bling, score_ml, score_ns,
           publishable_bling, publishable_ml, publishable_ns,
           blockers, top_improvements, calculated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (variant_id) DO UPDATE
           SET score_bling = EXCLUDED.score_bling,
               score_ml = EXCLUDED.score_ml,
               score_ns = EXCLUDED.score_ns,
               publishable_bling = EXCLUDED.publishable_bling,
               publishable_ml = EXCLUDED.publishable_ml,
               publishable_ns = EXCLUDED.publishable_ns,
               blockers = EXCLUDED.blockers,
               top_improvements = EXCLUDED.top_improvements,
               calculated_at = now()`,
        [
          masterProductId,
          v.id,
          scoreBling,
          scoreMl,
          scoreNs,
          publishableBling,
          publishableMl,
          publishableNs,
          JSON.stringify(blockers),
          JSON.stringify(top3Improvements),
        ]
      );

      await client.query(
        `INSERT INTO channel_readiness_history (
           master_product_id, variant_id, score_bling, score_ml, score_ns,
           blockers, top_improvements
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          masterProductId,
          v.id,
          scoreBling,
          scoreMl,
          scoreNs,
          JSON.stringify(blockers),
          JSON.stringify(top3Improvements),
        ]
      );

      variantResults.push({
        variant_id: v.id,
        master_product_id: masterProductId,
        score_bling: scoreBling,
        score_ml: scoreMl,
        score_ns: scoreNs,
        publishable_bling: publishableBling,
        publishable_ml: publishableMl,
        publishable_ns: publishableNs,
        premium_bling: scoreBling >= CRE_THRESHOLDS.bling.premium,
        premium_ml: scoreMl >= CRE_THRESHOLDS.mercadolivre.premium,
        premium_ns: scoreNs >= CRE_THRESHOLDS.nuvemshop.premium,
        can_create_ml: publishableMl && mlCategoryVerified,
        can_create_ns: publishableNs,
        blockers,
        top_improvements: top3Improvements,
      });
    }

    // KPI do produto é o menor score entre os canais da pior variante ativa (Seção 8.7)
    const productKpiWorstScore =
      variantResults.length > 0
        ? Math.min(
            ...variantResults.map((vr) =>
              Math.min(vr.score_bling, vr.score_ml, vr.score_ns)
            )
          )
        : 0;

    return {
      master_product_id: masterProductId,
      product_kpi_worst_score: productKpiWorstScore,
      variants: variantResults,
    };
  });
}

/**
 * Portão de prontidão por passo de push (Seções 8.7 e 8.8 — "Estoque não lê o score"):
 * - Em 'stock' e 'pause': NUNCA consulta NCM, EAN, preço nem channel_readiness_scores (readScoreTable = false).
 * - Em 'price' (anúncio já publicado): verifica apenas se price > 0; NUNCA consulta channel_readiness_scores (readScoreTable = false).
 * - Em passos de CONTENT ('description', 'pictures', 'product', 'images', 'measures') e 'CREATE':
 *   verifica vínculo, NCM, EAN, preço (exceto 'measures' que não leva preço) e o score do CRE em channel_readiness_scores.
 */
export async function checkStepReadinessGate(input: {
  variantId: string;
  platform: 'mercadolivre' | 'nuvemshop';
  step: PushStepType;
  effectivePrice?: number | null;
  onScoreTableReadSpy?: () => void;
}): Promise<StepGateEvaluation> {
  // Regra crítica da Fase 7 e Seção 8.8: 'stock' e 'pause' seguem SEMPRE e não leem nenhuma tabela de score/fiscal
  if (input.step === 'stock' || input.step === 'pause') {
    return {
      allowed: true,
      blockReason: null,
      readScoreTable: false,
    };
  }

  // Passo 'price' de anúncio já publicado só bloqueia se preço <= 0; também NÃO lê score nem NCM/EAN
  if (input.step === 'price') {
    if (input.effectivePrice === undefined || input.effectivePrice === null || input.effectivePrice <= 0) {
      return {
        allowed: false,
        blockReason: 'price_zero',
        readScoreTable: false,
      };
    }
    return {
      allowed: true,
      blockReason: null,
      readScoreTable: false,
    };
  }

  // Passos de CONTENT e CREATE consultam vínculo, fiscal e channel_readiness_scores
  return withTransaction(async (client: PoolClient) => {
    const varRes = await client.query<{
      id: string;
      master_product_id: string;
      price: string | number | null;
      ean_status: string;
      fiscal_risk_flag: boolean;
    }>(
      `SELECT id, master_product_id, price, ean_status, fiscal_risk_flag
       FROM product_variants
       WHERE id = $1`,
      [input.variantId]
    );
    const v = varRes.rows[0];
    if (!v) {
      throw new Error(`product_variant ${input.variantId} não encontrada`);
    }

    const prodRes = await client.query<{
      ncm_status: string;
      ncm_fiscal_risk: boolean;
    }>(
      `SELECT ncm_status, ncm_fiscal_risk FROM master_products WHERE id = $1`,
      [v.master_product_id]
    );
    const prod = prodRes.rows[0]!;

    // 1. Verifica vínculo confirmado no canal
    const linkRes = await client.query<{
      match_confidence: number | null;
      confirmed_by: string | null;
    }>(
      `SELECT match_confidence, confirmed_by
       FROM platform_links
       WHERE master_product_id = $1 AND platform = $2`,
      [v.master_product_id, input.platform]
    );
    const link = linkRes.rows[0];
    const isConfirmedLink =
      Boolean(link) &&
      (link!.confirmed_by !== null || (link!.match_confidence ?? 0) >= 95);

    if (!isConfirmedLink) {
      return { allowed: false, blockReason: 'unlinked', readScoreTable: false };
    }

    // 2. Verifica NCM e EAN
    if (prod.ncm_fiscal_risk || prod.ncm_status !== 'valid') {
      return { allowed: false, blockReason: 'ncm', readScoreTable: false };
    }
    if (v.fiscal_risk_flag || v.ean_status !== 'valid') {
      return { allowed: false, blockReason: 'ean', readScoreTable: false };
    }

    // 3. Verifica preço zero (exceto 'measures' na Nuvemshop, que não leva preço — Seção 8.8)
    const priceToValidate =
      input.effectivePrice !== undefined
        ? input.effectivePrice
        : v.price !== null
        ? Number(v.price)
        : 0;

    if (input.step !== 'measures' && (!priceToValidate || priceToValidate <= 0)) {
      return { allowed: false, blockReason: 'price_zero', readScoreTable: false };
    }

    // 4. Consulta o score em channel_readiness_scores
    if (input.onScoreTableReadSpy) {
      input.onScoreTableReadSpy();
    }

    const scoreRes = await client.query<{
      score_bling: number;
      score_ml: number;
      score_ns: number;
    }>(
      `SELECT score_bling, score_ml, score_ns
       FROM channel_readiness_scores
       WHERE variant_id = $1`,
      [input.variantId]
    );

    const scoreRow = scoreRes.rows[0];
    if (!scoreRow) {
      return { allowed: false, blockReason: 'score', readScoreTable: true };
    }

    const channelScore =
      input.platform === 'mercadolivre' ? scoreRow.score_ml : scoreRow.score_ns;
    const channelThreshold =
      input.platform === 'mercadolivre'
        ? CRE_THRESHOLDS.mercadolivre.publishContent
        : CRE_THRESHOLDS.nuvemshop.publishContent;

    if (channelScore < channelThreshold) {
      return { allowed: false, blockReason: 'score', readScoreTable: true };
    }

    if (input.step === 'CREATE' && input.platform === 'mercadolivre') {
      const catCheck = await client.query<{ is_verified: boolean }>(
        `SELECT is_verified
         FROM product_category_mappings
         WHERE master_product_id = $1 AND platform = 'mercadolivre'`,
        [v.master_product_id]
      );
      if (!catCheck.rows[0]?.is_verified) {
        return { allowed: false, blockReason: 'score', readScoreTable: true };
      }
    }

    return {
      allowed: true,
      blockReason: null,
      readScoreTable: true,
    };
  });
}
