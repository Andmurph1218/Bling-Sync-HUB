import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  BLING_KIT_PRODUCT_FIXTURE,
  BLING_SIMPLE_PRODUCT_FIXTURE,
  BLING_STOCK_BALANCES_WITH_ML_FULL_FIXTURE,
  BLING_VARIABLE_PRODUCT_FIXTURE,
  BLING_WEBHOOK_STOCK_FIXTURE,
} from '../contracts/fixtures/bling.fixtures.js';
import {
  executeAndMeasureP1StockFlow,
  getOperationalMetrics,
  replayFailedPushJobById,
  runFullProductCatalogPipeline,
  SLA_P1_STOCK_MAX_LAG_MS,
} from '../orchestrator/pipeline.js';

function signHmacSha256(rawPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawPayload, 'utf8').digest('hex');
}

describe('Fase 12 — Ensaio com Recorte Real do Catálogo e Medição de Lag de Estoque P1 (< 2 minutos)', () => {
  let poolInstance: DbPoolLike;
  const blingSecret = 'bling_dev_webhook_secret';

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

  it('1. Critério de saída: Ensaio com recorte real do catálogo (simples, grade com variação e kit) e lag do job P1 de estoque medido abaixo de 2 minutos', async () => {
    // Passa ambos os canais para stock_price = 'hub' para medir o fluxo P1 de estoque ponta a ponta
    await query(
      `UPDATE channel_sync_owners SET stock_price = 'hub', content = 'hub'
       WHERE platform IN ('mercadolivre', 'nuvemshop')`
    );

    // 1. Executa pipeline para Produto Simples (formato S), Produto com Variações (formato V) e Kit (formato E)
    const simpleRun = await runFullProductCatalogPipeline({
      blingPayload: BLING_SIMPLE_PRODUCT_FIXTURE.data,
      stockBalancesBySku: {
        'GAR-INOX-500-PT': BLING_STOCK_BALANCES_WITH_ML_FULL_FIXTURE.data[0]!,
      },
      storePricesBySku: {
        'GAR-INOX-500-PT': {
          mercadolivre: { store_price: 99.9, store_promotional_price: 94.9 },
          nuvemshop: { store_price: 89.9, store_promotional_price: null },
        },
      },
      nsItem: {
        item: {
          platform: 'nuvemshop',
          platform_product_id: 'NS-REAL-100101',
          title: 'Garrafa Térmica Inox 500ml Preta',
          skus: ['GAR-INOX-500-PT'],
          eans: ['7891234567895'],
        },
        variants: [
          {
            platform_variant_id: 'NS-VAR-100101',
            sku: 'GAR-INOX-500-PT',
            ean: '7891234567895',
            price: 89.9,
            stock: 7,
            raw_attributes: [],
          },
        ],
      },
      imagesToEnqueue: [
        {
          source_url: 'https://org.bling.com.br/imagens/garrafa_inox_1.webp',
          source_platform: 'bling',
        },
      ],
    });

    const variableRun = await runFullProductCatalogPipeline({
      blingPayload: BLING_VARIABLE_PRODUCT_FIXTURE.data,
      mlFamily: {
        familyId: 'MLBF990011',
        familyName: 'Camiseta Dry Fit Performance',
        items: [
          {
            platform: 'mercadolivre',
            platform_product_id: 'MLBF990011',
            item_id: 'MLB5000000001',
            title: 'Camiseta Dry Fit Performance Azul M',
            skus: ['CAM-DRY-AZ-M'],
            eans: ['7891000100011'],
            ml_model: 'user_product',
            family_id: 'MLBF990011',
          },
        ],
        variants: [
          {
            platform_variant_id: 'MLBU100001',
            user_product_id: 'MLBU100001',
            sku: 'CAM-DRY-AZ-M',
            ean: '7891000100011',
            price: 79.9,
            stock: 12,
            raw_attributes: [
              { axisNameOrId: 'COLOR', value: 'Azul' },
              { axisNameOrId: 'SIZE', value: 'M' },
            ],
            selling_conditions: [
              { item_id: 'MLB5000000001', listing_status: 'active', price: 79.9 },
              { item_id: 'MLB5000000002', listing_status: 'active', price: 89.9 },
            ],
          },
        ],
      },
    });

    const kitRun = await runFullProductCatalogPipeline({
      blingPayload: BLING_KIT_PRODUCT_FIXTURE.data,
    });

    expect(simpleRun.masterProductId).toBeDefined();
    expect(simpleRun.enqueuedImagesCount).toBe(1);
    expect(variableRun.readinessReport.variants).toHaveLength(2);
    expect(kitRun.readinessReport.variants).toHaveLength(1);

    // 2. Medição do Lag de Estoque P1 ponta a ponta (Webhook WIG -> GET /estoques/saldos -> Push APE em ML e Nuvemshop)
    const simpleVariantId = simpleRun.variantIdsBySku['GAR-INOX-500-PT']!;
    const rawStockWebhook = JSON.stringify(BLING_WEBHOOK_STOCK_FIXTURE);
    const sig = signHmacSha256(rawStockWebhook, blingSecret);

    const lagMeasurement = await executeAndMeasureP1StockFlow({
      rawWebhookBody: rawStockWebhook,
      signatureHeader: sig,
      webhookSecret: blingSecret,
      masterProductId: simpleRun.masterProductId,
      variantId: simpleVariantId,
      freshBalanceItem: {
        produto: { id: 100101 },
        saldoFisicoTotal: 114,
        saldoVirtualTotal: 111,
        depositos: [
          // Depósito seller com include_in_push = true: 11.9 -> floor = 11
          { id: 9001, saldoFisico: 14, saldoVirtual: 11.9 },
          // Depósito ml_full (9099): 100 unidades que ficam 100% fora da soma publicada
          { id: 9099, saldoFisico: 100, saldoVirtual: 100 },
        ],
      },
    });

    expect(lagMeasurement.publishedFloorQuantity).toBe(11);
    expect(lagMeasurement.withinTwoMinuteSla).toBe(true);
    expect(lagMeasurement.measuredLagMs).toBeGreaterThan(0);
    expect(lagMeasurement.measuredLagMs).toBeLessThan(SLA_P1_STOCK_MAX_LAG_MS);
    expect(lagMeasurement.executedChannelCalls).toHaveLength(2);
    expect(
      lagMeasurement.executedChannelCalls.every((c) => c.payload.stock === 11)
    ).toBe(true);

    // 3. Verifica métricas operacionais e replay de job failed sem repetir passo já concluído
    const metrics = await getOperationalMetrics();
    expect(metrics.pushLatencyStats.samplesCount).toBe(2);
    expect(metrics.pushLatencyStats.maxLatencyMs).toBeLessThan(SLA_P1_STOCK_MAX_LAG_MS);

    // Cria um job com 2 passos onde 'stock' já está 'completed' e 'price' está 'failed'
    const failedJobRes = await query<{ id: string }>(
      `INSERT INTO push_jobs (
         master_product_id, variant_id, platform, job_kind, priority, status, attempts
       ) VALUES ($1, $2, 'nuvemshop', 'STOCK_PRICE', 'P1', 'failed', 1)
       RETURNING id`,
      [simpleRun.masterProductId, simpleVariantId]
    );
    const failedJobId = failedJobRes.rows[0]!.id;

    await query(
      `INSERT INTO push_job_steps (push_job_id, step, status, finished_at)
       VALUES
         ($1, 'stock', 'completed', now()),
         ($1, 'price', 'failed', now())`,
      [failedJobId]
    );

    const replayed = await replayFailedPushJobById(failedJobId);
    expect(replayed.finalJobStatus).toBe('completed');
    // O passo 'stock' já estava completed, portanto o replay executou APENAS 1 chamada ('price')!
    expect(replayed.executedCalls).toHaveLength(1);
    expect(replayed.executedCalls[0]?.step).toBe('price');
  });
});
