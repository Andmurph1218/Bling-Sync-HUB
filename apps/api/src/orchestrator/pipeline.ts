/**
 * Orquestrador Ponta a Ponta do Catálogo & Medição de Lag P1 de Estoque (Seções 2, 5, 10.1, 10.2 e 13 - Fase 12)
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import {
  BlingProductPayload,
  BlingStockBalanceItem,
} from '../contracts/fixtures/bling.fixtures.js';
import {
  computePublishableStockFromBalances,
  mapBlingProductToCatalog,
  WarehouseConfig,
} from '../contracts/mappers.js';
import { evaluateProductGve, VariantExternalEanCandidate } from '../engines/gve.js';
import { evaluateProductNve, VariantNcmObservation } from '../engines/nve.js';
import {
  PireExternalItemInput,
  resolveMlUserProductFamilyPire,
  resolvePlatformItemPire,
} from '../engines/pire.js';
import {
  ExternalChannelVariantInput,
  resolveProductVariantsVir,
} from '../engines/vir.js';
import {
  evaluateAndApplyCqsEnrichment,
  ExternalChannelContentCandidate,
} from '../engines/cqs.js';
import {
  EnqueueImageCandidate,
  enqueueProductImagesForSync,
} from '../engines/iqre.js';
import {
  calculateProductReadinessCre,
  ProductReadinessReport,
} from '../engines/cre.js';
import {
  ingestWebhookController,
  processWebhookEventById,
} from '../engines/wig.js';
import {
  ChannelStepExecutorCalls,
  enqueueOrPromotePushJob,
  executePushJobById,
  ExecutePushJobReport,
} from '../engines/ape.js';

export const SLA_P1_STOCK_MAX_LAG_MS = 120_000; // 2 minutos (Seção 2)

export interface UpsertCatalogFromBlingResult {
  ignoredService: boolean;
  masterProductId: string | null;
  variantIdsBySku: Record<string, string>;
}

/**
 * Faz o upsert completo de um produto do Bling (simples S, variação V ou kit E) no banco local,
 * respeitando a regra de que product_variants.stock nasce NULL até a leitura de GET /estoques/saldos.
 */
export async function upsertCatalogProductFromBlingPayload(
  payload: BlingProductPayload
): Promise<UpsertCatalogFromBlingResult> {
  const mapped = mapBlingProductToCatalog(payload);
  if (mapped.kind === 'ignored_service') {
    return {
      ignoredService: true,
      masterProductId: null,
      variantIdsBySku: {},
    };
  }

  const p = mapped.product;
  return withTransaction(async (client: PoolClient) => {
    const prodRes = await client.query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, ncm, cest, tax_origin, unit, requires_cest,
         bling_tipo, bling_formato, name, description, short_description,
         brand, category, catalog_status, last_bling_snapshot, last_bling_sync, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
       ON CONFLICT (bling_id) DO UPDATE
         SET bling_sku = EXCLUDED.bling_sku,
             ncm = COALESCE(master_products.ncm, EXCLUDED.ncm),
             cest = EXCLUDED.cest,
             tax_origin = EXCLUDED.tax_origin,
             requires_cest = EXCLUDED.requires_cest,
             bling_formato = EXCLUDED.bling_formato,
             catalog_status = EXCLUDED.catalog_status,
             last_bling_snapshot = EXCLUDED.last_bling_snapshot,
             last_bling_sync = now(),
             updated_at = now()
       RETURNING id`,
      [
        p.bling_id,
        p.bling_sku,
        p.ncm,
        p.cest,
        p.tax_origin,
        p.unit,
        p.requires_cest,
        p.bling_tipo,
        p.bling_formato,
        p.name,
        p.description,
        p.short_description,
        p.brand,
        p.category,
        p.catalog_status,
        JSON.stringify(payload),
      ]
    );

    const masterProductId = prodRes.rows[0]!.id;
    const variantIdsBySku: Record<string, string> = {};

    const axesRes = await client.query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM attribute_axes`
    );
    const axisIdByName = new Map(
      axesRes.rows.map((a) => [a.canonical_name, a.id])
    );

    for (const v of p.variants) {
      const varRes = await client.query<{ id: string }>(
        `INSERT INTO product_variants (
           master_product_id, bling_variant_id, bling_sku, is_default,
           bling_formato, stock_mode, price, cost_price, stock,
           net_weight, gross_weight, width, height, depth,
           ean, is_active, variant_status, last_bling_sync, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, NULL,
           $9, $10, $11, $12, $13, $14, $15, $16, now(), now()
         )
         ON CONFLICT (bling_sku) DO UPDATE
           SET price = EXCLUDED.price,
               cost_price = EXCLUDED.cost_price,
               net_weight = COALESCE(product_variants.net_weight, EXCLUDED.net_weight),
               gross_weight = COALESCE(product_variants.gross_weight, EXCLUDED.gross_weight),
               width = COALESCE(product_variants.width, EXCLUDED.width),
               height = COALESCE(product_variants.height, EXCLUDED.height),
               depth = COALESCE(product_variants.depth, EXCLUDED.depth),
               is_active = EXCLUDED.is_active,
               variant_status = EXCLUDED.variant_status,
               last_bling_sync = now(),
               updated_at = now()
         RETURNING id`,
        [
          masterProductId,
          v.bling_variant_id,
          v.bling_sku,
          v.is_default,
          v.bling_formato,
          v.stock_mode,
          v.price,
          v.cost_price,
          v.net_weight,
          v.gross_weight,
          v.width,
          v.height,
          v.depth,
          v.ean,
          v.is_active,
          v.variant_status,
        ]
      );

      const variantId = varRes.rows[0]!.id;
      variantIdsBySku[v.bling_sku] = variantId;

      for (let i = 0; i < v.attributes.length; i++) {
        const attr = v.attributes[i]!;
        const axisId = axisIdByName.get(attr.axisCanonicalName);
        if (!axisId) continue;

        await client.query(
          `INSERT INTO product_axes (master_product_id, axis_id, sort_order)
           VALUES ($1, $2, $3)
           ON CONFLICT (master_product_id, axis_id) DO NOTHING`,
          [masterProductId, axisId, i + 1]
        );

        await client.query(
          `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (variant_id, axis_id) DO UPDATE
             SET canonical_value = EXCLUDED.canonical_value`,
          [variantId, axisId, attr.value, i + 1]
        );
      }

      for (const comp of v.components) {
        await client.query(
          `INSERT INTO product_components (kit_variant_id, component_bling_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (kit_variant_id, component_bling_id) DO UPDATE
             SET quantity = EXCLUDED.quantity`,
          [variantId, comp.component_bling_id, comp.quantity]
        );
      }
    }

    return {
      ignoredService: false,
      masterProductId,
      variantIdsBySku,
    };
  });
}

/**
 * Aplica a leitura de GET /estoques/saldos para uma variante (Seção 10.7):
 * - Grava variant_stock_balances por depósito.
 * - Na mesma transação, grava product_variants.stock com a soma apenas dos depósitos seller com include_in_push = true.
 */
export async function applyVariantStockBalancesFromBling(
  variantId: string,
  balanceItem: BlingStockBalanceItem
): Promise<{
  variantStockColumn: number;
  publishableFloor: number;
}> {
  return withTransaction(async (client: PoolClient) => {
    const whRes = await client.query<WarehouseConfig>(
      `SELECT bling_warehouse_id, role, include_in_push FROM stock_warehouses`
    );

    const computed = computePublishableStockFromBalances(balanceItem, whRes.rows);

    for (const dep of balanceItem.depositos) {
      const depId = String(dep.id);
      const existsWh = whRes.rows.some((w) => w.bling_warehouse_id === depId);
      if (!existsWh) {
        await client.query(
          `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
           VALUES ($1, $2, 'unclassified', false)
           ON CONFLICT (bling_warehouse_id) DO NOTHING`,
          [depId, `Depósito ${depId}`]
        );
      }

      await client.query(
        `INSERT INTO variant_stock_balances (
           variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual, updated_at
         ) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (variant_id, bling_warehouse_id) DO UPDATE
           SET saldo_fisico = EXCLUDED.saldo_fisico,
               saldo_virtual = EXCLUDED.saldo_virtual,
               updated_at = now()`,
        [variantId, depId, dep.saldoFisico, dep.saldoVirtual]
      );
    }

    await client.query(
      `UPDATE product_variants
       SET stock = $2,
           updated_at = now()
       WHERE id = $1`,
      [variantId, computed.variantStockColumn]
    );

    return {
      variantStockColumn: computed.variantStockColumn,
      publishableFloor: computed.publishableFloor,
    };
  });
}

export interface FullProductEnrichmentPipelineInput {
  blingPayload: BlingProductPayload;
  stockBalancesBySku?: Record<string, BlingStockBalanceItem>;
  storePricesBySku?: Record<
    string,
    Partial<
      Record<
        'mercadolivre' | 'nuvemshop',
        { store_price: number | null; store_promotional_price: number | null }
      >
    >
  >;
  mlFamily?: {
    familyId: string;
    familyName: string;
    items: PireExternalItemInput[];
    variants: ExternalChannelVariantInput[];
  };
  nsItem?: {
    item: PireExternalItemInput;
    variants: ExternalChannelVariantInput[];
  };
  externalEans?: VariantExternalEanCandidate[];
  variantNcmObservations?: VariantNcmObservation[];
  cqsCandidates?: Array<{
    variantSku: string;
    candidate: ExternalChannelContentCandidate;
  }>;
  imagesToEnqueue?: EnqueueImageCandidate[];
}

export interface FullProductEnrichmentPipelineReport {
  masterProductId: string;
  variantIdsBySku: Record<string, string>;
  enqueuedImagesCount: number;
  readinessReport: ProductReadinessReport;
}

/**
 * Executa o fluxo completo da Seção 10.1 para um produto ativo do catálogo:
 * 1. Upsert Bling + saldos + preços de loja
 * 2. PIRE e VIR nos canais
 * 3. NVE no NCM e GVE no EAN de cada variante
 * 4. CQS nos campos do Grupo B
 * 5. IQRE apenas enfileira as imagens sem esperar download
 * 6. CRE calcula os 3 scores por variante e o KPI do produto
 */
export async function runFullProductCatalogPipeline(
  input: FullProductEnrichmentPipelineInput
): Promise<FullProductEnrichmentPipelineReport> {
  const upserted = await upsertCatalogProductFromBlingPayload(input.blingPayload);
  if (upserted.ignoredService || !upserted.masterProductId) {
    throw new Error('Serviço ignorado não entra no pipeline de catálogo');
  }

  const masterProductId = upserted.masterProductId;

  // Saldos de depósito e preços de loja
  if (input.stockBalancesBySku) {
    for (const [sku, bal] of Object.entries(input.stockBalancesBySku)) {
      const varId = upserted.variantIdsBySku[sku];
      if (varId) {
        await applyVariantStockBalancesFromBling(varId, bal);
      }
    }
  }

  if (input.storePricesBySku) {
    for (const [sku, byPlatform] of Object.entries(input.storePricesBySku)) {
      const varId = upserted.variantIdsBySku[sku];
      if (!varId || !byPlatform) continue;
      for (const platform of ['mercadolivre', 'nuvemshop'] as const) {
        const priceRow = byPlatform[platform];
        if (!priceRow) continue;
        await query(
          `INSERT INTO variant_channel_prices (variant_id, platform, store_price, store_promotional_price, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (variant_id, platform) DO UPDATE
             SET store_price = EXCLUDED.store_price,
                 store_promotional_price = EXCLUDED.store_promotional_price,
                 updated_at = now()`,
          [varId, platform, priceRow.store_price, priceRow.store_promotional_price]
        );
      }
    }
  }

  // PIRE + VIR para Mercado Livre e Nuvemshop
  if (input.mlFamily) {
    const pireMl = await resolveMlUserProductFamilyPire(
      input.mlFamily.familyId,
      input.mlFamily.familyName,
      input.mlFamily.items
    );
    if (pireMl.master_product_id === masterProductId) {
      await resolveProductVariantsVir({
        masterProductId,
        platform: 'mercadolivre',
        platformProductId: input.mlFamily.familyId,
        channelVariants: input.mlFamily.variants,
      });
    }
  }

  if (input.nsItem) {
    const pireNs = await resolvePlatformItemPire(input.nsItem.item);
    if (pireNs.master_product_id === masterProductId) {
      await resolveProductVariantsVir({
        masterProductId,
        platform: 'nuvemshop',
        platformProductId: input.nsItem.item.platform_product_id,
        channelVariants: input.nsItem.variants,
      });
    }
  }

  // Fiscal: NVE e GVE
  await evaluateProductNve(masterProductId, input.variantNcmObservations ?? []);
  await evaluateProductGve(masterProductId, input.externalEans ?? []);

  // Enriquecimento: CQS
  if (input.cqsCandidates) {
    for (const item of input.cqsCandidates) {
      const varId = upserted.variantIdsBySku[item.variantSku];
      if (varId) {
        await evaluateAndApplyCqsEnrichment({
          masterProductId,
          variantId: varId,
          candidate: item.candidate,
        });
      }
    }
  }

  // Mídia: IQRE apenas enfileira (não espera download)
  let enqueuedImagesCount = 0;
  if (input.imagesToEnqueue && input.imagesToEnqueue.length > 0) {
    const iqreEnq = await enqueueProductImagesForSync(
      masterProductId,
      input.imagesToEnqueue
    );
    enqueuedImagesCount = iqreEnq.enqueuedCount;
  }

  // Prontidão: CRE
  const readinessReport = await calculateProductReadinessCre(masterProductId);

  return {
    masterProductId,
    variantIdsBySku: upserted.variantIdsBySku,
    enqueuedImagesCount,
    readinessReport,
  };
}

export interface P1StockEndToEndLagMeasurement {
  webhookEventId: string;
  variantId: string;
  publishedFloorQuantity: number;
  eventReceivedAtMs: number;
  pushFinishedAtMs: number;
  measuredLagMs: number;
  withinTwoMinuteSla: boolean;
  pushReports: ExecutePushJobReport[];
  executedChannelCalls: ChannelStepExecutorCalls[];
}

/**
 * Executa o fluxo ponta a ponta de atualização P1 de estoque (Seção 2 e Fase 12 — "Lag de estoque medido"):
 * 1. Recebe o webhook de estoque no WIG (HMAC + INSERT em webhook_events)
 * 2. Processa o evento no worker WIG
 * 3. Lê o saldo atualizado de GET /estoques/saldos e grava variant_stock_balances e product_variants.stock
 * 4. Abre/promove os push_jobs STOCK_PRICE P1 para Mercado Livre e Nuvemshop
 * 5. Executa os push_jobs no APE (pulando meli_facility puro e enviando floor para seller_warehouse e Nuvemshop)
 * 6. Registra a latência em push_execution_logs e retorna o lag medido em milissegundos.
 */
export async function executeAndMeasureP1StockFlow(input: {
  rawWebhookBody: string;
  signatureHeader: string;
  webhookSecret: string;
  masterProductId: string;
  variantId: string;
  freshBalanceItem: BlingStockBalanceItem;
}): Promise<P1StockEndToEndLagMeasurement> {
  const eventReceivedAtMs = Date.now();

  const ingest = await ingestWebhookController({
    source: 'bling',
    rawBody: input.rawWebhookBody,
    signatureHeader: input.signatureHeader,
    secret: input.webhookSecret,
  });

  if (ingest.httpStatus !== 200 || !ingest.webhookEventId) {
    throw new Error('Falha na ingestão do webhook de estoque P1');
  }

  await processWebhookEventById(ingest.webhookEventId, 'p1-stock-worker');

  const stockUpdated = await applyVariantStockBalancesFromBling(
    input.variantId,
    input.freshBalanceItem
  );

  const pushReports: ExecutePushJobReport[] = [];
  const executedChannelCalls: ChannelStepExecutorCalls[] = [];

  for (const platform of ['mercadolivre', 'nuvemshop'] as const) {
    const { pushJobId } = await enqueueOrPromotePushJob({
      masterProductId: input.masterProductId,
      variantId: input.variantId,
      platform,
      jobKind: 'STOCK_PRICE',
      priority: 'P1',
      changedFields: ['stock'],
    });

    const stepStartMs = Date.now();
    const report = await executePushJobById(pushJobId, {
      onExecuteChannelCall: async (call) => {
        executedChannelCalls.push(call);
      },
    });
    const latencyMs = Math.max(1, Date.now() - stepStartMs);

    await query(
      `INSERT INTO push_execution_logs (
         push_job_id, master_product_id, variant_id, platform,
         job_kind, step, http_status, latency_ms, status
       ) VALUES ($1, $2, $3, $4, 'STOCK_PRICE', 'stock', 200, $5, $6)`,
      [
        pushJobId,
        input.masterProductId,
        input.variantId,
        platform,
        latencyMs,
        report.finalJobStatus,
      ]
    );

    pushReports.push(report);
  }

  const pushFinishedAtMs = Date.now();
  const measuredLagMs = Math.max(1, pushFinishedAtMs - eventReceivedAtMs);

  return {
    webhookEventId: ingest.webhookEventId,
    variantId: input.variantId,
    publishedFloorQuantity: stockUpdated.publishableFloor,
    eventReceivedAtMs,
    pushFinishedAtMs,
    measuredLagMs,
    withinTwoMinuteSla: measuredLagMs < SLA_P1_STOCK_MAX_LAG_MS,
    pushReports,
    executedChannelCalls,
  };
}

/**
 * Faz replay de um push_job com status = 'failed' pelo id (Seção 5):
 * Não reprocessa passos já 'completed' nem chaves de idempotência já concluídas.
 */
export async function replayFailedPushJobById(
  pushJobId: string
): Promise<ExecutePushJobReport> {
  await withTransaction(async (client: PoolClient) => {
    const jobRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM push_jobs WHERE id = $1 FOR UPDATE`,
      [pushJobId]
    );
    const job = jobRes.rows[0];
    if (!job) {
      throw new Error(`push_job ${pushJobId} não encontrado`);
    }
    if (job.status !== 'failed') {
      throw new Error(`Apenas jobs com status 'failed' permitem replay (atual: ${job.status})`);
    }

    await client.query(
      `UPDATE push_job_steps
       SET status = 'pending', last_error = NULL
       WHERE push_job_id = $1 AND status = 'failed'`,
      [pushJobId]
    );

    await client.query(
      `UPDATE push_jobs
       SET status = 'pending', attempts = attempts + 1
       WHERE id = $1`,
      [pushJobId]
    );
  });

  return executePushJobById(pushJobId);
}

/**
 * Métricas operacionais mínimas (Seção 5):
 * Profundidade da fila, idade do webhook mais antigo ainda aberto e latência de push.
 */
export async function getOperationalMetrics(): Promise<{
  queueDepth: {
    pendingPushJobs: number;
    pendingMatchingQueue: number;
    queuedImages: number;
    total: number;
  };
  oldestPendingWebhookAgeMs: number;
  pushLatencyStats: {
    samplesCount: number;
    maxLatencyMs: number;
    avgLatencyMs: number;
  };
}> {
  const [pushPending, matchPending, imgQueued, oldestWh, pushLogs] = await Promise.all([
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'pending'`
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM matching_queue WHERE status = 'pending'`
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM image_processing_queue WHERE stage = 'queued'`
    ),
    query<{ created_at: Date | string }>(
      `SELECT created_at
       FROM webhook_events
       WHERE status IN ('received', 'queued')
       ORDER BY created_at ASC
       LIMIT 1`
    ),
    query<{ latency_ms: number }>(
      `SELECT latency_ms FROM push_execution_logs WHERE latency_ms IS NOT NULL`
    ),
  ]);

  const pPush = pushPending.rows[0]?.count ?? 0;
  const pMatch = matchPending.rows[0]?.count ?? 0;
  const pImg = imgQueued.rows[0]?.count ?? 0;

  let oldestWebhookAgeMs = 0;
  if (oldestWh.rows[0]?.created_at) {
    const createdMs =
      oldestWh.rows[0].created_at instanceof Date
        ? oldestWh.rows[0].created_at.getTime()
        : new Date(oldestWh.rows[0].created_at).getTime();
    oldestWebhookAgeMs = Math.max(0, Date.now() - createdMs);
  }

  const latencies = pushLogs.rows.map((r) => r.latency_ms);
  const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

  return {
    queueDepth: {
      pendingPushJobs: pPush,
      pendingMatchingQueue: pMatch,
      queuedImages: pImg,
      total: pPush + pMatch + pImg,
    },
    oldestPendingWebhookAgeMs: oldestWebhookAgeMs,
    pushLatencyStats: {
      samplesCount: latencies.length,
      maxLatencyMs,
      avgLatencyMs,
    },
  };
}
