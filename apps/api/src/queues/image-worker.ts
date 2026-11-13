import crypto from 'node:crypto';
import { recalculateCompleteness } from '../catalog/publish-preview.js';
import { query } from '../db/pool.js';
import {
  computeAverageHash64FromGrid,
  FetchedImageProbe,
  finalizeProductImagesIqre,
  MAX_IMAGE_BYTES,
  processQueuedImagesWorkerBatch,
} from '../engines/iqre.js';
import { logger } from '../lib/logger.js';
import { persistCachedMediaFile } from '../routes/media.js';

const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const WORKER_BATCH_SIZE = 20;
const IDLE_POLL_MS = 5_000;
const ACTIVE_PAUSE_MS = 250;

/**
 * Extrai dimensões e formato diretamente dos cabeçalhos binários (PNG, JPEG, WebP)
 * sem depender de bibliotecas nativas externas.
 */
export function parseImageDimensions(buffer: Buffer): {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
} | null {
  if (buffer.byteLength < 24) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR (offset 16: width u32be, offset 20: height u32be)
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height, format: 'png' };
    return null;
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.byteLength >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.byteLength >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height, format: 'webp' };
    } else if (chunk === 'VP8L' && buffer.byteLength >= 25) {
      const b0 = buffer[21]!;
      const b1 = buffer[22]!;
      const b2 = buffer[23]!;
      const b3 = buffer[24]!;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height, format: 'webp' };
    } else if (chunk === 'VP8X' && buffer.byteLength >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      if (width > 0 && height > 0) return { width, height, format: 'webp' };
    }
    return null;
  }

  // JPEG: FF D8 ... varre marcadores até encontrar SOF0..SOF15 (exceto DHT C4, JPG C8, DAC CC)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.byteLength) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let marker = buffer[offset + 1]!;
      while (marker === 0xff && offset + 2 < buffer.byteLength) {
        offset += 1;
        marker = buffer[offset + 1]!;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      if (offset + 4 > buffer.byteLength) break;
      const segLength = buffer.readUInt16BE(offset + 2);
      if (segLength < 2) break;
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof && offset + 9 <= buffer.byteLength) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height, format: 'jpeg' };
        return null;
      }
      offset += 2 + segLength;
    }
  }

  return null;
}

/**
 * Gera uma assinatura de 64 bits (16 hex) amostrando 64 janelas distribuídas sobre o corpo da imagem,
 * permitindo deduplicação determinística de bytes idênticos/re-servidos via computeAverageHash64FromGrid.
 */
export function computeSampledHash64(buffer: Buffer): string {
  const start = Math.min(64, Math.floor(buffer.byteLength * 0.1));
  const usable = Math.max(1, buffer.byteLength - start);
  const grid: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    const winStart = start + Math.floor((i * usable) / 64);
    const winEnd = Math.min(buffer.byteLength, start + Math.floor(((i + 1) * usable) / 64) + 1);
    let sum = 0;
    let count = 0;
    const step = Math.max(1, Math.floor((winEnd - winStart) / 16));
    for (let p = winStart; p < winEnd; p += step) {
      sum += buffer[p]!;
      count += 1;
    }
    grid.push(count > 0 ? Math.round(sum / count) : 0);
  }
  return computeAverageHash64FromGrid(grid);
}

export async function fetchAndCacheImageProbe(sourceUrl: string): Promise<FetchedImageProbe> {
  const res = await fetch(sourceUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent': 'JH Sync Hub Media Worker/2.0',
    },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao baixar imagem`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Tamanho de imagem inválido (${buffer.byteLength} bytes)`);
  }
  const parsed = parseImageDimensions(buffer);
  if (!parsed) {
    throw new Error('Formato de imagem não suportado ou cabeçalho inválido');
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (process.env.VITEST !== 'true') {
    await persistCachedMediaFile(sha256, parsed.format, buffer);
  }
  return {
    buffer,
    width: parsed.width,
    height: parsed.height,
    format: parsed.format,
    averageHash: computeSampledHash64(buffer),
  };
}

export async function runImageWorkerOnce(
  fetcher: (url: string) => Promise<FetchedImageProbe> = fetchAndCacheImageProbe,
  batchSize = WORKER_BATCH_SIZE
): Promise<{ claimed: number; fetched: number; finalized: number }> {
  await query(
    `UPDATE image_processing_queue
     SET locked_at = NULL, locked_by = NULL
     WHERE stage = 'queued' AND locked_at IS NOT NULL AND locked_at < now() - interval '10 minutes'`
  ).catch(() => undefined);

  const batch = await processQueuedImagesWorkerBatch({
    workerId: `iqre-${process.pid}`,
    batchSize,
    fetcher,
  });

  if (batch.claimedCount === 0) {
    return { claimed: 0, fetched: 0, finalized: 0 };
  }

  let finalized = 0;
  const finalizedIds: string[] = [];
  for (const productId of batch.touchedProductIds) {
    try {
      const fin = await finalizeProductImagesIqre(productId);
      if (fin.readyToFinalize) {
        finalized += 1;
        finalizedIds.push(productId);
      }
    } catch (error) {
      logger.warn('Falha ao finalizar imagens do produto no IQRE', {
        productId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (finalizedIds.length > 0) {
    try {
      const scores = await recalculateCompleteness(finalizedIds);
      for (const item of scores) {
        await query(
          `UPDATE master_products SET worst_score = $2, updated_at = now() WHERE id = $1`,
          [item.id, item.percent]
        );
      }
    } catch {
      // Score será recalculado na próxima leitura se houver concorrência.
    }
  }

  logger.info('iqre lote de imagens processado', {
    claimed: batch.claimedCount,
    fetched: batch.fetchedCount,
    requeued: batch.requeuedCount,
    failed: batch.failedTerminalCount,
    finalized,
  });

  return { claimed: batch.claimedCount, fetched: batch.fetchedCount, finalized };
}

let runningLoop = false;

export function startImageWorker(): void {
  if (runningLoop) return;
  runningLoop = true;

  const tick = async () => {
    while (runningLoop) {
      try {
        const res = await runImageWorkerOnce();
        const waitMs = res.claimed > 0 ? ACTIVE_PAUSE_MS : IDLE_POLL_MS;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } catch (error) {
        logger.error('Ciclo do worker de imagens (IQRE) falhou', {
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
      }
    }
  };

  void tick();
}
