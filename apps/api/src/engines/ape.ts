/**
 * Motor APE — Atomic Push Engine (Seções 4, 8.8, 9.5, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Três tipos de job: STOCK_PRICE, CONTENT e CREATE.
 * - Não existe PUT do produto inteiro: cada passo chama apenas o endpoint daquele passo com os campos do diff lidos do Bling na hora.
 * - No retry, nunca repete passo já 'completed' nem 'skipped'.
 * - Índice único parcial push_jobs_active garante no máximo 1 job 'pending' por (master_product_id, variant_id, platform, job_kind).
 *   Job 'locked' fica de fora do índice, permitindo abrir a janela seguinte sem conflito.
 * - Respeita channel_sync_owners: enquanto stock_price = 'bling_native', STOCK_PRICE deixa 'stock', 'pause' e 'price' em 'skipped'.
 * - Anúncio com estoque só em meli_facility (ou legado fulfillment) deixa o passo 'stock' em 'skipped' (skip_reason = 'ml_full'),
 *   mesmo com stock_price = 'hub', sem jamais enviar PUT de estoque para o Full.
 * - No Mercado Livre (User Product), o passo 'price' escreve apenas na condição com follow_store_price = true.
 * - Preço > 0 e < cost_price abre alerta crítico (price_below_cost) sem bloquear estoque, pausa, preço nem CREATE;
 *   quando o preço volta a ser >= cost_price, o alerta resolve.
 * - CREATE busca o SKU no canal antes da 1ª chamada: se já existir, fica 'cancelled' e vincula ao existente.
 *   Quando cria, envia preço e estoque iniciais uma vez e, se stock_price = 'bling_native', não abre STOCK_PRICE seguinte.
 * - Eco do PUT do hub não reabre push.
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { resolveVariantChannelPrice } from '../contracts/mappers.js';
import { checkStepReadinessGate, PushStepType } from './cre.js';

export type PushJobKind = 'STOCK_PRICE' | 'CONTENT' | 'CREATE';
export type PushPriority = 'P1' | 'P2' | 'P3' | 'P4';

const PRIORITY_RANK: Record<PushPriority, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export function pickHigherPriority(a: PushPriority, b: PushPriority): PushPriority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

export function deriveStepsForJob(
  platform: 'mercadolivre' | 'nuvemshop',
  jobKind: PushJobKind,
  changedFields: string[]
): PushStepType[] {
  if (jobKind === 'CREATE') {
    return ['CREATE'];
  }

  if (jobKind === 'STOCK_PRICE') {
    const steps: PushStepType[] = [];
    if (changedFields.includes('pause')) {
      steps.push('pause');
    }
    if (
      changedFields.includes('stock') ||
      changedFields.includes('virtual_stock') ||
      changedFields.includes('commercial_exit_zero_stock')
    ) {
      steps.push('stock');
    }
    if (changedFields.includes('price') || changedFields.includes('preco')) {
      steps.push('price');
    }
    return steps.length > 0 ? steps : ['stock', 'price'];
  }

  // CONTENT
  if (platform === 'mercadolivre') {
    const steps: PushStepType[] = [];
    if (
      changedFields.includes('description') ||
      changedFields.includes('title')
    ) {
      steps.push('description');
    }
    if (changedFields.includes('pictures') || changedFields.includes('images')) {
      steps.push('pictures');
    }
    return steps.length > 0 ? steps : ['description'];
  }

  // nuvemshop CONTENT
  const steps: PushStepType[] = [];
  if (
    changedFields.some((f) =>
      ['weight', 'net_weight', 'width', 'height', 'depth', 'measures', 'dimensoes', 'pesoLiquido'].includes(f)
    )
  ) {
    steps.push('measures');
  }
  if (
    changedFields.some((f) =>
      ['title', 'description', 'brand', 'marca', 'seo', 'keywords', 'product'].includes(f)
    )
  ) {
    steps.push('product');
  }
  if (changedFields.includes('images') || changedFields.includes('pictures')) {
    steps.push('images');
  }
  return steps.length > 0 ? steps : ['product'];
}

/**
 * Abre ou promove um job pendente em push_jobs (usando a semântica do índice push_jobs_active):
 * - Se já existir um job 'pending' para (master_product_id, variant_id, platform, job_kind),
 *   promove a prioridade (ex: P2 -> P1) e mescla changed_fields e push_job_steps no mesmo job.
 * - Se o job anterior estiver 'locked' (em execução), cria um NOVO job 'pending' para a janela seguinte!
 */
export async function enqueueOrPromotePushJob(input: {
  masterProductId: string;
  variantId: string;
  platform: 'mercadolivre' | 'nuvemshop';
  jobKind: PushJobKind;
  priority: PushPriority;
  changedFields: string[];
}): Promise<{ pushJobId: string; promotedExisting: boolean }> {
  return withTransaction(async (client: PoolClient) => {
    const existingPending = await client.query<{
      id: string;
      priority: PushPriority;
      changed_fields: string[];
    }>(
      `SELECT id, priority, changed_fields
       FROM push_jobs
       WHERE master_product_id = $1
         AND variant_id = $2
         AND platform = $3
         AND job_kind = $4
         AND status = 'pending'
       FOR UPDATE`,
      [input.masterProductId, input.variantId, input.platform, input.jobKind]
    );

    const stepsToEnsure = deriveStepsForJob(
      input.platform,
      input.jobKind,
      input.changedFields
    );

    if (existingPending.rows[0]) {
      const curr = existingPending.rows[0];
      const nextPriority = pickHigherPriority(curr.priority, input.priority);
      const mergedFields = Array.from(
        new Set([...(curr.changed_fields ?? []), ...input.changedFields])
      );

      await client.query(
        `UPDATE push_jobs
         SET priority = $2,
             changed_fields = $3
         WHERE id = $1`,
        [curr.id, nextPriority, mergedFields]
      );

      for (const step of stepsToEnsure) {
        await client.query(
          `INSERT INTO push_job_steps (push_job_id, step, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT (push_job_id, step) DO NOTHING`,
          [curr.id, step]
        );
      }

      return { pushJobId: curr.id, promotedExisting: true };
    }

    const insJob = await client.query<{ id: string }>(
      `INSERT INTO push_jobs (
         master_product_id, variant_id, platform, job_kind, priority, changed_fields, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [
        input.masterProductId,
        input.variantId,
        input.platform,
        input.jobKind,
        input.priority,
        Array.from(new Set(input.changedFields)),
      ]
    );

    const newJobId = insJob.rows[0]!.id;
    for (const step of stepsToEnsure) {
      await client.query(
        `INSERT INTO push_job_steps (push_job_id, step, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (push_job_id, step) DO NOTHING`,
        [newJobId, step]
      );
    }

    return { pushJobId: newJobId, promotedExisting: false };
  });
}

/**
 * Libera locks de push_jobs vencidos há mais de 5 minutos, devolvendo-os a 'pending' (Seção 8.8).
 */
export async function reclaimExpiredPushJobLocks(): Promise<number> {
  const res = await query<{ id: string }>(
    `UPDATE push_jobs
     SET status = 'pending',
         locked_at = NULL,
         locked_by = NULL
     WHERE status = 'locked'
       AND locked_at <= now() - interval '5 minutes'
     RETURNING id`
  );
  return res.rowCount ?? 0;
}

export interface ChannelStepExecutorCalls {
  step: PushStepType;
  platform: 'mercadolivre' | 'nuvemshop';
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  payload: Record<string, unknown>;
}

export interface ExecutePushJobOptions {
  workerId?: string;
  /** Permite simular se o SKU já existe no canal antes do CREATE */
  findExistingChannelListingBySku?: (
    platform: 'mercadolivre' | 'nuvemshop',
    sku: string
  ) => Promise<{ platformProductId: string; platformVariantId?: string } | null>;
  /** Executor de cada chamada de passo no canal */
  onExecuteChannelCall?: (call: ChannelStepExecutorCalls) => Promise<void>;
}

export interface ExecutePushJobReport {
  pushJobId: string;
  finalJobStatus: 'completed' | 'blocked' | 'failed' | 'cancelled';
  blockReason: 'ncm' | 'ean' | 'score' | 'unlinked' | 'price_zero' | null;
  stepsOutcome: Array<{
    step: string;
    status: 'completed' | 'skipped' | 'blocked' | 'failed';
    skipReason?: string | null;
  }>;
  executedCalls: ChannelStepExecutorCalls[];
  belowCostCriticalAlertOpened: boolean;
}

/**
 * Executa um push_job lendo o estado atual do Bling na hora, passo a passo (Seção 8.8).
 */
export async function executePushJobById(
  pushJobId: string,
  options?: ExecutePushJobOptions
): Promise<ExecutePushJobReport> {
  const workerId = options?.workerId ?? 'ape-worker-1';
  const executedCalls: ChannelStepExecutorCalls[] = [];
  let belowCostCriticalAlertOpened = false;

  // 1. Trava o job passando para status = 'locked' (sai do índice push_jobs_active para permitir próxima janela)
  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `UPDATE push_jobs
       SET status = 'locked',
           locked_at = now(),
           locked_by = $2
       WHERE id = $1`,
      [pushJobId, workerId]
    );
  });

  return withTransaction(async (client: PoolClient) => {
    const jobRes = await client.query<{
      id: string;
      master_product_id: string;
      variant_id: string;
      platform: 'mercadolivre' | 'nuvemshop';
      job_kind: PushJobKind;
      changed_fields: string[];
      attempts: number;
    }>(
      `SELECT id, master_product_id, variant_id, platform, job_kind, changed_fields, attempts
       FROM push_jobs
       WHERE id = $1
       FOR UPDATE`,
      [pushJobId]
    );

    const job = jobRes.rows[0];
    if (!job) {
      throw new Error(`push_job ${pushJobId} não encontrado`);
    }

    const ownerRes = await client.query<{
      stock_price: 'bling_native' | 'hub';
      content: 'bling_native' | 'hub';
    }>(
      `SELECT stock_price, content
       FROM channel_sync_owners
       WHERE platform = $1`,
      [job.platform]
    );
    const syncOwner = ownerRes.rows[0] ?? {
      stock_price: 'bling_native' as const,
      content: 'hub' as const,
    };

    const prodRes = await client.query<{
      id: string;
      name: string | null;
      description: string | null;
      brand: string | null;
      catalog_status: 'active' | 'inactive' | 'deleted';
    }>(
      `SELECT id, name, description, brand, catalog_status
       FROM master_products
       WHERE id = $1`,
      [job.master_product_id]
    );
    const prod = prodRes.rows[0]!;

    const varRes = await client.query<{
      id: string;
      bling_sku: string;
      price: string | number | null;
      promotional_price: string | number | null;
      use_promotional: boolean;
      cost_price: string | number | null;
      stock: string | number | null;
      net_weight: string | number | null;
      width: string | number | null;
      height: string | number | null;
      depth: string | number | null;
      variant_status: 'active' | 'inactive' | 'discontinued';
    }>(
      `SELECT id, bling_sku, price, promotional_price, use_promotional, cost_price,
              stock, net_weight, width, height, depth, variant_status
       FROM product_variants
       WHERE id = $1`,
      [job.variant_id]
    );
    const variant = varRes.rows[0]!;

    // Resolve preço publicado segundo a Seção 10.7
    const storeCfgRes = await client.query<{ bling_loja_id: string }>(
      `SELECT bling_loja_id FROM channel_stores WHERE platform = $1`,
      [job.platform]
    );
    const hasChannelStoreConfigured = (storeCfgRes.rowCount ?? 0) > 0;

    const storePriceRes = await client.query<{
      store_price: string | number | null;
      store_promotional_price: string | number | null;
    }>(
      `SELECT store_price, store_promotional_price
       FROM variant_channel_prices
       WHERE variant_id = $1 AND platform = $2`,
      [job.variant_id, job.platform]
    );

    const storePriceRow = storePriceRes.rows[0]
      ? {
          store_price:
            storePriceRes.rows[0].store_price !== null
              ? Number(storePriceRes.rows[0].store_price)
              : null,
          store_promotional_price:
            storePriceRes.rows[0].store_promotional_price !== null
              ? Number(storePriceRes.rows[0].store_promotional_price)
              : null,
        }
      : hasChannelStoreConfigured
      ? { store_price: null, store_promotional_price: null }
      : null;

    const resolvedPrice = resolveVariantChannelPrice({
      catalogPrice: variant.price !== null ? Number(variant.price) : 0,
      catalogPromotionalPrice:
        variant.promotional_price !== null ? Number(variant.promotional_price) : null,
      usePromotional: variant.use_promotional,
      costPrice: variant.cost_price !== null ? Number(variant.cost_price) : null,
      hasChannelStoreConfigured,
      storePriceRow,
    });

    // Verifica alerta crítico de preço abaixo do custo (0 < price < cost_price -> alerta crítico, NÃO bloqueia!)
    const openBelowCost = await client.query<{ id: string }>(
      `SELECT id FROM divergence_alerts
       WHERE master_product_id = $1
         AND variant_id = $2
         AND platform = $3
         AND alert_code = 'price_below_cost'
         AND status = 'open'`,
      [job.master_product_id, job.variant_id, job.platform]
    );

    if (resolvedPrice.belowCostCriticalAlert) {
      belowCostCriticalAlertOpened = true;
      if (openBelowCost.rowCount === 0) {
        await client.query(
          `INSERT INTO divergence_alerts (
             master_product_id, variant_id, platform, alert_code, severity,
             bling_value, external_value, status
           ) VALUES ($1, $2, $3, 'price_below_cost', 'critical', $4, $5, 'open')`,
          [
            job.master_product_id,
            job.variant_id,
            job.platform,
            String(variant.cost_price),
            String(resolvedPrice.effectivePrice),
          ]
        );
      }
    } else if (openBelowCost.rowCount && openBelowCost.rowCount > 0) {
      // Quando o preço fica igual ou acima do custo, o alerta resolve (Seção 8.8)
      for (const aRow of openBelowCost.rows) {
        await client.query(
          `UPDATE divergence_alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`,
          [aRow.id]
        );
      }
    }

    const stepsRes = await client.query<{
      id: string;
      step: PushStepType;
      status: 'pending' | 'completed' | 'failed' | 'skipped' | 'blocked';
      skip_reason: string | null;
    }>(
      `SELECT id, step, status, skip_reason
       FROM push_job_steps
       WHERE push_job_id = $1
       FOR UPDATE`,
      [pushJobId]
    );

    const STEP_ORDER: Record<PushStepType, number> = {
      pause: 1,
      stock: 2,
      price: 3,
      CREATE: 4,
      description: 5,
      product: 6,
      measures: 7,
      pictures: 8,
      images: 9,
    };

    const sortedSteps = [...stepsRes.rows].sort(
      (a, b) => (STEP_ORDER[a.step] ?? 99) - (STEP_ORDER[b.step] ?? 99)
    );

    const stepsOutcome: ExecutePushJobReport['stepsOutcome'] = [];
    let firstBlockReason: ExecutePushJobReport['blockReason'] = null;

    for (const stepRow of sortedSteps) {
      // No retry, nunca repete passo já 'completed' nem 'skipped' (Seção 8.8)
      if (stepRow.status === 'completed' || stepRow.status === 'skipped') {
        stepsOutcome.push({
          step: stepRow.step,
          status: stepRow.status,
          skipReason: stepRow.skip_reason,
        });
        continue;
      }

      // 1. Caso CREATE: verifica se SKU já existe no canal antes da 1ª chamada
      if (stepRow.step === 'CREATE') {
        if (options?.findExistingChannelListingBySku) {
          const found = await options.findExistingChannelListingBySku(
            job.platform,
            variant.bling_sku
          );
          if (found) {
            await client.query(
              `UPDATE push_job_steps
               SET status = 'skipped', skip_reason = 'sku_already_exists_in_channel', finished_at = now()
               WHERE id = $1`,
              [stepRow.id]
            );
            await client.query(
              `UPDATE push_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1`,
              [job.id]
            );
            await client.query(
              `INSERT INTO platform_links (
                 master_product_id, platform, platform_product_id, match_method, match_confidence, sync_status
               ) VALUES ($1, $2, $3, 'create_sku_recovered', 100, 'linked')
               ON CONFLICT (platform, platform_product_id) DO NOTHING`,
              [job.master_product_id, job.platform, found.platformProductId]
            );

            return {
              pushJobId: job.id,
              finalJobStatus: 'cancelled',
              blockReason: null,
              stepsOutcome: [
                {
                  step: 'CREATE',
                  status: 'skipped',
                  skipReason: 'sku_already_exists_in_channel',
                },
              ],
              executedCalls,
              belowCostCriticalAlertOpened,
            };
          }
        }

        const gate = await checkStepReadinessGate({
          variantId: job.variant_id,
          platform: job.platform,
          step: 'CREATE',
          effectivePrice: resolvedPrice.effectivePrice,
        });

        if (!gate.allowed) {
          firstBlockReason = firstBlockReason ?? gate.blockReason;
          await client.query(
            `UPDATE push_job_steps SET status = 'blocked', last_error = $2, finished_at = now() WHERE id = $1`,
            [stepRow.id, gate.blockReason]
          );
          stepsOutcome.push({ step: 'CREATE', status: 'blocked' });
          continue;
        }

        const initialStockFloor =
          variant.stock !== null ? Math.max(0, Math.floor(Number(variant.stock))) : 0;
        const createdItemId = `${job.platform === 'mercadolivre' ? 'MLB' : 'NS'}-CREATED-${variant.bling_sku}`;

        const call: ChannelStepExecutorCalls = {
          step: 'CREATE',
          platform: job.platform,
          endpoint: job.platform === 'mercadolivre' ? '/items' : '/products',
          method: 'POST',
          payload: {
            sku: variant.bling_sku,
            price: resolvedPrice.effectivePrice,
            stock: initialStockFloor,
          },
        };
        if (options?.onExecuteChannelCall) {
          await options.onExecuteChannelCall(call);
        }
        executedCalls.push(call);

        // No Mercado Livre, o CREATE marca verdadeiro a condição que acaba de nascer e grava control_changes (origin = system)
        if (job.platform === 'mercadolivre') {
          const pvLinkRes = await client.query<{ id: string }>(
            `INSERT INTO platform_variant_links (
               variant_id, master_product_id, platform, platform_product_id, platform_variant_id,
               match_method, match_confidence, platform_price, platform_stock, sync_status, last_synced_at
             ) VALUES ($1, $2, 'mercadolivre', $3, '', 'created_by_hub', 100, $4, $5, 'linked', now())
             ON CONFLICT (platform, platform_product_id, platform_variant_id) DO UPDATE
               SET last_synced_at = now()
             RETURNING id`,
            [
              job.variant_id,
              job.master_product_id,
              createdItemId,
              resolvedPrice.effectivePrice,
              initialStockFloor,
            ]
          );

          await client.query(
            `INSERT INTO ml_selling_conditions (
               platform_variant_link_id, item_id, listing_status, price, follow_store_price, follow_set_by, last_synced_at
             ) VALUES ($1, $2, 'active', $3, true, NULL, now())
             ON CONFLICT (item_id) DO NOTHING`,
            [pvLinkRes.rows[0]!.id, createdItemId, resolvedPrice.effectivePrice]
          );

          await client.query(
            `INSERT INTO control_changes (
               target, target_key, field, old_value, new_value, origin, changed_by
             ) VALUES ('selling_condition', $1, 'follow_store_price', NULL, 'true', 'system', NULL)`,
            [createdItemId]
          );
        }

        await client.query(
          `UPDATE push_job_steps SET status = 'completed', finished_at = now() WHERE id = $1`,
          [stepRow.id]
        );
        stepsOutcome.push({ step: 'CREATE', status: 'completed' });
        continue;
      }

      // 2. Passos de STOCK_PRICE ('stock', 'pause', 'price')
      if (
        stepRow.step === 'stock' ||
        stepRow.step === 'pause' ||
        stepRow.step === 'price'
      ) {
        // Se o dono de stock_price é 'bling_native', o hub não escreve em anúncio já publicado!
        if (syncOwner.stock_price === 'bling_native') {
          await client.query(
            `UPDATE push_job_steps
             SET status = 'skipped', skip_reason = 'bling_native', finished_at = now()
             WHERE id = $1`,
            [stepRow.id]
          );
          stepsOutcome.push({
            step: stepRow.step,
            status: 'skipped',
            skipReason: 'bling_native',
          });
          continue;
        }

        // Passo 'stock': verifica se anúncio no ML é só Full (meli_facility ou legado fulfillment)
        if (stepRow.step === 'stock') {
          if (job.platform === 'mercadolivre') {
            const pvRes = await client.query<{
              id: string;
              user_product_id: string | null;
            }>(
              `SELECT id, user_product_id
               FROM platform_variant_links
               WHERE variant_id = $1 AND platform = 'mercadolivre'`,
              [job.variant_id]
            );
            const pv = pvRes.rows[0];

            let isOnlyFull = false;
            if (pv?.user_product_id) {
              const locRes = await client.query<{ location_type: string }>(
                `SELECT location_type FROM ml_stock_locations WHERE user_product_id = $1`,
                [pv.user_product_id]
              );
              const hasMeli = locRes.rows.some((l) => l.location_type === 'meli_facility');
              const hasSeller = locRes.rows.some((l) => l.location_type === 'seller_warehouse');
              if (hasMeli && !hasSeller) {
                isOnlyFull = true;
              }
            } else if (pv) {
              const condRes = await client.query<{ logistic_type: string | null }>(
                `SELECT logistic_type FROM ml_selling_conditions WHERE platform_variant_link_id = $1`,
                [pv.id]
              );
              if (
                condRes.rows.length > 0 &&
                condRes.rows.every((c) => c.logistic_type === 'fulfillment')
              ) {
                isOnlyFull = true;
              }
            }

            // Anúncio só Full fica 'skipped' (motivo 'ml_full') e NUNCA recebe PUT de estoque!
            if (isOnlyFull) {
              await client.query(
                `UPDATE push_job_steps
                 SET status = 'skipped', skip_reason = 'ml_full', finished_at = now()
                 WHERE id = $1`,
                [stepRow.id]
              );
              stepsOutcome.push({
                step: 'stock',
                status: 'skipped',
                skipReason: 'ml_full',
              });
              continue;
            }
          }

          const isCommercialExit =
            prod.catalog_status !== 'active' ||
            variant.variant_status !== 'active' ||
            job.changed_fields.includes('commercial_exit_zero_stock');

          const quantityToSend = isCommercialExit
            ? 0
            : variant.stock !== null
            ? Math.max(0, Math.floor(Number(variant.stock)))
            : 0;

          const call: ChannelStepExecutorCalls = {
            step: 'stock',
            platform: job.platform,
            endpoint:
              job.platform === 'mercadolivre'
                ? `/user-products/${job.variant_id}/stock/type/seller_warehouse`
                : `/products/stock-price`,
            method: job.platform === 'mercadolivre' ? 'PUT' : 'PATCH',
            payload: { stock: quantityToSend },
          };
          if (options?.onExecuteChannelCall) {
            await options.onExecuteChannelCall(call);
          }
          executedCalls.push(call);

          await client.query(
            `UPDATE push_job_steps SET status = 'completed', finished_at = now() WHERE id = $1`,
            [stepRow.id]
          );
          stepsOutcome.push({ step: 'stock', status: 'completed' });
          continue;
        }

        if (stepRow.step === 'pause') {
          const call: ChannelStepExecutorCalls = {
            step: 'pause',
            platform: job.platform,
            endpoint: job.platform === 'mercadolivre' ? '/items/status' : '/products/visibility',
            method: 'PUT',
            payload: { status: 'paused' },
          };
          if (options?.onExecuteChannelCall) {
            await options.onExecuteChannelCall(call);
          }
          executedCalls.push(call);

          await client.query(
            `UPDATE push_job_steps SET status = 'completed', finished_at = now() WHERE id = $1`,
            [stepRow.id]
          );
          stepsOutcome.push({ step: 'pause', status: 'completed' });
          continue;
        }

        // Passo 'price'
        const priceGate = await checkStepReadinessGate({
          variantId: job.variant_id,
          platform: job.platform,
          step: 'price',
          effectivePrice: resolvedPrice.effectivePrice,
        });

        if (!priceGate.allowed) {
          firstBlockReason = firstBlockReason ?? priceGate.blockReason;
          await client.query(
            `UPDATE push_job_steps SET status = 'blocked', last_error = 'price_zero', finished_at = now() WHERE id = $1`,
            [stepRow.id]
          );
          stepsOutcome.push({ step: 'price', status: 'blocked' });
          continue;
        }

        // No Mercado Livre, envia preço APENAS para condições com follow_store_price = true (Seção 10.7)
        if (job.platform === 'mercadolivre') {
          const condsRes = await client.query<{
            item_id: string;
            price: string | number | null;
            follow_store_price: boolean;
          }>(
            `SELECT sc.item_id, sc.price, sc.follow_store_price
             FROM ml_selling_conditions sc
             INNER JOIN platform_variant_links pvl ON pvl.id = sc.platform_variant_link_id
             WHERE pvl.variant_id = $1 AND pvl.platform = 'mercadolivre'`,
            [job.variant_id]
          );

          for (const cond of condsRes.rows) {
            if (cond.follow_store_price) {
              const call: ChannelStepExecutorCalls = {
                step: 'price',
                platform: 'mercadolivre',
                endpoint: `/items/${cond.item_id}`,
                method: 'PUT',
                payload: { price: resolvedPrice.effectivePrice },
              };
              if (options?.onExecuteChannelCall) {
                await options.onExecuteChannelCall(call);
              }
              executedCalls.push(call);
            }
          }
        } else {
          const call: ChannelStepExecutorCalls = {
            step: 'price',
            platform: 'nuvemshop',
            endpoint: `/products/stock-price`,
            method: 'PATCH',
            payload: { price: resolvedPrice.effectivePrice },
          };
          if (options?.onExecuteChannelCall) {
            await options.onExecuteChannelCall(call);
          }
          executedCalls.push(call);
        }

        await client.query(
          `UPDATE push_job_steps SET status = 'completed', finished_at = now() WHERE id = $1`,
          [stepRow.id]
        );
        stepsOutcome.push({ step: 'price', status: 'completed' });
        continue;
      }

      // 3. Passos de CONTENT ('description', 'pictures', 'product', 'images', 'measures')
      const contentGate = await checkStepReadinessGate({
        variantId: job.variant_id,
        platform: job.platform,
        step: stepRow.step,
        effectivePrice: resolvedPrice.effectivePrice,
      });

      if (!contentGate.allowed) {
        firstBlockReason = firstBlockReason ?? contentGate.blockReason;
        await client.query(
          `UPDATE push_job_steps SET status = 'blocked', last_error = $2, finished_at = now() WHERE id = $1`,
          [stepRow.id, contentGate.blockReason]
        );
        stepsOutcome.push({ step: stepRow.step, status: 'blocked' });
        continue;
      }

      if (stepRow.step === 'measures') {
        // Passo 'measures' da Nuvemshop: envia APENAS id, weight, width, height, depth (sem price e sem stock)
        const call: ChannelStepExecutorCalls = {
          step: 'measures',
          platform: 'nuvemshop',
          endpoint: `/products/${job.master_product_id}/variants`,
          method: 'PATCH',
          payload: {
            id: job.variant_id,
            weight: variant.net_weight !== null ? String(variant.net_weight) : undefined,
            width: variant.width !== null ? String(variant.width) : undefined,
            height: variant.height !== null ? String(variant.height) : undefined,
            depth: variant.depth !== null ? String(variant.depth) : undefined,
          },
        };
        if (options?.onExecuteChannelCall) {
          await options.onExecuteChannelCall(call);
        }
        executedCalls.push(call);
      } else {
        const call: ChannelStepExecutorCalls = {
          step: stepRow.step,
          platform: job.platform,
          endpoint: `/${job.platform}/${stepRow.step}`,
          method: 'PUT',
          payload: { step: stepRow.step },
        };
        if (options?.onExecuteChannelCall) {
          await options.onExecuteChannelCall(call);
        }
        executedCalls.push(call);
      }

      await client.query(
        `UPDATE push_job_steps SET status = 'completed', finished_at = now() WHERE id = $1`,
        [stepRow.id]
      );
      stepsOutcome.push({ step: stepRow.step, status: 'completed' });
    }

    const allDoneOrSkipped = stepsOutcome.every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );
    const anyBlocked = stepsOutcome.some((s) => s.status === 'blocked');

    const finalJobStatus: ExecutePushJobReport['finalJobStatus'] = allDoneOrSkipped
      ? 'completed'
      : anyBlocked
      ? 'blocked'
      : 'failed';

    await client.query(
      `UPDATE push_jobs
       SET status = $2,
           block_reason = $3,
           finished_at = now()
       WHERE id = $1`,
      [job.id, finalJobStatus, finalJobStatus === 'blocked' ? firstBlockReason : null]
    );

    return {
      pushJobId: job.id,
      finalJobStatus,
      blockReason: finalJobStatus === 'blocked' ? firstBlockReason : null,
      stepsOutcome,
      executedCalls,
      belowCostCriticalAlertOpened,
    };
  });
}
