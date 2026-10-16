import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import {
  resolveMatchingDecision,
  resolveMlUserProductFamilyPire,
  resolvePlatformItemPire,
} from '../engines/pire.js';
import {
  buildMlCreateListingPayload,
  resolveProductVariantsVir,
} from '../engines/vir.js';

describe('Fase 4 — Motores de Identidade PIRE e VIR (Predicado Multi-Sinal, EAN Compartilhado, Família User Product, Aliases e user_product_seller)', () => {
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

  it('1. PIRE: EAN sozinho não chega a 95 (fica em suggestion <= 80); dois sinais fortes concordantes fazem auto-vínculo (score 95); EAN compartilhado entre dois produtos cai em quarentena', async () => {
    // Produto A e Produto B compartilham o mesmo EAN 7891234567895 (GTIN compartilhado entre produtos diferentes)
    const prodARes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4001', 'GAR-THERMO-500', 'Garrafa Térmica Inox 500ml Preta', 'P', 'S')
       RETURNING id`
    );
    const prodAId = prodARes.rows[0]!.id;

    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean, ean_status)
       VALUES ($1, 'GAR-THERMO-500', true, 'S', 89.90, '7891234567895', 'valid')`,
      [prodAId]
    );

    const prodBRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4002', 'GAR-OUTRA-750', 'Copo Térmico Aço Escovado 750ml', 'P', 'S')
       RETURNING id`
    );
    const prodBId = prodBRes.rows[0]!.id;

    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean, ean_status)
       VALUES ($1, 'GAR-OUTRA-750', true, 'S', 99.90, '7891234567895', 'valid')`,
      [prodBId]
    );

    // Produto C com EAN único 7891000100011 e SKU único MOCH-IMP-40L
    const prodCRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4003', 'MOCH-IMP-40L', 'Mochila Impermeável Notebook 40 Litros', 'P', 'S')
       RETURNING id`
    );
    const prodCId = prodCRes.rows[0]!.id;

    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean, ean_status)
       VALUES ($1, 'MOCH-IMP-40L', true, 'S', 149.90, '7891000100011', 'valid')`,
      [prodCId]
    );

    // 1A: Anúncio só com EAN único (sem SKU e com título completamente diferente) -> fica em suggestion (score 80, nunca 95)
    const singleSignalRes = await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platform_product_id: 'NS-SINGLE-EAN-01',
      title: 'Bolsa Viagem Executiva Promoção',
      skus: [],
      eans: ['7891000100011'],
    });
    expect(singleSignalRes.outcome).toBe('suggestion');
    expect(singleSignalRes.confidence).toBe(80);
    expect(singleSignalRes.master_product_id).toBeNull();

    // 1B: Anúncio com 2 sinais fortes (SKU único + EAN válido único) para Produto C -> auto_linked com score 95
    const multiSignalRes = await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platform_product_id: 'NS-MULTI-02',
      title: 'Mochila Impermeável Notebook 40 Litros',
      skus: ['MOCH-IMP-40L'],
      eans: ['7891000100011'],
    });
    expect(multiSignalRes.outcome).toBe('auto_linked');
    expect(multiSignalRes.confidence).toBe(95);
    expect(multiSignalRes.master_product_id).toBe(prodCId);

    // 1C: Anúncio com o EAN compartilhado 7891234567895 -> cai em QUARENTENA
    const sharedEanRes = await resolvePlatformItemPire({
      platform: 'mercadolivre',
      platform_product_id: 'MLB-SHARED-EAN-99',
      title: 'Garrafa Inox',
      skus: [],
      eans: ['7891234567895'],
    });
    expect(sharedEanRes.outcome).toBe('quarantine');
    expect(sharedEanRes.sharedEanQuarantine).toBe(true);
    expect(sharedEanRes.master_product_id).toBeNull();
  });

  it('2. PIRE: Família User Product com sinais em dois pais diferentes cai em quarentena sem partir a família; família concordante vincula com family_confidence = 95', async () => {
    const prodXRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4010', 'TENIS-RUN-X', 'Tênis Corrida Leve Pro X', 'P', 'S')
       RETURNING id`
    );
    const prodXId = prodXRes.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean, ean_status)
       VALUES ($1, 'TENIS-RUN-X', true, 'S', 299.90, '7891000100028', 'valid')`,
      [prodXId]
    );

    const prodYRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4011', 'TENIS-TRAIL-Y', 'Tênis Trilha Grip Master Y', 'P', 'S')
       RETURNING id`
    );
    const prodYId = prodYRes.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean, ean_status)
       VALUES ($1, 'TENIS-TRAIL-Y', true, 'S', 349.90, '7908123456786', 'valid')`,
      [prodYId]
    );

    // Família conflitante: Item 1 aponta para prodX e Item 2 aponta para prodY
    const conflictFamily = await resolveMlUserProductFamilyPire(
      'MLBF-CONFLICT-77',
      'Tênis Esportivo',
      [
        {
          platform: 'mercadolivre',
          platform_product_id: 'MLBF-CONFLICT-77',
          item_id: 'MLB-ITEM-X1',
          title: 'Tênis Corrida Leve Pro X',
          skus: ['TENIS-RUN-X'],
          eans: ['7891000100028'],
          ml_model: 'user_product',
          family_id: 'MLBF-CONFLICT-77',
        },
        {
          platform: 'mercadolivre',
          platform_product_id: 'MLBF-CONFLICT-77',
          item_id: 'MLB-ITEM-Y2',
          title: 'Tênis Trilha Grip Master Y',
          skus: ['TENIS-TRAIL-Y'],
          eans: ['7908123456786'],
          ml_model: 'user_product',
          family_id: 'MLBF-CONFLICT-77',
        },
      ]
    );

    expect(conflictFamily.outcome).toBe('quarantine');
    expect(conflictFamily.master_product_id).toBeNull();
    expect(conflictFamily.family_confidence).toBe(0);

    // Verifica que nenhum platform_links foi criado para a família em conflito
    const linkCheck = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_links WHERE platform_product_id = 'MLBF-CONFLICT-77'`
    );
    expect(linkCheck.rows[0]?.count).toBe(0);

    // Família concordante: todos os itens apontam para prodX com 2+ sinais fortes
    const cleanFamily = await resolveMlUserProductFamilyPire(
      'MLBF-CLEAN-88',
      'Tênis Corrida Leve Pro X',
      [
        {
          platform: 'mercadolivre',
          platform_product_id: 'MLBF-CLEAN-88',
          item_id: 'MLB-CLEAN-1',
          title: 'Tênis Corrida Leve Pro X',
          skus: ['TENIS-RUN-X'],
          eans: ['7891000100028'],
          ml_model: 'user_product',
          family_id: 'MLBF-CLEAN-88',
        },
      ]
    );

    expect(cleanFamily.outcome).toBe('auto_linked');
    expect(cleanFamily.master_product_id).toBe(prodXId);
    expect(cleanFamily.family_confidence).toBe(95);
  });

  it('3. PIRE: match_rejections impede que candidato recusado volte a casar ou aparecer nas sugestões', async () => {
    const operator = await createUser({
      email: 'op_pire@blingsync.local',
      name: 'Operador PIRE',
      password: 'Password!Op123',
      roles: ['operator'],
    });

    const prodRRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4020', 'KIT-CAFE-01', 'Kit Cafeteira Italiana Inox 6 Xícaras', 'P', 'S')
       RETURNING id`
    );
    const prodRId = prodRRes.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, 'KIT-CAFE-01', true, 'S', 119.90)`,
      [prodRId]
    );

    // 1ª rodada: apenas SKU coincide -> entra em suggestion
    const firstTry = await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platform_product_id: 'NS-REJECT-TEST',
      title: 'Cafeteira Avulsa',
      skus: ['KIT-CAFE-01'],
      eans: [],
    });
    expect(firstTry.outcome).toBe('suggestion');
    expect(firstTry.candidates.some((c) => c.master_product_id === prodRId)).toBe(true);

    // Operador rejeita o par (NS-REJECT-TEST, prodRId)
    await resolveMatchingDecision({
      platform: 'nuvemshop',
      platformProductId: 'NS-REJECT-TEST',
      userId: operator.id,
      action: 'reject_candidate',
      masterProductId: prodRId,
      reason: 'Produto diferente apesar do SKU parecido',
    });

    // 2ª rodada: mesmo que o título também passe a coincidir, prodRId está em match_rejections e não entra
    const secondTry = await resolvePlatformItemPire({
      platform: 'nuvemshop',
      platformProductId: 'NS-REJECT-TEST',
      platform_product_id: 'NS-REJECT-TEST',
      title: 'Kit Cafeteira Italiana Inox 6 Xícaras',
      skus: ['KIT-CAFE-01'],
      eans: [],
    } as Parameters<typeof resolvePlatformItemPire>[0]);

    expect(secondTry.outcome).not.toBe('auto_linked');
    expect(secondTry.candidates.some((c) => c.master_product_id === prodRId)).toBe(false);
  });

  it('4. VIR: Normaliza comboKey por aliases (Medium -> M), consolida condições de venda por user_product_id com trilha em control_changes, detecta missing_ml/extra_ml e conta user_product_seller não publica variations', async () => {
    const prodVRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('4030', 'CAM-GRADE-VIR', 'Camiseta Treino VIR', 'P', 'V')
       RETURNING id`
    );
    const masterId = prodVRes.rows[0]!.id;

    // Busca os eixos 'cor' e 'tamanho' criados no seed da Migration 012
    const axesRes = await query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM attribute_axes WHERE canonical_name IN ('cor', 'tamanho')`
    );
    const corAxisId = axesRes.rows.find((a) => a.canonical_name === 'cor')!.id;
    const tamAxisId = axesRes.rows.find((a) => a.canonical_name === 'tamanho')!.id;

    // Variante 1 no Bling: cor:Azul|tamanho:M
    const vAzMRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, '4030-1', 'CAM-VIR-AZ-M', false, 'S', 79.90)
       RETURNING id`,
      [masterId]
    );
    const vAzMId = vAzMRes.rows[0]!.id;

    await query(
      `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order)
       VALUES ($1, $2, 'Azul', 1), ($1, $3, 'M', 2)`,
      [vAzMId, corAxisId, tamAxisId]
    );

    // Variante 2 no Bling: cor:Preto|tamanho:G (vai faltar no ML -> missing_ml)
    const vPtGRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, '4030-2', 'CAM-VIR-PT-G', false, 'S', 79.90)
       RETURNING id`,
      [masterId]
    );
    const vPtGId = vPtGRes.rows[0]!.id;

    await query(
      `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order)
       VALUES ($1, $2, 'Preto', 1), ($1, $3, 'G', 2)`,
      [vPtGId, corAxisId, tamAxisId]
    );

    // No Mercado Livre:
    // - Variante Azul/Medium (sem SKU, casa pelo comboKey normalizando 'Medium' -> 'M') com 2 condições de venda no mesmo user_product_id 'MLBU-AZ-M'
    // - Variante Extra no ML: Verde/GG (não existe no Bling -> extra_ml + alerta crítico)
    const virReport = await resolveProductVariantsVir({
      masterProductId: masterId,
      platform: 'mercadolivre',
      platformProductId: 'MLBF-VIR-01',
      channelVariants: [
        {
          platform_variant_id: 'MLBU-AZ-M',
          user_product_id: 'MLBU-AZ-M',
          sku: null,
          ean: null,
          price: 79.9,
          stock: 10,
          raw_attributes: [
            { axisNameOrId: 'COLOR', value: 'azul' },
            { axisNameOrId: 'SIZE', value: 'Medium' },
          ],
          selling_conditions: [
            { item_id: 'MLB-COND-1', listing_status: 'active', price: 79.9 },
            { item_id: 'MLB-COND-2', listing_status: 'active', price: 89.9 },
          ],
        },
        {
          platform_variant_id: 'MLBU-VD-GG-EXTRA',
          user_product_id: 'MLBU-VD-GG-EXTRA',
          sku: 'SKU-INEXISTENTE-NO-BLING',
          ean: null,
          price: 89.9,
          stock: 5,
          raw_attributes: [
            { axisNameOrId: 'COLOR', value: 'Verde' },
            { axisNameOrId: 'SIZE', value: 'Extra Grande' },
          ],
          selling_conditions: [
            { item_id: 'MLB-COND-EXTRA', listing_status: 'active', price: 89.9 },
          ],
        },
      ],
    });

    // Azul/M vinculou pelo combo_key (normalizando Medium -> M)
    expect(virReport.linkedVariants).toEqual([
      {
        variant_id: vAzMId,
        platform_variant_id: 'MLBU-AZ-M',
        match_method: 'combo_key',
        match_confidence: 90,
      },
    ]);

    // Matriz registra 'ok' para Azul/M, 'missing_ml' para Preto/G e 'extra_ml' para Verde/GG
    expect(virReport.matrixStatuses).toEqual([
      { combo_key: 'cor:Azul|tamanho:M', status: 'ok' },
      { combo_key: 'cor:Preto|tamanho:G', status: 'missing_ml' },
      { combo_key: 'cor:Verde|tamanho:GG', status: 'extra_ml' },
    ]);

    // Verifica as duas condições de venda gravadas e a trilha obrigatória em control_changes (origin = system)
    const condsRes = await query<{ item_id: string; follow_store_price: boolean }>(
      `SELECT item_id, follow_store_price
       FROM ml_selling_conditions
       WHERE item_id IN ('MLB-COND-1', 'MLB-COND-2')
       ORDER BY item_id ASC`
    );
    expect(condsRes.rows).toEqual([
      { item_id: 'MLB-COND-1', follow_store_price: true },
      { item_id: 'MLB-COND-2', follow_store_price: false },
    ]);

    const sysTrailRes = await query<{
      target_key: string;
      old_value: string | null;
      new_value: string;
      origin: string;
    }>(
      `SELECT target_key, old_value, new_value, origin
       FROM control_changes
       WHERE target = 'selling_condition' AND target_key IN ('MLB-COND-1', 'MLB-COND-2')
       ORDER BY target_key ASC`
    );
    expect(sysTrailRes.rows).toEqual([
      { target_key: 'MLB-COND-1', old_value: null, new_value: 'true', origin: 'system' },
      { target_key: 'MLB-COND-2', old_value: null, new_value: 'false', origin: 'system' },
    ]);

    // Conta com tag user_product_seller NUNCA publica o array 'variations'
    const upCreatePayload = buildMlCreateListingPayload({
      sellerTags: ['normal', 'user_product_seller', 'warehouse_management'],
      categoryId: 'MLB31447',
      familyName: 'Camiseta Treino VIR',
      title: 'Camiseta Treino VIR Preto G',
      price: 79.9,
      initialStockFloor: 15,
      parentPkAttributes: [{ id: 'BRAND', value_name: 'MoveFit' }],
      childPkAttributes: [
        { id: 'COLOR', value_name: 'Preto' },
        { id: 'SIZE', value_name: 'G' },
      ],
      legacyVariationsPayload: [{ price: 79.9 }],
    });

    expect(upCreatePayload.family_name).toBe('Camiseta Treino VIR');
    expect('variations' in upCreatePayload).toBe(false);
    expect('title' in upCreatePayload).toBe(false);
  });
});
