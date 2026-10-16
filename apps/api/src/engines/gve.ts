/**
 * Motor GVE — GTIN / EAN Validation Engine (Seção 8.3 e Seção 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Validação estrutural: 8, 12, 13 ou 14 dígitos, dígito verificador GS1 (pesos 3/1 da direita, módulo 10),
 *   rejeição de placeholder (dígitos repetidos) e de sequência ('12345678', '1234567890128', etc.).
 * - Validação contextual: prefixo GS1 Brasil 789/790, ISBN/ISSN (977/978/979), faixa interna 200–299.
 * - Comparação usa só os dígitos. EAN vazio não conta. Variante discontinued não entra.
 * - EAN válido repetido entre variantes não descontinuadas do mesmo produto:
 *   marca ean_status = 'duplicate' e fiscal_risk_flag = true apenas nas variantes que carregam esse EAN,
 *   não entra em ean_pending_validation, abre 1 alerta por produto e EAN, e sai de duplicate quando
 *   resta apenas 1 variante não descontinuada com esse EAN.
 * - Bling vazio e externo válido: vai para ean_pending_validation (TTL 30 dias), nunca auto-preenche.
 * - Bling com EAN válido: intocável; externo diferente gera alerta crítico e bloqueia CONTENT/CREATE.
 */

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';

export type GtinLength = 8 | 12 | 13 | 14;

export type GtinContextType =
  | 'gs1_brasil'
  | 'isbn_issn'
  | 'internal_range'
  | 'gs1_international';

export interface Gs1ValidationResult {
  valid: boolean;
  normalizedDigits: string | null;
  length: GtinLength | null;
  isPlaceholder: boolean;
  checksumValid: boolean;
  contextType: GtinContextType | null;
  reason?:
    | 'empty'
    | 'non_numeric'
    | 'invalid_length'
    | 'placeholder_repeated'
    | 'placeholder_sequence'
    | 'invalid_check_digit';
}

const VALID_LENGTHS = new Set<number>([8, 12, 13, 14]);

const KNOWN_SEQUENCES = new Set<string>([
  '12345678',
  '87654321',
  '12345670',
  '123456789012',
  '1234567890128',
  '1234567890123',
  '987654321098',
  '9876543210987',
  '12345678901234',
  '12345678901231',
]);

export function computeGs1CheckDigit(bodyWithoutCheckDigit: string): number {
  let sum = 0;
  const len = bodyWithoutCheckDigit.length;
  for (let i = len - 1; i >= 0; i--) {
    const digit = Number(bodyWithoutCheckDigit[i]);
    const positionFromRight = len - i; // 1-based a partir da direita
    const weight = positionFromRight % 2 === 1 ? 3 : 1;
    sum += digit * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function isAscendingOrDescendingRun(digits: string): boolean {
  if (KNOWN_SEQUENCES.has(digits)) return true;
  // Verifica também se os primeiros (len - 1) dígitos formam sequência aritmética mod 10 (ex: 123456789012 + dígito verificador)
  const body = digits.slice(0, -1);
  let asc = true;
  let desc = true;
  for (let i = 1; i < body.length; i++) {
    const prev = Number(body[i - 1]);
    const curr = Number(body[i]);
    if (curr !== (prev + 1) % 10) asc = false;
    if (curr !== (prev + 9) % 10) desc = false;
  }
  return asc || desc;
}

export function classifyGtinContext(digits: string): GtinContextType {
  const padded13 = digits.length === 14 ? digits.slice(1) : digits;
  const prefix3 = padded13.slice(0, 3);
  const prefixNum = Number(prefix3);

  if (digits.length >= 13 && (prefix3 === '789' || prefix3 === '790')) {
    return 'gs1_brasil';
  }
  if (digits.length === 13 && (prefix3 === '977' || prefix3 === '978' || prefix3 === '979')) {
    return 'isbn_issn';
  }
  if (
    (digits.length >= 13 && prefixNum >= 200 && prefixNum <= 299) ||
    (digits.length === 8 && digits.startsWith('2'))
  ) {
    return 'internal_range';
  }
  return 'gs1_international';
}

/**
 * Validação pura estrutural e contextual de um código EAN/GTIN (Seção 8.3).
 */
export function validateGs1Gtin(raw?: string | null): Gs1ValidationResult {
  if (!raw || raw.trim().length === 0) {
    return {
      valid: false,
      normalizedDigits: null,
      length: null,
      isPlaceholder: false,
      checksumValid: false,
      contextType: null,
      reason: 'empty',
    };
  }

  const trimmed = raw.trim().replace(/[\s-]+/g, '');
  if (!/^\d+$/.test(trimmed)) {
    return {
      valid: false,
      normalizedDigits: null,
      length: null,
      isPlaceholder: false,
      checksumValid: false,
      contextType: null,
      reason: 'non_numeric',
    };
  }

  if (!VALID_LENGTHS.has(trimmed.length)) {
    return {
      valid: false,
      normalizedDigits: trimmed,
      length: null,
      isPlaceholder: false,
      checksumValid: false,
      contextType: null,
      reason: 'invalid_length',
    };
  }

  const length = trimmed.length as GtinLength;

  // Todos os dígitos iguais (ex: 0000000000000, 9999999999999)
  if (/^(\d)\1+$/.test(trimmed)) {
    return {
      valid: false,
      normalizedDigits: trimmed,
      length,
      isPlaceholder: true,
      checksumValid: false,
      contextType: null,
      reason: 'placeholder_repeated',
    };
  }

  if (isAscendingOrDescendingRun(trimmed)) {
    return {
      valid: false,
      normalizedDigits: trimmed,
      length,
      isPlaceholder: true,
      checksumValid: false,
      contextType: null,
      reason: 'placeholder_sequence',
    };
  }

  const body = trimmed.slice(0, -1);
  const actualCheck = Number(trimmed[trimmed.length - 1]);
  const expectedCheck = computeGs1CheckDigit(body);

  if (actualCheck !== expectedCheck) {
    return {
      valid: false,
      normalizedDigits: trimmed,
      length,
      isPlaceholder: false,
      checksumValid: false,
      contextType: null,
      reason: 'invalid_check_digit',
    };
  }

  const contextType = classifyGtinContext(trimmed);
  return {
    valid: true,
    normalizedDigits: trimmed,
    length,
    isPlaceholder: false,
    checksumValid: true,
    contextType,
  };
}

export interface VariantExternalEanCandidate {
  variant_id: string;
  platform: 'mercadolivre' | 'nuvemshop';
  external_ean: string | null;
}

export interface VariantGveEvaluationOutcome {
  variant_id: string;
  ean: string | null;
  ean_status: 'unknown' | 'valid' | 'invalid' | 'pending_validation' | 'divergent' | 'duplicate';
  fiscal_risk_flag: boolean;
  blocksContentAndCreate: boolean;
  queuedPendingValidation: boolean;
}

export interface ProductGveEvaluationReport {
  master_product_id: string;
  variants: VariantGveEvaluationOutcome[];
  duplicateEansInProduct: string[];
}

/**
 * Executa o motor GVE para todas as variantes de um master_product (Seção 8.3):
 * - Ignora variantes com variant_status = 'discontinued' na detecção de duplicidade.
 * - Detecta EAN válido repetido entre variantes do mesmo pai -> marca 'duplicate' e fiscal_risk_flag = true
 *   apenas nas variantes que carregam esse EAN, sem abrir ean_pending_validation, e gera 1 alerta por produto+EAN.
 * - Quando na rodada seguinte resta apenas 1 variante ativa com aquele EAN, remove 'duplicate', derruba
 *   fiscal_risk_flag (se o checksum for válido) e resolve o alerta aberto daquele EAN.
 */
export async function evaluateProductGve(
  masterProductId: string,
  externalCandidates: VariantExternalEanCandidate[] = []
): Promise<ProductGveEvaluationReport> {
  return withTransaction(async (client: PoolClient) => {
    const varRes = await client.query<{
      id: string;
      ean: string | null;
      ean_status: string;
      fiscal_risk_flag: boolean;
      variant_status: 'active' | 'inactive' | 'discontinued';
    }>(
      `SELECT id, ean, ean_status, fiscal_risk_flag, variant_status
       FROM product_variants
       WHERE master_product_id = $1
       ORDER BY created_at ASC, id ASC
       FOR UPDATE`,
      [masterProductId]
    );

    const activeVariants = varRes.rows.filter(
      (v) => v.variant_status !== 'discontinued'
    );

    // 1. Conta frequência de cada EAN válido (apenas dígitos) entre as variantes não descontinuadas do mesmo pai
    const validEanFrequency = new Map<string, string[]>();
    const validationByVariant = new Map<string, Gs1ValidationResult>();

    for (const v of activeVariants) {
      const val = validateGs1Gtin(v.ean);
      validationByVariant.set(v.id, val);
      if (val.valid && val.normalizedDigits) {
        const list = validEanFrequency.get(val.normalizedDigits) ?? [];
        list.push(v.id);
        validEanFrequency.set(val.normalizedDigits, list);
      }
    }

    const duplicateEans = new Set<string>();
    for (const [digits, variantIds] of validEanFrequency.entries()) {
      if (variantIds.length > 1) {
        duplicateEans.add(digits);
      }
    }

    // Resolve alertas antigos de ean_duplicate_in_product cujo EAN não está mais duplicado
    const openDupAlerts = await client.query<{ id: string; bling_value: string | null }>(
      `SELECT id, bling_value
       FROM divergence_alerts
       WHERE master_product_id = $1
         AND alert_code = 'ean_duplicate_in_product'
         AND status = 'open'`,
      [masterProductId]
    );

    for (const alertRow of openDupAlerts.rows) {
      if (!alertRow.bling_value || !duplicateEans.has(alertRow.bling_value)) {
        await client.query(
          `UPDATE divergence_alerts
           SET status = 'resolved', resolved_at = now()
           WHERE id = $1`,
          [alertRow.id]
        );
      }
    }

    // Garante 1 único alerta aberto por produto e EAN duplicado
    for (const dupEan of duplicateEans) {
      const alreadyOpen = openDupAlerts.rows.some((a) => a.bling_value === dupEan);
      if (!alreadyOpen) {
        await client.query(
          `INSERT INTO divergence_alerts (
             master_product_id, alert_code, severity, bling_value, details, status
           ) VALUES ($1, 'ean_duplicate_in_product', 'critical', $2, $3, 'open')`,
          [
            masterProductId,
            dupEan,
            JSON.stringify({
              variantIds: validEanFrequency.get(dupEan) ?? [],
            }),
          ]
        );
      }
    }

    const outcomes: VariantGveEvaluationOutcome[] = [];

    for (const v of activeVariants) {
      const blingVal = validationByVariant.get(v.id)!;
      const extForVariant = externalCandidates.filter(
        (c) => c.variant_id === v.id && c.external_ean && c.external_ean.trim().length > 0
      );

      let nextStatus: VariantGveEvaluationOutcome['ean_status'] = 'unknown';
      let nextRisk = false;
      let queuedPending = false;

      // Caso A: EAN válido repetido entre variantes não descontinuadas do mesmo pai
      if (
        blingVal.valid &&
        blingVal.normalizedDigits &&
        duplicateEans.has(blingVal.normalizedDigits)
      ) {
        nextStatus = 'duplicate';
        nextRisk = true;
      } else if (blingVal.valid && blingVal.normalizedDigits) {
        // Caso B: Bling com EAN válido e único no produto
        let hasExternalMismatch = false;

        for (const ext of extForVariant) {
          const extVal = validateGs1Gtin(ext.external_ean);
          if (extVal.isPlaceholder) {
            continue;
          }
          const extDigits = ext.external_ean!.replace(/\D+/g, '');
          if (extDigits.length > 0 && extDigits !== blingVal.normalizedDigits) {
            hasExternalMismatch = true;
            const existingMismatch = await client.query<{ id: string }>(
              `SELECT id FROM divergence_alerts
               WHERE master_product_id = $1
                 AND variant_id = $2
                 AND platform = $3
                 AND alert_code = 'ean_external_mismatch'
                 AND status = 'open'`,
              [masterProductId, v.id, ext.platform]
            );
            if (existingMismatch.rowCount === 0) {
              await client.query(
                `INSERT INTO divergence_alerts (
                   master_product_id, variant_id, platform, alert_code, severity,
                   bling_value, external_value, status
                 ) VALUES ($1, $2, $3, 'ean_external_mismatch', 'critical', $4, $5, 'open')`,
                [
                  masterProductId,
                  v.id,
                  ext.platform,
                  blingVal.normalizedDigits,
                  extDigits,
                ]
              );
            }
          }
        }

        if (hasExternalMismatch) {
          nextStatus = 'divergent';
          nextRisk = true;
        } else {
          nextStatus = 'valid';
          nextRisk = false;
        }
      } else if (blingVal.reason === 'empty') {
        // Caso C: Bling vazio -> verifica candidatos externos válidos
        for (const ext of extForVariant) {
          const extVal = validateGs1Gtin(ext.external_ean);
          if (
            extVal.valid &&
            extVal.normalizedDigits &&
            extVal.contextType !== 'internal_range'
          ) {
            const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
            await client.query(
              `INSERT INTO ean_pending_validation (
                 variant_id, master_product_id, proposed_ean, source_platform,
                 gs1_valid, context_type, status, expires_at
               ) VALUES ($1, $2, $3, $4, true, $5, 'pending', $6)
               ON CONFLICT (variant_id, proposed_ean, source_platform) DO NOTHING`,
              [
                v.id,
                masterProductId,
                extVal.normalizedDigits,
                ext.platform,
                extVal.contextType,
                expiresAt,
              ]
            );
            queuedPending = true;
          }
        }
        nextStatus = queuedPending ? 'pending_validation' : 'unknown';
        nextRisk = false;
      } else {
        // Caso D: Bling preenchido, porém inválido ou placeholder
        nextStatus = 'invalid';
        nextRisk = true;
      }

      if (v.ean_status !== nextStatus || v.fiscal_risk_flag !== nextRisk) {
        await client.query(
          `UPDATE product_variants
           SET ean = $2,
               ean_status = $3,
               fiscal_risk_flag = $4,
               ean_validated_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [v.id, blingVal.normalizedDigits ?? v.ean, nextStatus, nextRisk]
        );

        await client.query(
          `INSERT INTO ean_validation_history (
             variant_id, master_product_id, ean, previous_status, new_status, action, details
           ) VALUES ($1, $2, $3, $4, $5, 'gve_evaluate', $6)`,
          [
            v.id,
            masterProductId,
            blingVal.normalizedDigits ?? v.ean,
            v.ean_status,
            nextStatus,
            JSON.stringify({
              fiscal_risk_flag: nextRisk,
              reason: blingVal.reason ?? null,
              contextType: blingVal.contextType ?? null,
            }),
          ]
        );
      }

      outcomes.push({
        variant_id: v.id,
        ean: blingVal.normalizedDigits ?? v.ean,
        ean_status: nextStatus,
        fiscal_risk_flag: nextRisk,
        blocksContentAndCreate: nextRisk,
        queuedPendingValidation: queuedPending,
      });
    }

    return {
      master_product_id: masterProductId,
      variants: outcomes,
      duplicateEansInProduct: Array.from(duplicateEans),
    };
  });
}
