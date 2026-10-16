import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import {
  decideEnrichmentAction,
  evaluateAndApplyCqsEnrichment,
  evaluateBrandQuality,
  evaluateDescriptionQuality,
  evaluateDimensionsQuality,
  evaluateNameQuality,
  evaluateWeightQuality,
  revertCqsQualityHistoryChange,
  scoreToGrade,
} from '../engines/cqs.js';

describe('Fase 6 — Motor CQS (Qualidade de Conteúdo, Árvore KEEP/REPLACE/SUGGEST, Proteção de Grade A e B, Shadow/Live, Kill Switch e Reversão)', () => {
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

  it('1. Critério de saída: Grade A e Grade B no Bling NUNCA sofrem REPLACE automático em nenhuma combinação de score externo', () => {
    // Varre todas as pontuações possíveis de Bling em Grade A (81..100) e Grade B (61..80) contra qualquer score externo (0..100)
    for (let blingScore = 61; blingScore <= 100; blingScore++) {
      const blingGrade = scoreToGrade(blingScore);
      expect(blingGrade === 'A' || blingGrade === 'B').toBe(true);

      for (let extScore = 0; extScore <= 100; extScore++) {
        const extGrade = scoreToGrade(extScore);
        const decision = decideEnrichmentAction(
          { score: blingScore, grade: blingGrade, penalties: [] },
          { score: extScore, grade: extGrade, penalties: [] }
        );

        expect(decision).not.toBe('REPLACE');
        if (blingGrade === 'A') {
          expect(decision).toBe('KEEP');
        }
        if (blingGrade === 'B' && extScore > blingScore && extGrade !== 'F' && extScore >= 15) {
          expect(decision).toBe('SUGGEST');
        }
      }
    }

    // Valida as regras de REPLACE permitidas (Bling F/D/C):
    // Regra 3: Bling F (10) e externo C (50) -> REPLACE
    expect(
      decideEnrichmentAction(
        { score: 10, grade: 'F', penalties: [] },
        { score: 50, grade: 'C', penalties: [] }
      )
    ).toBe('REPLACE');

    // Regra 4: Bling D (35), externo B (65), delta 30 >= 15 -> REPLACE
    expect(
      decideEnrichmentAction(
        { score: 35, grade: 'D', penalties: [] },
        { score: 65, grade: 'B', penalties: [] }
      )
    ).toBe('REPLACE');

    // Regra 5: Bling C (45), externo B (75), delta 30 >= 30 -> REPLACE
    expect(
      decideEnrichmentAction(
        { score: 45, grade: 'C', penalties: [] },
        { score: 75, grade: 'B', penalties: [] }
      )
    ).toBe('REPLACE');

    // Regra 6: Bling C (50), externo B (70), delta 20 (15..29) -> SUGGEST
    expect(
      decideEnrichmentAction(
        { score: 50, grade: 'C', penalties: [] },
        { score: 70, grade: 'B', penalties: [] }
      )
    ).toBe('SUGGEST');
  });

  it('2. Avaliadores penalizam genéricos, textos curtos (< 30 chars em descrição = F), ALL CAPS e valores sentinela (peso 0.001/1/100 e dimensão 1x1x1)', () => {
    expect(evaluateNameQuality('PRODUTO').grade).toBe('F');
    expect(evaluateNameQuality('Garrafa Térmica Inox 500ml Parede Dupla').grade).toBe('A');

    expect(evaluateDescriptionQuality('Texto curto demais').grade).toBe('F');
    expect(evaluateDescriptionQuality('Ver imagem a definir consulte').grade).toBe('F');
    expect(
      evaluateDescriptionQuality(
        'Garrafa térmica em aço inoxidável 304 com parede dupla isolada a vácuo, mantendo líquidos gelados por 24 horas.'
      ).grade
    ).toBe('B');

    expect(evaluateBrandQuality('Genérico').grade).toBe('F');
    expect(evaluateBrandQuality('ThermoHub').grade).toBe('A');

    expect(evaluateWeightQuality(0.001).grade).toBe('D');
    expect(evaluateWeightQuality(0.35).grade).toBe('A');

    expect(evaluateDimensionsQuality({ width: 1, height: 1, depth: 1 }).grade).toBe('F');
    expect(evaluateDimensionsQuality({ width: 10, height: 20, depth: null }).grade).toBe('F');
    expect(evaluateDimensionsQuality({ width: 7.5, height: 24, depth: 7.5 }).grade).toBe('A');
  });

  it('3. Nome e descrição do Bling permanecem intocáveis (canal grava em channel_content_overrides), modo shadow não altera o Bling e linha shadow não pode ser revertida', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, description, brand, bling_tipo, bling_formato)
       VALUES ('6001', 'PROD-CQS-SHADOW', 'Nome Fiscal NF-e Original', 'Descrição original curta', 'sem marca', 'P', 'S')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, net_weight)
       VALUES ($1, 'PROD-CQS-SHADOW', true, 'S', 99.90, 0)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    // Vínculo de alta confiança (>= 95) no Mercado Livre
    await query(
      `INSERT INTO platform_links (master_product_id, platform, platform_product_id, match_method, match_confidence)
       VALUES ($1, 'mercadolivre', 'MLB-CQS-1', 'auto_multi_signal', 95)`,
      [masterId]
    );

    // Por padrão, enrichment_controls nasce em mode = 'shadow'
    const shadowReport = await evaluateAndApplyCqsEnrichment({
      masterProductId: masterId,
      variantId,
      candidate: {
        platform: 'mercadolivre',
        title: 'Título SEO Otimizado Mercado Livre Frete Rápido',
        description:
          'Descrição rica completa do anúncio no Mercado Livre com todas as especificações técnicas do produto.',
        brand: 'ThermoHub Oficial',
        net_weight: 0.42,
      },
    });

    expect(shadowReport.skippedReason).toBeNull();
    expect(shadowReport.outcomes.every((o) => o.mode === 'shadow')).toBe(true);
    expect(shadowReport.outcomes.every((o) => o.appliedToBling === false)).toBe(true);

    // Confirma que master_products.name, description e brand NÃO mudaram em shadow
    const prodCheck = await query<{ name: string; description: string; brand: string }>(
      `SELECT name, description, brand FROM master_products WHERE id = $1`,
      [masterId]
    );
    expect(prodCheck.rows[0]).toEqual({
      name: 'Nome Fiscal NF-e Original',
      description: 'Descrição original curta',
      brand: 'sem marca',
    });

    // Confirma que título e descrição do canal foram para channel_content_overrides em status = 'shadow'
    const overrides = await query<{ field: string; value: string; status: string }>(
      `SELECT field, value, status
       FROM channel_content_overrides
       WHERE master_product_id = $1
       ORDER BY field ASC`,
      [masterId]
    );
    expect(overrides.rows).toHaveLength(2);
    expect(overrides.rows[0]?.field).toBe('description');
    expect(overrides.rows[0]?.status).toBe('shadow');
    expect(overrides.rows[1]?.field).toBe('title');

    // Tentar reverter uma linha de quality_history de shadow deve falhar
    const qhShadow = await query<{ id: string }>(
      `SELECT id FROM quality_history WHERE master_product_id = $1 LIMIT 1`,
      [masterId]
    );
    const operator = await createUser({
      email: 'op_cqs@blingsync.local',
      name: 'Operador CQS',
      password: 'Password!Cqs1',
      roles: ['operator'],
    });

    await expect(
      revertCqsQualityHistoryChange({
        qualityHistoryId: qhShadow.rows[0]!.id,
        actorUserId: operator.id,
      })
    ).rejects.toThrow(/shadow/);
  });

  it('4. Modo live respeita max_replaces_per_run (rebaixando excedente para SUGGEST), kill_switch bloqueia a origem e reversão restaura old_value gravando hub_writes', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, brand, bling_tipo, bling_formato)
       VALUES ('6002', 'PROD-CQS-LIVE', 'Nome Intocável NF-e Live', NULL, 'P', 'S')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, net_weight)
       VALUES ($1, 'PROD-CQS-LIVE', true, 'S', 129.90, NULL)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    await query(
      `INSERT INTO platform_links (master_product_id, platform, platform_product_id, match_method, match_confidence)
       VALUES ($1, 'nuvemshop', 'NS-CQS-2', 'auto_multi_signal', 95)`,
      [masterId]
    );

    // Configura Nuvemshop em modo 'live' com max_replaces_per_run = 1
    await query(
      `UPDATE enrichment_controls
       SET mode = 'live', kill_switch = false, max_replaces_per_run = 1
       WHERE platform = 'nuvemshop'`
    );

    const counter = { count: 0 };
    const liveReport = await evaluateAndApplyCqsEnrichment({
      masterProductId: masterId,
      variantId,
      currentRunReplaceCounter: counter,
      candidate: {
        platform: 'nuvemshop',
        brand: 'IronPulse', // 1º REPLACE -> aplica em live (counter passa a 1)
        net_weight: 2.5, // 2º REPLACE -> excede max_replaces_per_run (1) e vira SUGGEST!
      },
    });

    expect(liveReport.replacesAppliedInRun).toBe(1);
    const brandOut = liveReport.outcomes.find((o) => o.field === 'brand')!;
    const weightOut = liveReport.outcomes.find((o) => o.field === 'net_weight')!;

    expect(brandOut.decision).toBe('REPLACE');
    expect(brandOut.effectiveDecisionAfterCap).toBe('REPLACE');
    expect(brandOut.appliedToBling).toBe(true);

    expect(weightOut.decision).toBe('REPLACE');
    expect(weightOut.effectiveDecisionAfterCap).toBe('SUGGEST');
    expect(weightOut.appliedToBling).toBe(false);

    // Verifica que brand foi atualizado em master_products e gravou hub_writes
    const prodAfterLive = await query<{ brand: string | null }>(
      `SELECT brand FROM master_products WHERE id = $1`,
      [masterId]
    );
    expect(prodAfterLive.rows[0]?.brand).toBe('IronPulse');

    // Reverte a alteração de brand via quality_history
    const qhLive = await query<{ id: string }>(
      `SELECT id FROM quality_history
       WHERE master_product_id = $1 AND field_name = 'brand' AND applied = true`,
      [masterId]
    );

    const admin = await createUser({
      email: 'admin_cqs@blingsync.local',
      name: 'Admin CQS',
      password: 'Password!AdminCqs',
      roles: ['admin'],
    });

    const reverted = await revertCqsQualityHistoryChange({
      qualityHistoryId: qhLive.rows[0]!.id,
      actorUserId: admin.id,
    });
    expect(reverted.revertedField).toBe('brand');
    expect(reverted.restoredValue).toBeNull();

    const prodAfterRevert = await query<{ brand: string | null }>(
      `SELECT brand FROM master_products WHERE id = $1`,
      [masterId]
    );
    expect(prodAfterRevert.rows[0]?.brand).toBeNull();

    // Liga o kill_switch da Nuvemshop -> execução deve ser ignorada com skippedReason = 'kill_switch_active'
    await query(
      `UPDATE enrichment_controls SET kill_switch = true WHERE platform = 'nuvemshop'`
    );
    const killedReport = await evaluateAndApplyCqsEnrichment({
      masterProductId: masterId,
      variantId,
      candidate: { platform: 'nuvemshop', brand: 'OutraMarca' },
    });
    expect(killedReport.skippedReason).toBe('kill_switch_active');
  });
});
