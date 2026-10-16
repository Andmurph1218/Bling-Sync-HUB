/**
 * Motor NVE — NCM Validation Engine (Seção 8.4 e Seção 14 do Plano Mestre)
 *
 * Regras travadas:
 * - NCM nunca é preenchido automaticamente por canal.
 * - Formato exibido: '0000.00.00' (8 dígitos). Limpeza remove ponto, espaço e hífen.
 * - Capítulo válido: 01 a 97. Placeholders ('00000000', '99999999', '12345678', etc.) e códigos truncados (< 8 dígitos) são inválidos.
 * - Conflito entre variantes não descontinuadas é avaliado ANTES de qualquer sugestão:
 *   dois códigos válidos diferentes no mesmo pai marcam ncm_status = 'conflict' e ncm_fiscal_risk = true no pai,
 *   bloqueiam CONTENT e CREATE do produto, não viram sugestão nem substituem master_products.ncm, e abrem
 *   1 único alerta por produto em ncm_divergence_alerts.
 * - Quando o NVE seguinte não encontra dois códigos válidos diferentes, 'conflict' sai, mas ncm_fiscal_risk
 *   permanece true se o NCM do pai for inválido.
 * - Sugestão manual exige duas confirmações de usuários distintos com papel fiscal_approver e nota de consulta à TIPI,
 *   gravando linha imutável em ncm_audit_log.
 */

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';

export interface NcmValidationResult {
  valid: boolean;
  digits: string | null;
  formatted: string | null;
  chapter: number | null;
  isPlaceholder: boolean;
  isTruncated: boolean;
  reason?:
    | 'empty'
    | 'non_numeric'
    | 'truncated'
    | 'invalid_length'
    | 'placeholder'
    | 'invalid_chapter';
}

const NCM_PLACEHOLDERS = new Set<string>([
  '00000000',
  '11111111',
  '22222222',
  '33333333',
  '44444444',
  '55555555',
  '66666666',
  '77777777',
  '88888888',
  '99999999',
  '12345678',
  '87654321',
]);

export function formatNcmDisplay(digits8: string): string {
  const clean = digits8.replace(/\D+/g, '');
  if (clean.length !== 8) {
    throw new Error(`NCM deve conter exatamente 8 dígitos para formatação: recebido '${digits8}'`);
  }
  return `${clean.slice(0, 4)}.${clean.slice(4, 6)}.${clean.slice(6, 8)}`;
}

/**
 * Validação pura estrutural de NCM (Seção 8.4).
 */
export function validateNcmCode(raw?: string | null): NcmValidationResult {
  if (!raw || raw.trim().length === 0) {
    return {
      valid: false,
      digits: null,
      formatted: null,
      chapter: null,
      isPlaceholder: false,
      isTruncated: false,
      reason: 'empty',
    };
  }

  const cleaned = raw.trim().replace(/[.\s-]+/g, '');
  if (!/^\d+$/.test(cleaned)) {
    return {
      valid: false,
      digits: null,
      formatted: null,
      chapter: null,
      isPlaceholder: false,
      isTruncated: false,
      reason: 'non_numeric',
    };
  }

  if (cleaned.length < 8) {
    return {
      valid: false,
      digits: cleaned,
      formatted: null,
      chapter: null,
      isPlaceholder: false,
      isTruncated: true,
      reason: 'truncated',
    };
  }

  if (cleaned.length > 8) {
    return {
      valid: false,
      digits: cleaned,
      formatted: null,
      chapter: null,
      isPlaceholder: false,
      isTruncated: false,
      reason: 'invalid_length',
    };
  }

  if (NCM_PLACEHOLDERS.has(cleaned) || /^(\d)\1+$/.test(cleaned)) {
    return {
      valid: false,
      digits: cleaned,
      formatted: null,
      chapter: null,
      isPlaceholder: true,
      isTruncated: false,
      reason: 'placeholder',
    };
  }

  const chapter = Number(cleaned.slice(0, 2));
  if (chapter < 1 || chapter > 97) {
    return {
      valid: false,
      digits: cleaned,
      formatted: null,
      chapter,
      isPlaceholder: false,
      isTruncated: false,
      reason: 'invalid_chapter',
    };
  }

  return {
    valid: true,
    digits: cleaned,
    formatted: formatNcmDisplay(cleaned),
    chapter,
    isPlaceholder: false,
    isTruncated: false,
  };
}

export interface VariantNcmObservation {
  variant_id: string;
  bling_variation_ncm?: string | null;
  ml_attribute_ncm?: string | null;
}

export interface ProductNveEvaluationReport {
  master_product_id: string;
  ncm_digits: string | null;
  ncm_formatted: string | null;
  ncm_status: 'unknown' | 'valid' | 'invalid' | 'divergent' | 'conflict' | 'pending_approval';
  ncm_fiscal_risk: boolean;
  blocksContentAndCreate: boolean;
  conflictNcmsFormatted: string[];
  suggestionCreatedId: string | null;
}

/**
 * Avalia o NCM de um produto pai e suas variantes ativas (Seção 8.4):
 * 1. Verifica conflito entre variantes não descontinuadas (códigos no payload da variação do Bling e atributo NCM no ML).
 *    Placeholder e código inválido/truncado não entram na conta de conflito.
 *    Dois ou mais códigos válidos diferentes -> ncm_status = 'conflict', ncm_fiscal_risk = true, bloqueia CONTENT/CREATE,
 *    nenhum vira sugestão e abre 1 alerta 'variant_conflict' por produto.
 * 2. Sem conflito entre variantes:
 *    - Quando o conflito desaparece na passagem seguinte, resolve o alerta 'variant_conflict',
 *      mas mantém ncm_fiscal_risk = true se o NCM do pai for inválido.
 *    - Avalia o NCM do pai contra código externo válido de 8 dígitos.
 */
export async function evaluateProductNve(
  masterProductId: string,
  variantObservations: VariantNcmObservation[] = [],
  externalProductLevelNcm?: {
    platform: 'mercadolivre' | 'nuvemshop';
    rawNcm: string | null;
  }
): Promise<ProductNveEvaluationReport> {
  return withTransaction(async (client: PoolClient) => {
    const prodRes = await client.query<{
      id: string;
      ncm: string | null;
      ncm_status: string;
      ncm_fiscal_risk: boolean;
    }>(
      `SELECT id, ncm, ncm_status, ncm_fiscal_risk
       FROM master_products
       WHERE id = $1
       FOR UPDATE`,
      [masterProductId]
    );

    const product = prodRes.rows[0];
    if (!product) {
      throw new Error(`master_product ${masterProductId} não encontrado`);
    }

    const activeVarRes = await client.query<{ id: string }>(
      `SELECT id FROM product_variants
       WHERE master_product_id = $1 AND variant_status <> 'discontinued'`,
      [masterProductId]
    );
    const activeVariantIds = new Set(activeVarRes.rows.map((r) => r.id));

    // Coleta códigos válidos (8 dígitos, cap 01..97, não placeholder) observados nas variantes não descontinuadas
    const validVariantNcmDigitsSet = new Set<string>();
    for (const obs of variantObservations) {
      if (!activeVariantIds.has(obs.variant_id)) continue;

      if (obs.bling_variation_ncm) {
        const vBling = validateNcmCode(obs.bling_variation_ncm);
        if (vBling.valid && vBling.digits) {
          validVariantNcmDigitsSet.add(vBling.digits);
        }
      }
      if (obs.ml_attribute_ncm) {
        const vMl = validateNcmCode(obs.ml_attribute_ncm);
        if (vMl.valid && vMl.digits) {
          validVariantNcmDigitsSet.add(vMl.digits);
        }
      }
    }

    const distinctVariantValidNcms = Array.from(validVariantNcmDigitsSet).sort();
    const hasVariantConflict = distinctVariantValidNcms.length >= 2;
    const parentVal = validateNcmCode(product.ncm);

    // Se havia alerta aberto de variant_conflict e o conflito sumiu, resolve o alerta
    const openConflictAlerts = await client.query<{ id: string }>(
      `SELECT id FROM ncm_divergence_alerts
       WHERE master_product_id = $1
         AND alert_type = 'variant_conflict'
         AND status = 'open'`,
      [masterProductId]
    );

    if (!hasVariantConflict && openConflictAlerts.rowCount && openConflictAlerts.rowCount > 0) {
      for (const row of openConflictAlerts.rows) {
        await client.query(
          `UPDATE ncm_divergence_alerts
           SET status = 'resolved', resolved_at = now()
           WHERE id = $1`,
          [row.id]
        );
      }
    }

    // 1. Conflito entre variantes tem precedência sobre sugestão e nunca altera master_products.ncm
    if (hasVariantConflict) {
      const formattedList = distinctVariantValidNcms.map((d) => formatNcmDisplay(d));

      if (openConflictAlerts.rowCount === 0) {
        await client.query(
          `INSERT INTO ncm_divergence_alerts (
             master_product_id, bling_ncm, conflict_ncms, alert_type, status
           ) VALUES ($1, $2, $3, 'variant_conflict', 'open')`,
          [masterProductId, parentVal.formatted, formattedList]
        );
      }

      await client.query(
        `UPDATE master_products
         SET ncm_status = 'conflict',
             ncm_fiscal_risk = true,
             updated_at = now()
         WHERE id = $1`,
        [masterProductId]
      );

      await client.query(
        `INSERT INTO ncm_audit_log (master_product_id, previous_ncm, new_ncm, decision)
         VALUES ($1, $2, $2, 'variant_conflict_detected')`,
        [masterProductId, parentVal.formatted]
      );

      return {
        master_product_id: masterProductId,
        ncm_digits: parentVal.digits,
        ncm_formatted: parentVal.formatted,
        ncm_status: 'conflict',
        ncm_fiscal_risk: true,
        blocksContentAndCreate: true,
        conflictNcmsFormatted: formattedList,
        suggestionCreatedId: null,
      };
    }

    // 2. Sem conflito entre variantes: consolida candidato externo válido (se existir)
    const externalCandidateVal = externalProductLevelNcm?.rawNcm
      ? validateNcmCode(externalProductLevelNcm.rawNcm)
      : distinctVariantValidNcms.length === 1
      ? validateNcmCode(distinctVariantValidNcms[0])
      : null;

    const externalPlatform = externalProductLevelNcm?.platform ?? 'mercadolivre';

    // Caso 2A: Bling com NCM válido
    if (parentVal.valid && parentVal.digits && parentVal.formatted) {
      if (
        externalCandidateVal?.valid &&
        externalCandidateVal.digits &&
        externalCandidateVal.digits !== parentVal.digits
      ) {
        const existingMismatch = await client.query<{ id: string }>(
          `SELECT id FROM ncm_divergence_alerts
           WHERE master_product_id = $1
             AND alert_type = 'external_mismatch'
             AND status = 'open'`,
          [masterProductId]
        );
        if (existingMismatch.rowCount === 0) {
          await client.query(
            `INSERT INTO ncm_divergence_alerts (
               master_product_id, bling_ncm, external_ncm, alert_type, status
             ) VALUES ($1, $2, $3, 'external_mismatch', 'open')`,
            [masterProductId, parentVal.formatted, externalCandidateVal.formatted]
          );
        }

        await client.query(
          `UPDATE master_products
           SET ncm = $2,
               ncm_status = 'divergent',
               ncm_fiscal_risk = true,
               updated_at = now()
           WHERE id = $1`,
          [masterProductId, parentVal.digits]
        );

        return {
          master_product_id: masterProductId,
          ncm_digits: parentVal.digits,
          ncm_formatted: parentVal.formatted,
          ncm_status: 'divergent',
          ncm_fiscal_risk: true,
          blocksContentAndCreate: true,
          conflictNcmsFormatted: [],
          suggestionCreatedId: null,
        };
      }

      await client.query(
        `UPDATE master_products
         SET ncm = $2,
             ncm_status = 'valid',
             ncm_fiscal_risk = false,
             ncm_validated_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [masterProductId, parentVal.digits]
      );

      return {
        master_product_id: masterProductId,
        ncm_digits: parentVal.digits,
        ncm_formatted: parentVal.formatted,
        ncm_status: 'valid',
        ncm_fiscal_risk: false,
        blocksContentAndCreate: false,
        conflictNcmsFormatted: [],
        suggestionCreatedId: null,
      };
    }

    // Caso 2B: Bling vazio
    if (parentVal.reason === 'empty') {
      if (externalCandidateVal?.valid && externalCandidateVal.formatted) {
        const expiresAt = new Date(Date.now() + 15 * 86_400_000).toISOString();
        const sugRes = await client.query<{ id: string }>(
          `INSERT INTO ncm_manual_suggestions (
             master_product_id, proposed_ncm, source_platform, status, expires_at
           ) VALUES ($1, $2, $3, 'pending_first', $4)
           RETURNING id`,
          [masterProductId, externalCandidateVal.formatted, externalPlatform, expiresAt]
        );

        await client.query(
          `UPDATE master_products
           SET ncm_status = 'pending_approval',
               ncm_fiscal_risk = true,
               updated_at = now()
           WHERE id = $1`,
          [masterProductId]
        );

        return {
          master_product_id: masterProductId,
          ncm_digits: null,
          ncm_formatted: null,
          ncm_status: 'pending_approval',
          ncm_fiscal_risk: true,
          blocksContentAndCreate: true,
          conflictNcmsFormatted: [],
          suggestionCreatedId: sugRes.rows[0]?.id ?? null,
        };
      }

      await client.query(
        `UPDATE master_products
         SET ncm_status = 'unknown',
             ncm_fiscal_risk = true,
             updated_at = now()
         WHERE id = $1`,
        [masterProductId]
      );

      return {
        master_product_id: masterProductId,
        ncm_digits: null,
        ncm_formatted: null,
        ncm_status: 'unknown',
        ncm_fiscal_risk: true,
        blocksContentAndCreate: true,
        conflictNcmsFormatted: [],
        suggestionCreatedId: null,
      };
    }

    // Caso 2C: Bling preenchido, porém inválido (truncado, capítulo inválido ou placeholder)
    const existingInvalid = await client.query<{ id: string }>(
      `SELECT id FROM ncm_divergence_alerts
       WHERE master_product_id = $1
         AND alert_type = 'invalid_bling_ncm'
         AND status = 'open'`,
      [masterProductId]
    );
    if (existingInvalid.rowCount === 0) {
      await client.query(
        `INSERT INTO ncm_divergence_alerts (
           master_product_id, bling_ncm, alert_type, status
         ) VALUES ($1, $2, 'invalid_bling_ncm', 'open')`,
        [masterProductId, product.ncm]
      );
    }

    await client.query(
      `UPDATE master_products
       SET ncm_status = 'invalid',
           ncm_fiscal_risk = true,
           updated_at = now()
       WHERE id = $1`,
      [masterProductId]
    );

    return {
      master_product_id: masterProductId,
      ncm_digits: parentVal.digits,
      ncm_formatted: null,
      ncm_status: 'invalid',
      ncm_fiscal_risk: true,
      blocksContentAndCreate: true,
      conflictNcmsFormatted: [],
      suggestionCreatedId: null,
    };
  });
}

/**
 * Fluxo de dupla confirmação de NCM por dois usuários distintos com papel fiscal_approver (Seções 6 e 8.4).
 */
export async function confirmNcmSuggestionStep(input: {
  suggestionId: string;
  reviewerUserId: string;
  note: string;
}): Promise<{
  status: 'pending_second' | 'approved';
  masterProductId: string;
  approvedNcmDigits: string | null;
}> {
  if (!input.note || input.note.trim().length === 0) {
    throw new Error('Nota de revisão / consulta à TIPI é obrigatória');
  }

  return withTransaction(async (client: PoolClient) => {
    const roleCheck = await client.query<{ role: string }>(
      `SELECT role FROM user_roles WHERE user_id = $1 AND role = 'fiscal_approver'`,
      [input.reviewerUserId]
    );
    if (roleCheck.rowCount === 0) {
      throw new Error('Apenas usuários com papel fiscal_approver podem aprovar sugestões de NCM');
    }

    const sugRes = await client.query<{
      id: string;
      master_product_id: string;
      proposed_ncm: string;
      status: string;
      first_review_by: string | null;
    }>(
      `SELECT id, master_product_id, proposed_ncm, status, first_review_by
       FROM ncm_manual_suggestions
       WHERE id = $1
       FOR UPDATE`,
      [input.suggestionId]
    );

    const sug = sugRes.rows[0];
    if (!sug) {
      throw new Error(`Sugestão NCM ${input.suggestionId} não encontrada`);
    }

    if (sug.status === 'pending_first') {
      await client.query(
        `UPDATE ncm_manual_suggestions
         SET status = 'pending_second',
             first_review_by = $2,
             first_review_at = now(),
             first_review_note = $3
         WHERE id = $1`,
        [sug.id, input.reviewerUserId, input.note.trim()]
      );

      return {
        status: 'pending_second',
        masterProductId: sug.master_product_id,
        approvedNcmDigits: null,
      };
    }

    if (sug.status === 'pending_second') {
      if (sug.first_review_by === input.reviewerUserId) {
        throw new Error('A segunda revisão de NCM deve ser feita por outro usuário fiscal_approver');
      }

      const validated = validateNcmCode(sug.proposed_ncm);
      if (!validated.valid || !validated.digits || !validated.formatted) {
        throw new Error(`NCM proposto inválido: ${sug.proposed_ncm}`);
      }

      await client.query(
        `UPDATE ncm_manual_suggestions
         SET status = 'approved',
             second_review_by = $2,
             second_review_at = now(),
             tipi_consultation_note = $3
         WHERE id = $1`,
        [sug.id, input.reviewerUserId, input.note.trim()]
      );

      const prevProd = await client.query<{ ncm: string | null }>(
        `SELECT ncm FROM master_products WHERE id = $1 FOR UPDATE`,
        [sug.master_product_id]
      );
      const prevNcm = prevProd.rows[0]?.ncm ?? null;

      await client.query(
        `UPDATE master_products
         SET ncm = $2,
             ncm_status = 'valid',
             ncm_fiscal_risk = false,
             ncm_validated_at = now(),
             ncm_validated_by = $3,
             updated_at = now()
         WHERE id = $1`,
        [sug.master_product_id, validated.digits, input.reviewerUserId]
      );

      await client.query(
        `INSERT INTO ncm_audit_log (
           master_product_id, previous_ncm, new_ncm, decision,
           first_review_by, second_review_by, tipi_note
         ) VALUES ($1, $2, $3, 'dual_approved', $4, $5, $6)`,
        [
          sug.master_product_id,
          prevNcm,
          validated.formatted,
          sug.first_review_by,
          input.reviewerUserId,
          input.note.trim(),
        ]
      );

      return {
        status: 'approved',
        masterProductId: sug.master_product_id,
        approvedNcmDigits: validated.digits,
      };
    }

    throw new Error(`Sugestão NCM não está pendente de aprovação (status atual: ${sug.status})`);
  });
}
