/**
 * Orquestrador Ponta a Ponta do Catálogo & Medição de Lag P1 de Estoque (Seções 2, 5, 10.1, 10.2 e 13 - Fase 12)
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { catalogPriceOrNull } from '../connectors/bling/mappers.js';
import { InboundProduct } from '../connectors/strategy/inbound.js';
import { loadConnectors } from '../connectors/load.js';
import {
  computePublishableStockFromBalances,
  StockBalanceItem,
  WarehouseConfig,
} from '../contracts/mappers.js';
import { mapInboundProduct } from './erp-port.js';
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
import { pushPort, PushChannelCall, PushJobReport } from './push-port.js';

export const SLA_P1_STOCK_MAX_LAG_MS = 120_000; // 2 minutos (Seção 2)

export interface UpsertCatalogFromBlingResult {
  ignoredService: boolean;
  masterProductId: string | null;
  variantIdsBySku: Record<string, string>;
}

export function blingChangedAt(payload: { dataAlteracao?: string | null }): Date | null {
  if (!payload.dataAlteracao) return null;
  const date = new Date(payload.dataAlteracao);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** O webhook grava last_bling_sync com o relógio do HUB. Um snapshot mais antigo não pode voltar. */
export function isNewerHubSync(changedAt: Date | null, lastBlingSync: Date | string | null): boolean {
  if (!changedAt || lastBlingSync == null) return false;
  const sync = lastBlingSync instanceof Date ? lastBlingSync : new Date(lastBlingSync);
  return !Number.isNaN(sync.getTime()) && sync.getTime() > changedAt.getTime();
}

function incomingPrice(payload: InboundProduct, sku: string, isDefault: boolean): number | null {
  const match = (payload.variacoes ?? []).find((row) => row.codigo === sku);
  if (match) {
    if ('preco' in match) return catalogPriceOrNull(match.preco);
    return catalogPriceOrNull(payload.preco);
  }
  if (isDefault) return catalogPriceOrNull(payload.preco);
  return null;
}

/**
 * Faz o upsert completo de um produto do Bling (simples S, variação V ou kit E) no banco local,
 * respeitando a regra de que product_variants.stock nasce NULL até a leitura de GET /estoques/saldos.
 */
export async function upsertCatalogProduct(
  payload: InboundProduct
): Promise<UpsertCatalogFromBlingResult> {
  await loadConnectors();
  const mapped = mapInboundProduct(payload);
  if (mapped.kind === 'ignored_service') {
    return {
      ignoredService: true,
      masterProductId: null,
      variantIdsBySku: {},
    };
  }

  const p = mapped.product;
  const changedAt = blingChangedAt(payload);
  return withTransaction(async (client: PoolClient) => {
    const previous = await client.query<{ last_bling_sync: Date | null }>(
      `SELECT last_bling_sync FROM master_products WHERE erp_id = $1`,
      [p.erp_id]
    );
    const stale = isNewerHubSync(changedAt, previous.rows[0]?.last_bling_sync ?? null);
    const prodRes = await client.query<{ id: string }>(
      `INSERT INTO master_products (
         erp_id, erp_sku, ncm, cest, tax_origin, unit, requires_cest,
         bling_tipo, product_format, name, description, short_description,
         brand, category, catalog_status, last_bling_snapshot, last_bling_sync, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, now()), now())
       ON CONFLICT (erp_id) DO UPDATE
         SET erp_sku = EXCLUDED.erp_sku,
             ncm = COALESCE(master_products.ncm, EXCLUDED.ncm),
             cest = EXCLUDED.cest,
             tax_origin = EXCLUDED.tax_origin,
             unit = EXCLUDED.unit,
             requires_cest = EXCLUDED.requires_cest,
             bling_tipo = EXCLUDED.bling_tipo,
             product_format = EXCLUDED.product_format,
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             short_description = EXCLUDED.short_description,
             brand = EXCLUDED.brand,
             category = EXCLUDED.category,
             catalog_status = EXCLUDED.catalog_status,
             last_bling_snapshot = CASE WHEN $18 THEN master_products.last_bling_snapshot ELSE EXCLUDED.last_bling_snapshot END,
             last_bling_sync = CASE
               WHEN $18 THEN master_products.last_bling_sync
               WHEN $17 IS NOT NULL THEN $17
               ELSE now()
             END,
             updated_at = now()
       RETURNING id`,
      [
        p.erp_id,
        p.erp_sku,
        p.ncm,
        p.cest,
        p.tax_origin,
        p.unit,
        p.requires_cest,
        p.bling_tipo,
        p.product_format,
        p.name,
        p.description,
        p.short_description,
        p.brand,
        p.category,
        p.catalog_status,
        JSON.stringify(payload),
        changedAt ? changedAt.toISOString() : null,
        stale,
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
      const price = incomingPrice(payload, v.erp_sku, v.is_default);
      const varRes = await client.query<{ id: string }>(
        `INSERT INTO product_variants (
           master_product_id, bling_variant_id, erp_sku, is_default,
           product_format, stock_mode, price, cost_price, stock,
           net_weight, gross_weight, width, height, depth,
           ean, is_active, variant_status, last_bling_sync, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, NULL,
           $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, now()), now()
         )
         ON CONFLICT (master_product_id, erp_sku) DO UPDATE
           SET price = CASE
                 WHEN $18 THEN product_variants.price
                 WHEN $7 IS NULL THEN product_variants.price
                 ELSE EXCLUDED.price
               END,
               cost_price = CASE WHEN $18 THEN product_variants.cost_price ELSE EXCLUDED.cost_price END,
               net_weight = COALESCE(product_variants.net_weight, EXCLUDED.net_weight),
               gross_weight = COALESCE(product_variants.gross_weight, EXCLUDED.gross_weight),
               width = COALESCE(product_variants.width, EXCLUDED.width),
               height = COALESCE(product_variants.height, EXCLUDED.height),
               depth = COALESCE(product_variants.depth, EXCLUDED.depth),
               is_active = EXCLUDED.is_active,
               variant_status = EXCLUDED.variant_status,
               last_bling_sync = CASE
                 WHEN $18 THEN product_variants.last_bling_sync
                 WHEN $17 IS NOT NULL THEN $17
                 ELSE now()
               END,
               updated_at = now()
         RETURNING id`,
        [
          masterProductId,
          v.bling_variant_id,
          v.erp_sku,
          v.is_default,
          v.product_format,
          v.stock_mode,
          price,
          v.cost_price,
          v.net_weight,
          v.gross_weight,
          v.width,
          v.height,
          v.depth,
          v.ean,
          v.is_active,
          v.variant_status,
          changedAt ? changedAt.toISOString() : null,
          stale,
        ]
      );

      const variantId = varRes.rows[0]!.id;
      variantIdsBySku[v.erp_sku] = variantId;

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

/** Nome antigo. O cadastro novo entra por upsertCatalogProduct. */
export const upsertCatalogProductFromBlingPayload = upsertCatalogProduct;

/**
 * Estoque de exibição do catálogo: soma virtual dos depósitos que não são Full nem avaria.
 * Nunca é enviado aos canais; o envio usa product_variants.stock.
 */
export function catalogStockFromBalances(
  balanceItem: StockBalanceItem,
  warehouses: WarehouseConfig[]
): number {
  const hidden = new Set(
    warehouses
      .filter((row) => row.role === 'ml_full' || row.role === 'damaged')
      .map((row) => row.bling_warehouse_id)
  );
  const depositos = balanceItem.depositos ?? [];
  if (depositos.length === 0) {
    return Number(balanceItem.saldoVirtualTotal ?? 0);
  }
  const sum = depositos
    .filter((row) => !hidden.has(String(row.id)))
    .reduce((total, row) => total + Number(row.saldoVirtual ?? 0), 0);
  return Number(sum.toFixed(3));
}

/**
 * Aplica a leitura de GET /estoques/saldos para uma variante (Seção 10.7):
 * - Grava variant_stock_balances por depósito.
 * - Na mesma transação, grava product_variants.stock com a soma apenas dos depósitos seller com include_in_push = true
 *   e product_variants.catalog_stock com a soma de exibição.
 */
export async function applyVariantStockBalancesFromBling(
  variantId: string,
  balanceItem: StockBalanceItem,
  observedAt?: Date | null
): Promise<{
  variantStockColumn: number;
  publishableFloor: number;
}> {
  return withTransaction(async (client: PoolClient) => {
    if (observedAt) {
      const current = await client.query<{ last_bling_sync: Date | null; stock: string | null }>(
        `SELECT mp.last_bling_sync, pv.stock::text AS stock
         FROM product_variants pv
         INNER JOIN master_products mp ON mp.id = pv.master_product_id
         WHERE pv.id = $1`,
        [variantId]
      );
      const row = current.rows[0];
      if (row && isNewerHubSync(observedAt, row.last_bling_sync)) {
        const kept = row.stock === null ? 0 : Number(row.stock);
        return { variantStockColumn: kept, publishableFloor: kept };
      }
    }
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

    const catalogStock = catalogStockFromBalances(balanceItem, whRes.rows);
    await client.query(
      `UPDATE product_variants
       SET stock = $2,
           catalog_stock = $3,
           updated_at = now()
       WHERE id = $1`,
      [variantId, computed.variantStockColumn, catalogStock]
    );

    return {
      variantStockColumn: computed.variantStockColumn,
      publishableFloor: computed.publishableFloor,
    };
  });
}

export interface FullProductEnrichmentPipelineInput {
  inboundPayload: InboundProduct;
  stockBalancesBySku?: Record<string, StockBalanceItem>;
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
  const upserted = await upsertCatalogProduct(input.inboundPayload);
  if (upserted.ignoredService || !upserted.masterProductId) {
    throw new Error('Serviço ignorado não entra no pipeline de catálogo');
  }

  const masterProductId = upserted.masterProductId;
  const observedAt = blingChangedAt(input.inboundPayload);

  // Saldos de depósito e preços de loja
  if (input.stockBalancesBySku) {
    for (const [sku, bal] of Object.entries(input.stockBalancesBySku)) {
      const varId = upserted.variantIdsBySku[sku];
      if (varId) {
        await applyVariantStockBalancesFromBling(varId, bal, observedAt);
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
  pushReports: PushJobReport[];
  executedChannelCalls: PushChannelCall[];
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
  freshBalanceItem: StockBalanceItem;
}): Promise<P1StockEndToEndLagMeasurement> {
  await loadConnectors();
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

  const pushReports: PushJobReport[] = [];
  const executedChannelCalls: PushChannelCall[] = [];

  for (const platform of ['mercadolivre', 'nuvemshop'] as const) {
    const { pushJobId } = await pushPort().enqueueOrPromotePushJob({
      masterProductId: input.masterProductId,
      variantId: input.variantId,
      platform,
      jobKind: 'STOCK_PRICE',
      priority: 'P1',
      changedFields: ['stock'],
    });

    const stepStartMs = Date.now();
    const report = await pushPort().executePushJobById(pushJobId, {
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
): Promise<PushJobReport> {
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

  await loadConnectors();
  return pushPort().executePushJobById(pushJobId);
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
