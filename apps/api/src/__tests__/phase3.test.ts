import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import {
  evaluateProductGve,
  validateGs1Gtin,
} from '../engines/gve.js';
import {
  confirmNcmSuggestionStep,
  evaluateProductNve,
  formatNcmDisplay,
  validateNcmCode,
} from '../engines/nve.js';

describe('Fase 3 — Motores Fiscais Puros GVE (GS1 + duplicate) e NVE (NCM 0000.00.00 + conflict + dupla confirmação)', () => {
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

  it('1. Valida vetores oficiais GS1 (GTIN-8, 12, 13, 14, Brasil 789/790, ISBN, faixa interna 200 e placeholders) e NCM 0000.00.00', () => {
    // GTIN-13 Brasil (789 / 790)
    const br13 = validateGs1Gtin('7891000100011');
    expect(br13.valid).toBe(true);
    expect(br13.length).toBe(13);
    expect(br13.contextType).toBe('gs1_brasil');

    const br790 = validateGs1Gtin('7908123456786');
    expect(br790.valid).toBe(true);
    expect(br790.contextType).toBe('gs1_brasil');

    // GTIN-8 válido
    const gtin8 = validateGs1Gtin('78912342');
    expect(gtin8.valid).toBe(true);
    expect(gtin8.length).toBe(8);

    // GTIN-12 (UPC) válido
    const gtin12 = validateGs1Gtin('036000291452');
    expect(gtin12.valid).toBe(true);
    expect(gtin12.length).toBe(12);

    // GTIN-14 (DUN-14) válido
    const gtin14 = validateGs1Gtin('17891000100018');
    expect(gtin14.valid).toBe(true);
    expect(gtin14.length).toBe(14);
    expect(gtin14.contextType).toBe('gs1_brasil');

    // ISBN-13
    const isbn = validateGs1Gtin('9788535914849');
    expect(isbn.valid).toBe(true);
    expect(isbn.contextType).toBe('isbn_issn');

    // Faixa interna 200–299
    const internal = validateGs1Gtin('2001234567893');
    expect(internal.valid).toBe(true);
    expect(internal.contextType).toBe('internal_range');

    // Dígito verificador incorreto
    const badCheck = validateGs1Gtin('7891000100012');
    expect(badCheck.valid).toBe(false);
    expect(badCheck.reason).toBe('invalid_check_digit');

    // Placeholders e sequências
    expect(validateGs1Gtin('0000000000000').isPlaceholder).toBe(true);
    expect(validateGs1Gtin('9999999999999').isPlaceholder).toBe(true);
    expect(validateGs1Gtin('1234567890128').isPlaceholder).toBe(true);

    // NCM 0000.00.00
    const ncmValid = validateNcmCode('9617.00.10');
    expect(ncmValid.valid).toBe(true);
    expect(ncmValid.digits).toBe('96170010');
    expect(ncmValid.formatted).toBe('9617.00.10');
    expect(ncmValid.chapter).toBe(96);
    expect(formatNcmDisplay('61099000')).toBe('6109.90.00');

    // NCM truncado do Mercado Livre (6 dígitos)
    const ncmTrunc = validateNcmCode('6109.90');
    expect(ncmTrunc.valid).toBe(false);
    expect(ncmTrunc.isTruncated).toBe(true);
    expect(ncmTrunc.reason).toBe('truncated');

    // NCM placeholders e capítulos inválidos (00, 99)
    expect(validateNcmCode('0000.00.00').isPlaceholder).toBe(true);
    expect(validateNcmCode('1234.56.78').isPlaceholder).toBe(true);
    expect(validateNcmCode('0010.20.30').reason).toBe('invalid_chapter');
    expect(validateNcmCode('9901.00.00').reason).toBe('invalid_chapter');
  });

  it('2. GVE: EAN válido repetido entre variantes não descontinuadas do mesmo produto marca duplicate apenas nelas, não abre fila e sai quando uma variante é descontinuada', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('3001', 'PROD-DUP-EAN', 'Produto Grade com EAN Repetido', 'P', 'V')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    // V1 e V2 carregam o mesmo EAN válido 7891000100011; V3 carrega outro EAN válido 7891000100028
    const v1Res = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price, ean)
       VALUES ($1, '3001-1', 'SKU-V1', false, 'S', 59.90, '7891000100011')
       RETURNING id`,
      [masterId]
    );
    const v2Res = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price, ean)
       VALUES ($1, '3001-2', 'SKU-V2', false, 'S', 59.90, '7891000100011')
       RETURNING id`,
      [masterId]
    );
    const v3Res = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price, ean)
       VALUES ($1, '3001-3', 'SKU-V3', false, 'S', 64.90, '7891000100028')
       RETURNING id`,
      [masterId]
    );

    const v1Id = v1Res.rows[0]!.id;
    const v2Id = v2Res.rows[0]!.id;
    const v3Id = v3Res.rows[0]!.id;

    const firstReport = await evaluateProductGve(masterId);
    expect(firstReport.duplicateEansInProduct).toEqual(['7891000100011']);

    const outV1 = firstReport.variants.find((v) => v.variant_id === v1Id)!;
    const outV2 = firstReport.variants.find((v) => v.variant_id === v2Id)!;
    const outV3 = firstReport.variants.find((v) => v.variant_id === v3Id)!;

    expect(outV1.ean_status).toBe('duplicate');
    expect(outV1.fiscal_risk_flag).toBe(true);
    expect(outV1.blocksContentAndCreate).toBe(true);

    expect(outV2.ean_status).toBe('duplicate');
    expect(outV2.fiscal_risk_flag).toBe(true);
    expect(outV2.blocksContentAndCreate).toBe(true);

    // V3 tem outro EAN válido -> segue normal, sem bloqueio
    expect(outV3.ean_status).toBe('valid');
    expect(outV3.fiscal_risk_flag).toBe(false);
    expect(outV3.blocksContentAndCreate).toBe(false);

    // Não entra em ean_pending_validation e gera exatamente 1 alerta aberto por produto e EAN
    const pendingRows = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_pending_validation WHERE master_product_id = $1`,
      [masterId]
    );
    expect(pendingRows.rows[0]?.count).toBe(0);

    const alertsOpen = await query<{ id: string; status: string }>(
      `SELECT id, status FROM divergence_alerts
       WHERE master_product_id = $1 AND alert_code = 'ean_duplicate_in_product'`,
      [masterId]
    );
    expect(alertsOpen.rows).toHaveLength(1);
    expect(alertsOpen.rows[0]?.status).toBe('open');

    // Agora V2 passa a discontinued -> na próxima passagem do GVE, V1 deixa de ser duplicate e o alerta resolve
    await query(
      `UPDATE product_variants SET variant_status = 'discontinued', is_active = false WHERE id = $1`,
      [v2Id]
    );

    const secondReport = await evaluateProductGve(masterId);
    expect(secondReport.duplicateEansInProduct).toEqual([]);

    const outV1After = secondReport.variants.find((v) => v.variant_id === v1Id)!;
    expect(outV1After.ean_status).toBe('valid');
    expect(outV1After.fiscal_risk_flag).toBe(false);

    const alertsAfter = await query<{ status: string }>(
      `SELECT status FROM divergence_alerts
       WHERE master_product_id = $1 AND alert_code = 'ean_duplicate_in_product'`,
      [masterId]
    );
    expect(alertsAfter.rows[0]?.status).toBe('resolved');
  });

  it('3. GVE: Bling vazio e externo válido vai para ean_pending_validation sem auto-preencher o Bling', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('3002', 'PROD-EMPTY-EAN', 'Produto Sem EAN no Bling', 'P', 'S')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, ean)
       VALUES ($1, 'PROD-EMPTY-EAN', true, 'S', 49.90, NULL)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    const report = await evaluateProductGve(masterId, [
      {
        variant_id: variantId,
        platform: 'mercadolivre',
        external_ean: '7891234567895',
      },
    ]);

    expect(report.variants[0]?.ean_status).toBe('pending_validation');
    expect(report.variants[0]?.queuedPendingValidation).toBe(true);

    // Confirma que product_variants.ean permaneceu NULL (nunca auto-preenche)
    const variantCheck = await query<{ ean: string | null }>(
      `SELECT ean FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(variantCheck.rows[0]?.ean).toBeNull();

    const queueCheck = await query<{ proposed_ean: string; context_type: string }>(
      `SELECT proposed_ean, context_type FROM ean_pending_validation WHERE variant_id = $1`,
      [variantId]
    );
    expect(queueCheck.rows).toHaveLength(1);
    expect(queueCheck.rows[0]).toEqual({
      proposed_ean: '7891234567895',
      context_type: 'gs1_brasil',
    });
  });

  it('4. NVE: NCM em conflito entre variantes marca conflict no pai, não gera sugestão e sai de conflict mantendo risco se o pai for inválido', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato, ncm)
       VALUES ('3003', 'PROD-CONFLICT-NCM', 'Produto com Conflito de NCM entre Variantes', 'P', 'V', '00000000')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const v1Res = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, '3003-1', 'SKU-NCM-1', false, 'S', 79.90)
       RETURNING id`,
      [masterId]
    );
    const v2Res = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_variant_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, '3003-2', 'SKU-NCM-2', false, 'S', 79.90)
       RETURNING id`,
      [masterId]
    );

    const v1Id = v1Res.rows[0]!.id;
    const v2Id = v2Res.rows[0]!.id;

    // V1 traz 6109.90.00 e V2 traz 6110.20.00 (dois NCMs válidos diferentes no mesmo pai)
    const conflictReport = await evaluateProductNve(masterId, [
      { variant_id: v1Id, bling_variation_ncm: '6109.90.00', ml_attribute_ncm: '00000000' },
      { variant_id: v2Id, bling_variation_ncm: '6110.20.00', ml_attribute_ncm: '6110.20' },
    ]);

    expect(conflictReport.ncm_status).toBe('conflict');
    expect(conflictReport.ncm_fiscal_risk).toBe(true);
    expect(conflictReport.blocksContentAndCreate).toBe(true);
    expect(conflictReport.conflictNcmsFormatted).toEqual(['6109.90.00', '6110.20.00']);
    expect(conflictReport.suggestionCreatedId).toBeNull();

    // Nenhum código em conflito vira sugestão
    const suggestionsCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ncm_manual_suggestions WHERE master_product_id = $1`,
      [masterId]
    );
    expect(suggestionsCount.rows[0]?.count).toBe(0);

    // 1 único alerta aberto em ncm_divergence_alerts
    const alertsRes = await query<{ alert_type: string; status: string }>(
      `SELECT alert_type, status FROM ncm_divergence_alerts WHERE master_product_id = $1`,
      [masterId]
    );
    expect(alertsRes.rows).toEqual([{ alert_type: 'variant_conflict', status: 'open' }]);

    // Na rodada seguinte as duas variantes passam a ter o mesmo código 6109.90.00:
    // conflict sai, mas ncm_fiscal_risk permanece true porque o NCM do pai ('00000000') é inválido!
    const afterConflictReport = await evaluateProductNve(masterId, [
      { variant_id: v1Id, bling_variation_ncm: '6109.90.00' },
      { variant_id: v2Id, bling_variation_ncm: '6109.90.00' },
    ]);

    expect(afterConflictReport.ncm_status).toBe('invalid');
    expect(afterConflictReport.ncm_fiscal_risk).toBe(true);

    const resolvedConflictAlert = await query<{ status: string }>(
      `SELECT status FROM ncm_divergence_alerts
       WHERE master_product_id = $1 AND alert_type = 'variant_conflict'`,
      [masterId]
    );
    expect(resolvedConflictAlert.rows[0]?.status).toBe('resolved');
  });

  it('5. NVE: Sugestão quando Bling está vazio exige dupla confirmação por 2 usuários fiscal_approver distintos com nota de TIPI e grava ncm_audit_log', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato, ncm)
       VALUES ('3004', 'PROD-SUGGEST-NCM', 'Garrafa Sem NCM no Bling', 'P', 'S', NULL)
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    await query(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, 'PROD-SUGGEST-NCM', true, 'S', 89.90)`,
      [masterId]
    );

    const nveReport = await evaluateProductNve(masterId, [], {
      platform: 'mercadolivre',
      rawNcm: '9617.00.10',
    });

    expect(nveReport.ncm_status).toBe('pending_approval');
    expect(nveReport.suggestionCreatedId).toBeDefined();
    const suggestionId = nveReport.suggestionCreatedId!;

    const approverA = await createUser({
      email: 'fiscal_a@blingsync.local',
      name: 'Fiscal A',
      password: 'StrongPassword!A1',
      roles: ['fiscal_approver'],
    });
    const approverB = await createUser({
      email: 'fiscal_b@blingsync.local',
      name: 'Fiscal B',
      password: 'StrongPassword!B2',
      roles: ['fiscal_approver'],
    });

    // 1ª confirmação por approverA
    const step1 = await confirmNcmSuggestionStep({
      suggestionId,
      reviewerUserId: approverA.id,
      note: 'Conferido item garrafa térmica de inox.',
    });
    expect(step1.status).toBe('pending_second');

    // Mesmo usuário (approverA) tentando confirmar a 2ª etapa deve falhar
    await expect(
      confirmNcmSuggestionStep({
        suggestionId,
        reviewerUserId: approverA.id,
        note: 'Tentativa de auto-aprovação na segunda etapa.',
      })
    ).rejects.toThrow(/outro usuário fiscal_approver/);

    // 2ª confirmação por approverB com nota de consulta à TIPI
    const step2 = await confirmNcmSuggestionStep({
      suggestionId,
      reviewerUserId: approverB.id,
      note: 'TIPI Capítulo 96, posição 9617.00.10: Garrafas térmicas e outros recipientes isotérmicos.',
    });
    expect(step2.status).toBe('approved');
    expect(step2.approvedNcmDigits).toBe('96170010');

    // Verifica atualização de master_products.ncm e gravação em ncm_audit_log
    const updatedProd = await query<{ ncm: string; ncm_status: string; ncm_fiscal_risk: boolean }>(
      `SELECT ncm, ncm_status, ncm_fiscal_risk FROM master_products WHERE id = $1`,
      [masterId]
    );
    expect(updatedProd.rows[0]).toEqual({
      ncm: '96170010',
      ncm_status: 'valid',
      ncm_fiscal_risk: false,
    });

    const auditRows = await query<{
      new_ncm: string;
      decision: string;
      first_review_by: string;
      second_review_by: string;
      tipi_note: string;
    }>(
      `SELECT new_ncm, decision, first_review_by, second_review_by, tipi_note
       FROM ncm_audit_log
       WHERE master_product_id = $1 AND decision = 'dual_approved'`,
      [masterId]
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0]).toEqual({
      new_ncm: '9617.00.10',
      decision: 'dual_approved',
      first_review_by: approverA.id,
      second_review_by: approverB.id,
      tipi_note:
        'TIPI Capítulo 96, posição 9617.00.10: Garrafas térmicas e outros recipientes isotérmicos.',
    });
  });
});
