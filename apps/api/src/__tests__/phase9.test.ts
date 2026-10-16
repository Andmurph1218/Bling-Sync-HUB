import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  enqueueOrPromotePushJob,
  executePushJobById,
} from '../engines/ape.js';
import {
  ingestWebhookController,
  processWebhookEventById,
} from '../engines/wig.js';

function signHmac(rawPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawPayload, 'utf8').digest('hex');
}

describe('Fase 9 — Motor de Push Atômico APE (Sem PUT Completo, Eco do PUT Não Reabre Push, Anúncio Só Full Não Recebe PUT de Estoque, Bloqueio por Passo e Alerta Abaixo do Custo)', () => {
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
    const mem = newDb();

    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.trim() : ''),
    });

    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });

    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);

    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. Critério de saída A: Anúncio só Full (meli_facility) fica com passo stock em skipped (motivo ml_full) e NÃO recebe PUT de estoque, mas atualiza preço apenas na condição com follow_store_price = true', async () => {
    // Passa o Mercado Livre para stock_price = 'hub'
    await query(
      `UPDATE channel_sync_owners SET stock_price = 'hub', content = 'hub' WHERE platform = 'mercadolivre'`
    );

    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, bling_tipo, bling_formato,
         ncm, ncm_status, ncm_fiscal_risk
       ) VALUES ('9001', 'GAR-FULL-ONLY', 'Garrafa Full Mercado Livre', 'P', 'S', '96170010', 'valid', false)
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_sku, is_default, bling_formato,
         price, cost_price, stock, ean, ean_status, fiscal_risk_flag
       ) VALUES ($1, 'GAR-FULL-ONLY', true, 'S', 99.90, 45.00, 20, '7891234567895', 'valid', false)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    await query(
      `INSERT INTO variant_channel_prices (variant_id, platform, store_price, store_promotional_price)
       VALUES ($1, 'mercadolivre', 109.90, NULL)`,
      [variantId]
    );

    await query(
      `INSERT INTO platform_links (
         master_product_id, platform, platform_product_id, match_method,
         match_confidence, ml_model, family_id, family_confidence, sync_status
       ) VALUES ($1, 'mercadolivre', 'MLBF-FULL-9001', 'auto_family_multi_signal', 95, 'user_product', 'MLBF-FULL-9001', 95, 'linked')`,
      [masterId]
    );

    const pvlRes = await query<{ id: string }>(
      `INSERT INTO platform_variant_links (
         variant_id, master_product_id, platform, platform_product_id,
         platform_variant_id, user_product_id, match_method, match_confidence, sync_status
       ) VALUES ($1, $2, 'mercadolivre', 'MLBF-FULL-9001', 'MLBU-FULL-ONLY-1', 'MLBU-FULL-ONLY-1', 'sku', 95, 'linked')
       RETURNING id`,
      [variantId, masterId]
    );
    const pvlId = pvlRes.rows[0]!.id;

    // Duas condições de venda: apenas MLB-COND-FOLLOW tem follow_store_price = true
    await query(
      `INSERT INTO ml_selling_conditions (
         platform_variant_link_id, item_id, listing_status, price, follow_store_price
       ) VALUES
         ($1, 'MLB-COND-FOLLOW', 'active', 99.90, true),
         ($1, 'MLB-COND-INDEPENDENT', 'active', 119.90, false)`,
      [pvlId]
    );

    // Estoque do User Product está APENAS em meli_facility (Full)
    await query(
      `INSERT INTO ml_stock_locations (user_product_id, location_type, store_id, network_node_id, quantity, stock_version)
       VALUES ('MLBU-FULL-ONLY-1', 'meli_facility', '', '', 55, 4)`
    );

    const { pushJobId } = await enqueueOrPromotePushJob({
      masterProductId: masterId,
      variantId,
      platform: 'mercadolivre',
      jobKind: 'STOCK_PRICE',
      priority: 'P1',
      changedFields: ['stock', 'price'],
    });

    const report = await executePushJobById(pushJobId);
    expect(report.finalJobStatus).toBe('completed');

    // Passo 'stock' ficou skipped com motivo 'ml_full' e NENHUM PUT de estoque foi emitido!
    expect(report.stepsOutcome).toEqual([
      { step: 'stock', status: 'skipped', skipReason: 'ml_full' },
      { step: 'price', status: 'completed' },
    ]);

    expect(report.executedCalls).toHaveLength(1);
    expect(report.executedCalls[0]).toEqual({
      step: 'price',
      platform: 'mercadolivre',
      endpoint: '/items/MLB-COND-FOLLOW',
      method: 'PUT',
      payload: { price: 109.9 },
    });
  });

  it('2. Critério de saída B: Eco do PUT do hub concluído em push_job_steps não reabre novo push quando o webhook de retorno chega', async () => {
    // Pega o push_job_step 'price' que acabou de ser concluído no teste 1
    const completedStepRes = await query<{ id: string }>(
      `SELECT id FROM push_job_steps WHERE step = 'price' AND status = 'completed' LIMIT 1`
    );
    const completedStepId = completedStepRes.rows[0]!.id;

    const jobsBeforeRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM push_jobs`
    );
    const jobsBefore = jobsBeforeRes.rows[0]!.count;

    // Webhook de retorno do Mercado Livre refletindo o PUT recém-concluído pelo hub
    const echoPayload = JSON.stringify({
      topic: 'items',
      resource: '/items/MLB-COND-FOLLOW',
      user_id: 88990011,
      echo_push_job_step_id: completedStepId,
    });

    const mlSecret = 'ml_dev_webhook_secret';
    const ingest = await ingestWebhookController({
      source: 'mercadolivre',
      rawBody: echoPayload,
      signatureHeader: signHmac(echoPayload, mlSecret),
      secret: mlSecret,
    });
    expect(ingest.httpStatus).toBe(200);

    const workerOutcome = await processWebhookEventById(ingest.webhookEventId!);
    expect(workerOutcome.outcome).toBe('ignored_echo');

    // Confirma que nenhum novo push_job foi aberto a partir do eco!
    const jobsAfterRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM push_jobs`
    );
    expect(jobsAfterRes.rows[0]?.count).toBe(jobsBefore);
  });

  it('3. NCM inválido não impede estoque zero nem pausa; preço abaixo do custo gera alerta crítico sem bloquear price; passo measures da Nuvemshop não envia price nem stock', async () => {
    await query(
      `UPDATE channel_sync_owners SET stock_price = 'hub', content = 'hub' WHERE platform = 'nuvemshop'`
    );

    // Produto com NCM inválido ('00000000', ncm_fiscal_risk = true) e preço (39.90) ABAIXO do custo (50.00)!
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, bling_tipo, bling_formato,
         ncm, ncm_status, ncm_fiscal_risk, catalog_status
       ) VALUES ('9002', 'PROD-APE-BELOW-COST', 'Item Inativado com Preço Abaixo do Custo', 'P', 'S', '00000000', 'invalid', true, 'inactive')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_sku, is_default, bling_formato,
         price, cost_price, stock, net_weight, width, height, depth,
         ean, ean_status, fiscal_risk_flag, variant_status
       ) VALUES (
         $1, 'PROD-APE-BELOW-COST', true, 'S',
         39.90, 50.00, 14, 0.45, 10, 20, 15,
         '7891000100011', 'valid', false, 'inactive'
       )
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    await query(
      `INSERT INTO variant_channel_prices (variant_id, platform, store_price, store_promotional_price)
       VALUES ($1, 'nuvemshop', 39.90, NULL)`,
      [variantId]
    );

    await query(
      `INSERT INTO platform_links (
         master_product_id, platform, platform_product_id, match_method, match_confidence, sync_status
       ) VALUES ($1, 'nuvemshop', 'NS-9002', 'auto_multi_signal', 95, 'linked')`,
      [masterId]
    );

    // Enfileira STOCK_PRICE com pause, stock e price:
    // Mesmo com NCM inválido e preço abaixo do custo, TODOS os 3 passos seguem e um alerta crítico price_below_cost é aberto!
    const { pushJobId } = await enqueueOrPromotePushJob({
      masterProductId: masterId,
      variantId,
      platform: 'nuvemshop',
      jobKind: 'STOCK_PRICE',
      priority: 'P2',
      changedFields: ['pause', 'commercial_exit_zero_stock'],
    });

    // Evento P1 seguinte promove o mesmo job pendente para P1 e adiciona 'price'
    const promoted = await enqueueOrPromotePushJob({
      masterProductId: masterId,
      variantId,
      platform: 'nuvemshop',
      jobKind: 'STOCK_PRICE',
      priority: 'P1',
      changedFields: ['price'],
    });
    expect(promoted.promotedExisting).toBe(true);
    expect(promoted.pushJobId).toBe(pushJobId);

    const execReport = await executePushJobById(pushJobId);
    expect(execReport.finalJobStatus).toBe('completed');
    expect(execReport.belowCostCriticalAlertOpened).toBe(true);
    expect(execReport.stepsOutcome).toEqual([
      { step: 'pause', status: 'completed' },
      { step: 'stock', status: 'completed' },
      { step: 'price', status: 'completed' },
    ]);

    // Confirma que a saída comercial enviou stock = 0 no passo, mas product_variants.stock permaneceu 14 no banco!
    const stockCall = execReport.executedCalls.find((c) => c.step === 'stock')!;
    expect(stockCall.payload).toEqual({ stock: 0 });

    const variantStockStill14 = await query<{ stock: string | number }>(
      `SELECT stock FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(Number(variantStockStill14.rows[0]?.stock)).toBe(14);

    // Verifica que o alerta crítico price_below_cost foi aberto
    const alertRes = await query<{ severity: string; status: string }>(
      `SELECT severity, status FROM divergence_alerts
       WHERE master_product_id = $1 AND alert_code = 'price_below_cost'`,
      [masterId]
    );
    expect(alertRes.rows).toEqual([{ severity: 'critical', status: 'open' }]);
  });
});
