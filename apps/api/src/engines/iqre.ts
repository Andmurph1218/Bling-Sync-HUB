/**
 * Motor IQRE — Image Quality & Rights Engine (Seções 7, 8.6, 9.5 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Imagem é entidade em product_images, nunca coluna JSON em master_products.
 * - O enriquecimento/sync NÃO baixa nem processa imagens na mesma chamada: apenas grava em
 *   image_processing_queue (stage = 'queued') com UNIQUE (master_product_id, url_normalized).
 * - O worker reserva lotes de stage = 'queued', available_at <= now() e locked_at IS NULL,
 *   ordenados por available_at, id.
 * - Download aceita apenas hosts oficiais do Bling, Mercado Livre e Nuvemshop, com timeout e tamanho máximo.
 * - Falha incrementa attempts; abaixo de max_attempts (4) volta a 'queued' com atraso; na 4ª falha fica 'failed'
 *   para replay e NÃO bloqueia o fechamento das demais imagens do produto.
 * - Quando nenhuma imagem do produto resta em 'queued', iqre.finalize deduplica APENAS dentro do mesmo
 *   master_product usando Average Hash 8x8 (64 bits, distância de Hamming <= 5), mantendo a maior resolução.
 * - Hash parecido entre produtos diferentes NUNCA deduplica (no máximo abre revisão cross_product_similarity).
 * - Direitos: seller nosso -> owned; seller diferente -> third_party_risk + image_rights_review_queue (não publica sem aprovação);
 *   suspeita de marca d'água -> watermark_suspect + image_rights_review_queue.
 * - Score (0..100): resolução 40, fonte 25, formato 15, direitos 20.
 * - Capa exige score >= 55, direitos != third_party_risk/rejected, sem marca d'água pendente e >= 500x500.
 */

import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';

const ALLOWED_HOST_SUFFIXES = [
  'bling.com.br',
  'mlstatic.com',
  'mercadolivre.com.br',
  'mercadolibre.com',
  'mitiendanube.com',
  'nuvemshop.com.br',
  'tiendanube.com',
];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export function normalizeImageUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  parsed.hash = '';
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.searchParams.sort();
  return parsed.toString();
}

export function isAllowedImageHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

/**
 * Calcula Average Hash 8x8 (64 bits = 16 caracteres hex) a partir de uma matriz 8x8 de luminância (0..255)
 * ou de um buffer de pixels / imagem.
 */
export function computeAverageHash64FromGrid(luminance64: number[]): string {
  if (luminance64.length !== 64) {
    throw new Error('Matriz de luminância para Average Hash 8x8 deve conter exatamente 64 valores');
  }
  const sum = luminance64.reduce((acc, v) => acc + v, 0);
  const avg = sum / 64;

  let bits = 0n;
  for (let i = 0; i < 64; i++) {
    bits = (bits << 1n) | (luminance64[i]! >= avg ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * Distância de Hamming entre dois Average Hashes de 64 bits (16 chars hex).
 */
export function hammingDistance64(hashA: string, hashB: string): number {
  if (hashA.length !== 16 || hashB.length !== 16) {
    throw new Error('Hashes para distância de Hamming devem ter 16 caracteres hex (64 bits)');
  }
  let xor = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

export function computeImageQualityScore(input: {
  width: number;
  height: number;
  sourcePlatform: 'bling' | 'mercadolivre' | 'nuvemshop';
  format: string;
  rightsStatus: 'owned' | 'third_party_risk' | 'watermark_suspect' | 'approved' | 'rejected';
}): number {
  const minDim = Math.min(input.width, input.height);
  let resPoints = 4;
  if (minDim >= 1200) resPoints = 40;
  else if (minDim >= 800) resPoints = 32;
  else if (minDim >= 500) resPoints = 24;
  else if (minDim >= 200) resPoints = 12;

  let sourcePoints = 20;
  if (input.sourcePlatform === 'bling') sourcePoints = 25;
  else if (input.sourcePlatform === 'nuvemshop') sourcePoints = 22;

  const fmt = input.format.toLowerCase();
  let formatPoints = 5;
  if (fmt === 'webp' || fmt === 'png') formatPoints = 15;
  else if (fmt === 'jpeg' || fmt === 'jpg') formatPoints = 13;

  let rightsPoints = 0;
  if (input.rightsStatus === 'owned' || input.rightsStatus === 'approved') {
    rightsPoints = 20;
  } else if (input.rightsStatus === 'watermark_suspect') {
    rightsPoints = 8;
  }

  return resPoints + sourcePoints + formatPoints + rightsPoints;
}

export function isEligibleForCover(input: {
  qualityScore: number;
  rightsStatus: 'owned' | 'third_party_risk' | 'watermark_suspect' | 'approved' | 'rejected';
  width: number;
  height: number;
}): boolean {
  if (input.qualityScore < 55) return false;
  if (
    input.rightsStatus === 'third_party_risk' ||
    input.rightsStatus === 'rejected' ||
    input.rightsStatus === 'watermark_suspect'
  ) {
    return false;
  }
  if (input.width < 500 || input.height < 500) return false;
  return true;
}

export interface EnqueueImageCandidate {
  source_url: string;
  source_platform: 'bling' | 'mercadolivre' | 'nuvemshop';
  variant_id?: string | null;
}

/**
 * Etapa 1 do IQRE: chamada durante a sync/enriquecimento do produto.
 * Apenas grava na image_processing_queue (sem fazer download HTTP na sync).
 */
export async function enqueueProductImagesForSync(
  masterProductId: string,
  candidates: EnqueueImageCandidate[]
): Promise<{ enqueuedCount: number; skippedDuplicatesCount: number }> {
  return withTransaction(async (client: PoolClient) => {
    let enqueuedCount = 0;
    let skippedDuplicatesCount = 0;

    for (const cand of candidates) {
      const urlNormalized = normalizeImageUrl(cand.source_url);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM image_processing_queue
         WHERE master_product_id = $1 AND url_normalized = $2`,
        [masterProductId, urlNormalized]
      );

      if (existing.rowCount && existing.rowCount > 0) {
        skippedDuplicatesCount += 1;
        continue;
      }

      await client.query(
        `INSERT INTO image_processing_queue (
           master_product_id, variant_id, source_url, url_normalized,
           source_platform, stage, attempts, max_attempts, available_at
         ) VALUES ($1, $2, $3, $4, $5, 'queued', 0, 4, now())`,
        [
          masterProductId,
          cand.variant_id ?? null,
          cand.source_url,
          urlNormalized,
          cand.source_platform,
        ]
      );
      enqueuedCount += 1;
    }

    return { enqueuedCount, skippedDuplicatesCount };
  });
}

export interface FetchedImageProbe {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  averageHash: string;
  sellerId?: string | null;
  watermarkSuspect?: boolean;
}

export type ImageFetcherFn = (sourceUrl: string) => Promise<FetchedImageProbe>;

/**
 * Etapa 2 do IQRE: Worker consome a fila reservando itens com stage = 'queued',
 * available_at <= now() e locked_at IS NULL (usando o índice image_processing_queue_claim).
 */
export async function processQueuedImagesWorkerBatch(options: {
  workerId: string;
  batchSize?: number;
  ourSellerIds?: Record<'mercadolivre' | 'nuvemshop', string>;
  fetcher: ImageFetcherFn;
}): Promise<{
  claimedCount: number;
  fetchedCount: number;
  requeuedCount: number;
  failedTerminalCount: number;
  touchedProductIds: string[];
}> {
  const batchSize = options.batchSize ?? 10;

  const claimedRows = await withTransaction(async (client: PoolClient) => {
    const res = await client.query<{
      id: string;
      master_product_id: string;
      variant_id: string | null;
      source_url: string;
      url_normalized: string;
      source_platform: 'bling' | 'mercadolivre' | 'nuvemshop';
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, master_product_id, variant_id, source_url, url_normalized,
              source_platform, attempts, max_attempts
       FROM image_processing_queue
       WHERE stage = 'queued'
         AND locked_at IS NULL
         AND available_at <= now()
       ORDER BY available_at ASC, id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );

    for (const row of res.rows) {
      await client.query(
        `UPDATE image_processing_queue
         SET locked_at = now(), locked_by = $2
         WHERE id = $1`,
        [row.id, options.workerId]
      );
    }

    return res.rows;
  });

  let fetchedCount = 0;
  let requeuedCount = 0;
  let failedTerminalCount = 0;
  const touchedProducts = new Set<string>();

  for (const row of claimedRows) {
    touchedProducts.add(row.master_product_id);

    try {
      if (!isAllowedImageHost(row.source_url)) {
        throw new Error(`Host de imagem não autorizado: ${row.source_url}`);
      }

      const probe = await options.fetcher(row.source_url);
      if (probe.buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`Imagem excede tamanho máximo de ${MAX_IMAGE_BYTES} bytes`);
      }
      if (probe.width <= 0 || probe.height <= 0) {
        throw new Error('Dimensões de imagem inválidas');
      }

      const sha256Hash = crypto
        .createHash('sha256')
        .update(probe.buffer)
        .digest('hex');

      // Determina status inicial de direitos (Seção 8.6 Etapa 4)
      let rightsStatus: 'owned' | 'third_party_risk' | 'watermark_suspect' = 'owned';
      let reviewReason: 'different_seller' | 'watermark_suspect' | null = null;

      if (
        row.source_platform !== 'bling' &&
        probe.sellerId &&
        options.ourSellerIds?.[row.source_platform] &&
        probe.sellerId !== options.ourSellerIds[row.source_platform]
      ) {
        rightsStatus = 'third_party_risk';
        reviewReason = 'different_seller';
      } else if (probe.watermarkSuspect) {
        rightsStatus = 'watermark_suspect';
        reviewReason = 'watermark_suspect';
      }

      const qualityScore = computeImageQualityScore({
        width: probe.width,
        height: probe.height,
        sourcePlatform: row.source_platform,
        format: probe.format,
        rightsStatus,
      });

      const coverEligible = isEligibleForCover({
        qualityScore,
        rightsStatus,
        width: probe.width,
        height: probe.height,
      });

      await withTransaction(async (client: PoolClient) => {
        const imgRes = await client.query<{ id: string }>(
          `INSERT INTO product_images (
             master_product_id, variant_id, source_url, url_normalized,
             source_platform, seller_id, average_hash, sha256_hash,
             width, height, format, size_bytes, rights_status,
             quality_score, is_cover_eligible, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
           ON CONFLICT (master_product_id, url_normalized) DO UPDATE
             SET average_hash = EXCLUDED.average_hash,
                 sha256_hash = EXCLUDED.sha256_hash,
                 width = EXCLUDED.width,
                 height = EXCLUDED.height,
                 format = EXCLUDED.format,
                 size_bytes = EXCLUDED.size_bytes,
                 rights_status = EXCLUDED.rights_status,
                 quality_score = EXCLUDED.quality_score,
                 is_cover_eligible = EXCLUDED.is_cover_eligible,
                 updated_at = now()
           RETURNING id`,
          [
            row.master_product_id,
            row.variant_id,
            row.source_url,
            row.url_normalized,
            row.source_platform,
            probe.sellerId ?? null,
            probe.averageHash,
            sha256Hash,
            probe.width,
            probe.height,
            probe.format,
            probe.buffer.byteLength,
            rightsStatus,
            qualityScore,
            coverEligible,
          ]
        );

        const productImageId = imgRes.rows[0]!.id;

        if (reviewReason) {
          await client.query(
            `INSERT INTO image_rights_review_queue (
               product_image_id, master_product_id, reason, status
             ) VALUES ($1, $2, $3, 'pending')`,
            [productImageId, row.master_product_id, reviewReason]
          );
        }

        await client.query(
          `UPDATE image_processing_queue
           SET stage = 'fetched',
               product_image_id = $2,
               locked_at = NULL,
               locked_by = NULL,
               last_error = NULL
           WHERE id = $1`,
          [row.id, productImageId]
        );
      });

      fetchedCount += 1;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const nextAttempts = row.attempts + 1;
      const isTerminalFailure = nextAttempts >= row.max_attempts;

      await withTransaction(async (client: PoolClient) => {
        if (isTerminalFailure) {
          await client.query(
            `UPDATE image_processing_queue
             SET stage = 'failed',
                 attempts = $2,
                 locked_at = NULL,
                 locked_by = NULL,
                 last_error = $3,
                 finished_at = now()
             WHERE id = $1`,
            [row.id, nextAttempts, errMessage]
          );
        } else {
          const backoffSeconds = Math.pow(2, nextAttempts) * 15;
          const nextAvailableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
          await client.query(
            `UPDATE image_processing_queue
             SET stage = 'queued',
                 attempts = $2,
                 available_at = $3,
                 locked_at = NULL,
                 locked_by = NULL,
                 last_error = $4
             WHERE id = $1`,
            [row.id, nextAttempts, nextAvailableAt, errMessage]
          );
        }
      });

      if (isTerminalFailure) {
        failedTerminalCount += 1;
      } else {
        requeuedCount += 1;
      }
    }
  }

  return {
    claimedCount: claimedRows.length,
    fetchedCount,
    requeuedCount,
    failedTerminalCount,
    touchedProductIds: Array.from(touchedProducts),
  };
}

export interface IqreFinalizeReport {
  master_product_id: string;
  readyToFinalize: boolean;
  keptImageIds: string[];
  deduplicatedDroppedImageIds: string[];
  crossProductSimilarityAlerts: number;
  coverImageId: string | null;
}

/**
 * Etapas 3, 5 e 6 do IQRE (job iqre.finalize):
 * - Só executa quando nenhuma imagem daquele master_product resta em stage = 'queued'.
 * - Deduplica APENAS dentro do mesmo master_product (Average Hash 8x8 com distância de Hamming <= 5),
 *   mantendo a imagem de maior resolução (width * height).
 * - Hash parecido em outro master_product NUNCA deduplica a imagem deste produto; apenas registra
 *   sugestão de revisão em image_rights_review_queue (reason = 'cross_product_similarity').
 * - Ordena por score e atribui posições por canal respeitando platform_image_limits e elegibilidade de capa.
 */
export async function finalizeProductImagesIqre(
  masterProductId: string
): Promise<IqreFinalizeReport> {
  return withTransaction(async (client: PoolClient) => {
    const queuedRes = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM image_processing_queue
       WHERE master_product_id = $1 AND stage = 'queued'`,
      [masterProductId]
    );

    if ((queuedRes.rows[0]?.count ?? 0) > 0) {
      return {
        master_product_id: masterProductId,
        readyToFinalize: false,
        keptImageIds: [],
        deduplicatedDroppedImageIds: [],
        crossProductSimilarityAlerts: 0,
        coverImageId: null,
      };
    }

    const imagesRes = await client.query<{
      id: string;
      average_hash: string | null;
      width: number | null;
      height: number | null;
      rights_status: 'owned' | 'third_party_risk' | 'watermark_suspect' | 'approved' | 'rejected';
      quality_score: number;
      is_cover_eligible: boolean;
    }>(
      `SELECT id, average_hash, width, height, rights_status, quality_score, is_cover_eligible
       FROM product_images
       WHERE master_product_id = $1
       FOR UPDATE`,
      [masterProductId]
    );

    // Ordena por maior resolução (width * height) DESC e depois por quality_score DESC para que o representante
    // mantido em cada cluster de Hamming <= 5 seja SEMPRE o de maior resolução (Seção 8.6 Etapa 3)
    const sortedByResolution = [...imagesRes.rows].sort((a, b) => {
      const areaA = (a.width ?? 0) * (a.height ?? 0);
      const areaB = (b.width ?? 0) * (b.height ?? 0);
      if (areaB !== areaA) return areaB - areaA;
      return b.quality_score - a.quality_score;
    });

    const keptImages: typeof sortedByResolution = [];
    const droppedDuplicateIds: string[] = [];

    for (const img of sortedByResolution) {
      if (!img.average_hash || img.average_hash.length !== 16) {
        keptImages.push(img);
        continue;
      }

      const duplicateWinner = keptImages.find(
        (k) =>
          k.average_hash &&
          k.average_hash.length === 16 &&
          hammingDistance64(img.average_hash!, k.average_hash) <= 5
      );

      if (duplicateWinner) {
        droppedDuplicateIds.push(img.id);
      } else {
        keptImages.push(img);
      }
    }

    // Verifica similaridade com outros produtos (sem jamais deduplicar/remover a imagem deste produto!)
    const otherProductsImagesRes = await client.query<{
      id: string;
      average_hash: string | null;
    }>(
      `SELECT id, average_hash
       FROM product_images
       WHERE master_product_id <> $1 AND average_hash IS NOT NULL`,
      [masterProductId]
    );

    let crossProductSimilarityAlerts = 0;
    for (const kept of keptImages) {
      if (!kept.average_hash || kept.average_hash.length !== 16) continue;
      const hasSimilarInOtherProduct = otherProductsImagesRes.rows.some(
        (other) =>
          other.average_hash &&
          other.average_hash.length === 16 &&
          hammingDistance64(kept.average_hash!, other.average_hash) <= 5
      );
      if (hasSimilarInOtherProduct) {
        const existingRev = await client.query<{ id: string }>(
          `SELECT id FROM image_rights_review_queue
           WHERE product_image_id = $1 AND reason = 'cross_product_similarity'`,
          [kept.id]
        );
        if (existingRev.rowCount === 0) {
          await client.query(
            `INSERT INTO image_rights_review_queue (
               product_image_id, master_product_id, reason, status
             ) VALUES ($1, $2, 'cross_product_similarity', 'pending')`,
            [kept.id, masterProductId]
          );
          crossProductSimilarityAlerts += 1;
        }
      }
    }

    // Limpa posições das imagens descartadas na deduplicação interna do produto
    for (const dupId of droppedDuplicateIds) {
      await client.query(
        `UPDATE product_images
         SET position_bling = NULL,
             position_ml = NULL,
             position_ns = NULL,
             is_cover_eligible = false,
             updated_at = now()
         WHERE id = $1`,
        [dupId]
      );
    }

    // Carrega limites por plataforma (platform_image_limits)
    const limitsRes = await client.query<{
      platform: 'bling' | 'mercadolivre' | 'nuvemshop';
      max_images: number;
      min_width: number;
      min_height: number;
    }>(`SELECT platform, max_images, min_width, min_height FROM platform_image_limits`);

    const limitsByPlatform = new Map(
      limitsRes.rows.map((l) => [l.platform, l])
    );

    // Filtra apenas imagens publicáveis (exclui third_party_risk e rejected — Seção 8.6 Etapa 4)
    const publishableImages = keptImages.filter(
      (img) =>
        img.rights_status !== 'third_party_risk' && img.rights_status !== 'rejected'
    );

    // Ordena pelo quality_score DESC (colocando a melhor elegível para capa na posição 1)
    publishableImages.sort((a, b) => {
      if (a.is_cover_eligible !== b.is_cover_eligible) {
        return a.is_cover_eligible ? -1 : 1;
      }
      if (b.quality_score !== a.quality_score) {
        return b.quality_score - a.quality_score;
      }
      return (
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
      );
    });

    const coverImage = publishableImages.find((img) => img.is_cover_eligible) ?? null;

    let posBling = 0;
    let posMl = 0;
    let posNs = 0;

    const limBling = limitsByPlatform.get('bling') ?? {
      max_images: 10,
      min_width: 100,
      min_height: 100,
    };
    const limMl = limitsByPlatform.get('mercadolivre') ?? {
      max_images: 10,
      min_width: 500,
      min_height: 500,
    };
    const limNs = limitsByPlatform.get('nuvemshop') ?? {
      max_images: 50,
      min_width: 200,
      min_height: 200,
    };

    for (const img of keptImages) {
      const isPub =
        img.rights_status !== 'third_party_risk' && img.rights_status !== 'rejected';
      const w = img.width ?? 0;
      const h = img.height ?? 0;

      const assignBling =
        isPub &&
        w >= limBling.min_width &&
        h >= limBling.min_height &&
        posBling < limBling.max_images
          ? ++posBling
          : null;

      const assignMl =
        isPub &&
        w >= limMl.min_width &&
        h >= limMl.min_height &&
        posMl < limMl.max_images
          ? ++posMl
          : null;

      const assignNs =
        isPub &&
        w >= limNs.min_width &&
        h >= limNs.min_height &&
        posNs < limNs.max_images
          ? ++posNs
          : null;

      await client.query(
        `UPDATE product_images
         SET position_bling = $2,
             position_ml = $3,
             position_ns = $4,
             updated_at = now()
         WHERE id = $1`,
        [img.id, assignBling, assignMl, assignNs]
      );
    }

    // Marca todas as linhas 'fetched' da fila deste produto como 'done'
    await client.query(
      `UPDATE image_processing_queue
       SET stage = 'done',
           finished_at = now()
       WHERE master_product_id = $1 AND stage = 'fetched'`,
      [masterProductId]
    );

    return {
      master_product_id: masterProductId,
      readyToFinalize: true,
      keptImageIds: keptImages.map((i) => i.id),
      deduplicatedDroppedImageIds: droppedDuplicateIds,
      crossProductSimilarityAlerts,
      coverImageId: coverImage?.id ?? null,
    };
  });
}
