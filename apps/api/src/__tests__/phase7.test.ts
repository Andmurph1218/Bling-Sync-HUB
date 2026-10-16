import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  calculateProductReadinessCre,
  checkStepReadinessGate,
} from '../engines/cre.js';

describe('Fase 7 — Motor de Prontidão CRE (Três Scores por Variante, KPI da Pior Variante, Top 3 Melhorias e Estoque Não Lê o Score)', () => {
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

  it('1. Critério de saída: O envio de estoque (stock, pause e price de STOCK_PRICE) NUNCA lê o score e segue mesmo com score zero, NCM inválido ou sem linha em channel_readiness_scores', async () => {
    // Produto com NCM inválido, EAN inválido, preço zero e NENHUMA linha em channel_readiness_scores
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, bling_tipo, bling_formato,
         ncm, ncm_status, ncm_fiscal_risk
       ) VALUES ('7001', 'PROD-CRE-BROKEN', 'Item Fiscalmente Quebrado', 'P', 'S', '00000000', 'invalid', true)
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_sku, is_default, bling_formato,
         price, ean, ean_status, fiscal_risk_flag
       ) VALUES ($1, 'PROD-CRE-BROKEN', true, 'S', 0, '0000000000000', 'invalid', true)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    let scoreTableReads = 0;
    const spy = () => {
      scoreTableReads += 1;
    };

    // Passo 'stock' segue ( inclusive estoque zero) e NUNCA lê a tabela de score
    const stockGate = await checkStepReadinessGate({
      variantId,
      platform: 'mercadolivre',
      step: 'stock',
      effectivePrice: 0,
      onScoreTableReadSpy: spy,
    });
    expect(stockGate.allowed).toBe(true);
    expect(stockGate.readScoreTable).toBe(false);
    expect(scoreTableReads).toBe(0);

    // Passo 'pause' segue e NUNCA lê a tabela de score
    const pauseGate = await checkStepReadinessGate({
      variantId,
      platform: 'nuvemshop',
      step: 'pause',
      effectivePrice: 0,
      onScoreTableReadSpy: spy,
    });
    expect(pauseGate.allowed).toBe(true);
    expect(pauseGate.readScoreTable).toBe(false);
    expect(scoreTableReads).toBe(0);

    // Passo 'price' de anúncio já publicado bloqueia apenas quando preço <= 0, mas segue com preço > 0 mesmo com NCM/EAN inválidos e sem ler o score!
    const priceZeroGate = await checkStepReadinessGate({
      variantId,
      platform: 'mercadolivre',
      step: 'price',
      effectivePrice: 0,
      onScoreTableReadSpy: spy,
    });
    expect(priceZeroGate.allowed).toBe(false);
    expect(priceZeroGate.blockReason).toBe('price_zero');
    expect(priceZeroGate.readScoreTable).toBe(false);

    const pricePositiveGate = await checkStepReadinessGate({
      variantId,
      platform: 'mercadolivre',
      step: 'price',
      effectivePrice: 89.9,
      onScoreTableReadSpy: spy,
    });
    expect(pricePositiveGate.allowed).toBe(true);
    expect(pricePositiveGate.readScoreTable).toBe(false);
    expect(scoreTableReads).toBe(0);
  });

  it('2. Calcula os 3 scores por variante (Bling, ML, Nuvemshop), define KPI do produto pela pior variante ativa e grava top 3 melhorias e histórico', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, description, brand,
         bling_tipo, bling_formato, ncm, ncm_status, ncm_fiscal_risk,
         meta_description, seo_slug, keywords
       ) VALUES (
         '7002', 'GAR-PREMIUM-PAI',
         'Garrafa Térmica Inox 500ml Parede Dupla ThermoHub',
         'Garrafa térmica em aço inoxidável 304 com parede dupla isolada a vácuo, conservando líquidos gelados por 24 horas e quentes por 12 horas sem condensar por fora.',
         'ThermoHub',
         'P', 'V', '96170010', 'valid', false,
         'Compre Garrafa Térmica Inox 500ml Parede Dupla ThermoHub com envio imediato.',
         'garrafa-termica-inox-500ml-thermohub',
         ARRAY['garrafa termica', 'inox 500ml', 'thermohub', 'academia']
       )
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    // Variante 1 completa (alta pontuação em todos os canais)
    const v1Res = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_variant_id, bling_sku, is_default, bling_formato,
         price, net_weight, width, height, depth,
         ean, ean_status, fiscal_risk_flag
       ) VALUES (
         $1, '7002-1', 'GAR-PREM-PT', false, 'S',
         99.90, 0.35, 7.5, 24.0, 7.5,
         '7891234567895', 'valid', false
       )
       RETURNING id`,
      [masterId]
    );
    const v1Id = v1Res.rows[0]!.id;

    // Variante 2 incompleta (sem peso, sem dimensões e com EAN pendente -> puxa o KPI do produto para baixo)
    const v2Res = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_variant_id, bling_sku, is_default, bling_formato,
         price, net_weight, width, height, depth,
         ean, ean_status, fiscal_risk_flag
       ) VALUES (
         $1, '7002-2', 'GAR-INCOMP-AZ', false, 'S',
         99.90, NULL, NULL, NULL, NULL,
         NULL, 'unknown', false
       )
       RETURNING id`,
      [masterId]
    );
    const v2Id = v2Res.rows[0]!.id;

    // 3 imagens publicáveis com capa elegível
    await query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform,
         width, height, format, rights_status, quality_score, is_cover_eligible,
         position_bling, position_ml, position_ns
       ) VALUES
         ($1, 'https://org.bling.com.br/1.webp', 'https://org.bling.com.br/1.webp', 'bling', 1200, 1200, 'webp', 'owned', 100, true, 1, 1, 1),
         ($1, 'https://org.bling.com.br/2.webp', 'https://org.bling.com.br/2.webp', 'bling', 1200, 1200, 'webp', 'owned', 95, true, 2, 2, 2),
         ($1, 'https://org.bling.com.br/3.webp', 'https://org.bling.com.br/3.webp', 'bling', 1200, 1200, 'webp', 'owned', 90, true, 3, 3, 3)`,
      [masterId]
    );

    // Categoria verificada no Mercado Livre
    await query(
      `INSERT INTO product_category_mappings (
         master_product_id, platform, channel_category_id, is_verified
       ) VALUES ($1, 'mercadolivre', 'MLB1592', true)`,
      [masterId]
    );

    const report = await calculateProductReadinessCre(masterId);
    expect(report.variants).toHaveLength(2);

    const rV1 = report.variants.find((v) => v.variant_id === v1Id)!;
    const rV2 = report.variants.find((v) => v.variant_id === v2Id)!;

    // V1 é Premium nos 3 canais (>= 90 Bling, >= 75 ML, >= 85 NS)
    expect(rV1.score_bling).toBeGreaterThanOrEqual(90);
    expect(rV1.score_ml).toBeGreaterThanOrEqual(75);
    expect(rV1.score_ns).toBeGreaterThanOrEqual(85);
    expect(rV1.publishable_bling).toBe(true);
    expect(rV1.publishable_ml).toBe(true);
    expect(rV1.publishable_ns).toBe(true);
    expect(rV1.can_create_ml).toBe(true);

    // V2 tem score menor no Bling por faltar EAN (20), peso (10) e dimensões (10)
    expect(rV2.score_bling).toBeLessThan(70);
    expect(rV2.publishable_bling).toBe(false);
    expect(rV2.top_improvements).toHaveLength(3);
    expect(rV2.top_improvements[0]?.code).toBe('fix_ean');

    // KPI do produto é o menor score entre os canais da pior variante (V2)
    const minV2 = Math.min(rV2.score_bling, rV2.score_ml, rV2.score_ns);
    expect(report.product_kpi_worst_score).toBe(minV2);
  });

  it('3. CONTENT e CREATE consultam o score do CRE e bloqueiam quando o score do canal está abaixo do threshold ou falta categoria verificada no ML', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, description, brand,
         bling_tipo, bling_formato, ncm, ncm_status, ncm_fiscal_risk
       ) VALUES (
         '7003', 'PROD-LOW-SCORE', 'Item Curto', 'Curta', NULL,
         'P', 'S', '96170010', 'valid', false
       )
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_sku, is_default, bling_formato,
         price, ean, ean_status, fiscal_risk_flag
       ) VALUES ($1, 'PROD-LOW-SCORE', true, 'S', 49.90, '7891000100011', 'valid', false)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    // Vínculo confirmado no ML
    await query(
      `INSERT INTO platform_links (
         master_product_id, platform, platform_product_id, match_method, match_confidence
       ) VALUES ($1, 'mercadolivre', 'MLB-LOW-7003', 'auto_multi_signal', 95)`,
      [masterId]
    );

    // Calcula CRE: sem imagens, sem logística, sem categoria verificada e com texto fraco -> score_ml < 50
    const creReport = await calculateProductReadinessCre(masterId);
    expect(creReport.variants[0]!.score_ml).toBeLessThan(50);

    let scoreReads = 0;
    const descGate = await checkStepReadinessGate({
      variantId,
      platform: 'mercadolivre',
      step: 'description',
      onScoreTableReadSpy: () => {
        scoreReads += 1;
      },
    });

    expect(descGate.allowed).toBe(false);
    expect(descGate.blockReason).toBe('score');
    expect(descGate.readScoreTable).toBe(true);
    expect(scoreReads).toBe(1);
  });
});
