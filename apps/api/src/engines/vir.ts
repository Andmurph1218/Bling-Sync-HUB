/**
 * Motor VIR — Variant Identity Resolution & Matrix Analysis (Seções 8.2, 9.3 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Roda depois do pai resolvido.
 * - Auto-vínculo da variante:
 *   1. SKU da variante com um único candidato.
 *   2. EAN da variante com GVE válido e um único dono (sem duplicate).
 *   3. comboKey com todos os eixos normalizados por aliases ('Medium' e 'Médio' -> 'M') e um único candidato.
 *      Eixo ou valor desconhecido vai para revisão e não casa sozinho.
 * - Produto simples liga na variante is_default.
 * - No Mercado Livre, conta com a tag user_product_seller publica e sincroniza no formato User Product
 *   (um item por condição de venda, com family_name, SEM array variations).
 * - Vários itens com o mesmo user_product_id são condições de venda da mesma variante, não linhas novas na matriz.
 * - Lacunas em variant_matrix_analysis: missing_ml / missing_ns e extra_ml / extra_ns (abre alerta crítico).
 */

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import { validateGs1Gtin } from './gve.js';
import { normalizeSkuForMatch } from './pire.js';

export interface RawExternalAttribute {
  axisNameOrId: string;
  value: string;
}

export interface NormalizedComboKeyResult {
  comboKey: string | null;
  normalizedAttributes: Array<{
    axisCanonicalName: string;
    canonicalValue: string;
  }>;
  hasUnknownAxisOrValue: boolean;
  unknownDetails: string[];
}

/**
 * Normaliza atributos de variação consultando attribute_axes e attribute_value_aliases no banco
 * antes de montar o comboKey ordenado pelo nome canônico do eixo (Seção 8.2).
 */
export async function normalizeVariantComboKey(
  rawAttributes: RawExternalAttribute[],
  client: PoolClient
): Promise<NormalizedComboKeyResult> {
  if (rawAttributes.length === 0) {
    return {
      comboKey: null,
      normalizedAttributes: [],
      hasUnknownAxisOrValue: false,
      unknownDetails: [],
    };
  }

  const axesRes = await client.query<{
    id: string;
    canonical_name: string;
    display_name: string;
    bling_key: string | null;
    ml_attribute_id: string | null;
    ns_option_name: string | null;
  }>(
    `SELECT id, canonical_name, display_name, bling_key, ml_attribute_id, ns_option_name
     FROM attribute_axes`
  );

  const aliasesRes = await client.query<{
    axis_id: string;
    canonical_value: string;
    aliases: string[];
  }>(`SELECT axis_id, canonical_value, aliases FROM attribute_value_aliases`);

  const normalized: Array<{ axisCanonicalName: string; canonicalValue: string }> = [];
  const unknownDetails: string[] = [];

  for (const attr of rawAttributes) {
    const keyUpper = attr.axisNameOrId.trim().toUpperCase();
    const keyClean = attr.axisNameOrId
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    const matchedAxis = axesRes.rows.find(
      (ax) =>
        ax.canonical_name.toLowerCase() === keyClean ||
        ax.display_name.toLowerCase() === keyClean ||
        ax.bling_key?.toLowerCase() === keyClean ||
        ax.ml_attribute_id?.toUpperCase() === keyUpper ||
        ax.ns_option_name?.toLowerCase() === keyClean
    );

    if (!matchedAxis) {
      unknownDetails.push(`axis:${attr.axisNameOrId}`);
      continue;
    }

    const valClean = attr.value.trim().toLowerCase();
    const axisAliases = aliasesRes.rows.filter((al) => al.axis_id === matchedAxis.id);

    let resolvedValue: string | null = null;
    if (axisAliases.length === 0) {
      // Eixos abertos (ex: cor/peso) usam TitleCase canônico se não houver tabela restrita de aliases,
      // exceto se o valor estiver vazio
      if (attr.value.trim().length > 0) {
        resolvedValue =
          attr.value.trim().charAt(0).toUpperCase() +
          attr.value.trim().slice(1).toLowerCase();
      }
    } else {
      const matchedAlias = axisAliases.find(
        (al) =>
          al.canonical_value.toLowerCase() === valClean ||
          al.aliases.some((a) => a.toLowerCase() === valClean)
      );
      if (matchedAlias) {
        resolvedValue = matchedAlias.canonical_value;
      }
    }

    if (!resolvedValue) {
      unknownDetails.push(`value:${matchedAxis.canonical_name}=${attr.value}`);
      continue;
    }

    normalized.push({
      axisCanonicalName: matchedAxis.canonical_name,
      canonicalValue: resolvedValue,
    });
  }

  normalized.sort((a, b) => a.axisCanonicalName.localeCompare(b.axisCanonicalName));
  const hasUnknown = unknownDetails.length > 0;
  const comboKey =
    !hasUnknown && normalized.length > 0
      ? normalized.map((n) => `${n.axisCanonicalName}:${n.canonicalValue}`).join('|')
      : null;

  return {
    comboKey,
    normalizedAttributes: normalized,
    hasUnknownAxisOrValue: hasUnknown,
    unknownDetails,
  };
}

export interface ExternalChannelVariantInput {
  platform_variant_id: string;
  user_product_id?: string | null;
  sku?: string | null;
  platform_sku_field?: string | null;
  ean?: string | null;
  price: number;
  stock: number;
  raw_attributes: RawExternalAttribute[];
  selling_conditions?: Array<{
    item_id: string;
    listing_status: string;
    price: number;
    logistic_type?: string | null;
    inventory_id?: string | null;
  }>;
}

export interface VirResolutionReport {
  master_product_id: string;
  platform: 'mercadolivre' | 'nuvemshop';
  linkedVariants: Array<{
    variant_id: string;
    platform_variant_id: string;
    match_method: 'default_simple' | 'sku' | 'ean' | 'combo_key';
    match_confidence: number;
  }>;
  unmatchedChannelVariants: string[];
  matrixStatuses: Array<{
    combo_key: string;
    status: 'ok' | 'missing_ml' | 'missing_ns' | 'extra_ml' | 'extra_ns' | 'discontinued';
  }>;
}

/**
 * Executa o motor VIR para vincular as variantes de um produto pai já resolvido e atualizar
 * variant_matrix_analysis e ml_selling_conditions (com trilha em control_changes).
 */
export async function resolveProductVariantsVir(input: {
  masterProductId: string;
  platform: 'mercadolivre' | 'nuvemshop';
  platformProductId: string;
  channelVariants: ExternalChannelVariantInput[];
}): Promise<VirResolutionReport> {
  return withTransaction(async (client: PoolClient) => {
    const blingVarsRes = await client.query<{
      id: string;
      bling_sku: string;
      is_default: boolean;
      ean: string | null;
      ean_status: string;
      variant_status: 'active' | 'inactive' | 'discontinued';
    }>(
      `SELECT id, bling_sku, is_default, ean, ean_status, variant_status
       FROM product_variants
       WHERE master_product_id = $1
       FOR UPDATE`,
      [input.masterProductId]
    );

    const activeBlingVars = blingVarsRes.rows.filter(
      (v) => v.variant_status !== 'discontinued'
    );

    // Carrega atributos das variantes do Bling para montar o comboKey de cada variante
    const blingComboKeyByVar = new Map<string, string>();
    for (const bv of activeBlingVars) {
      if (bv.is_default) {
        blingComboKeyByVar.set(bv.id, 'default');
        continue;
      }
      const vaRes = await client.query<{
        canonical_name: string;
        canonical_value: string;
      }>(
        `SELECT ax.canonical_name, va.canonical_value
         FROM variant_attributes va
         INNER JOIN attribute_axes ax ON ax.id = va.axis_id
         WHERE va.variant_id = $1`,
        [bv.id]
      );
      if (vaRes.rows.length > 0) {
        const sorted = [...vaRes.rows].sort((a, b) =>
          a.canonical_name.localeCompare(b.canonical_name)
        );
        const key = sorted
          .map((r) => `${r.canonical_name}:${r.canonical_value}`)
          .join('|');
        blingComboKeyByVar.set(bv.id, key);
      } else {
        blingComboKeyByVar.set(bv.id, `sku:${bv.bling_sku}`);
      }
    }

    // Deduplica entradas do canal pelo user_product_id quando presente (vários itens com mesmo user_product_id são condições da mesma variante)
    const consolidatedChannelVariants: ExternalChannelVariantInput[] = [];
    const byUpId = new Map<string, ExternalChannelVariantInput>();

    for (const cv of input.channelVariants) {
      if (cv.user_product_id) {
        const existing = byUpId.get(cv.user_product_id);
        if (existing) {
          existing.selling_conditions = [
            ...(existing.selling_conditions ?? []),
            ...(cv.selling_conditions ?? []),
          ];
          continue;
        }
        const clone: ExternalChannelVariantInput = {
          ...cv,
          platform_variant_id: cv.user_product_id,
          selling_conditions: [...(cv.selling_conditions ?? [])],
        };
        byUpId.set(cv.user_product_id, clone);
        consolidatedChannelVariants.push(clone);
      } else {
        consolidatedChannelVariants.push(cv);
      }
    }

    const linkedVariants: VirResolutionReport['linkedVariants'] = [];
    const unmatchedChannelVariants: string[] = [];
    const matchedBlingVarIds = new Set<string>();
    const extraChannelComboKeys: string[] = [];

    const defaultBlingVar = activeBlingVars.find((v) => v.is_default) ?? null;

    for (const cv of consolidatedChannelVariants) {
      const comboNorm = await normalizeVariantComboKey(cv.raw_attributes, client);
      let matchedVarId: string | null = null;
      let matchMethod: 'default_simple' | 'sku' | 'ean' | 'combo_key' | null = null;
      let confidence = 0;

      // 1. Produto simples: liga na variante is_default
      if (
        defaultBlingVar &&
        activeBlingVars.length === 1 &&
        consolidatedChannelVariants.length === 1
      ) {
        matchedVarId = defaultBlingVar.id;
        matchMethod = 'default_simple';
        confidence = 95;
      }

      // 2. SKU da variante com único candidato
      if (!matchedVarId && cv.sku) {
        const normSku = normalizeSkuForMatch(cv.sku);
        const skuMatches = activeBlingVars.filter(
          (bv) => normalizeSkuForMatch(bv.bling_sku) === normSku
        );
        if (skuMatches.length === 1) {
          matchedVarId = skuMatches[0]!.id;
          matchMethod = 'sku';
          confidence = 95;
        }
      }

      // 3. EAN da variante com GVE válido e único dono
      if (!matchedVarId && cv.ean) {
        const gs1 = validateGs1Gtin(cv.ean);
        if (gs1.valid && gs1.normalizedDigits) {
          const eanMatches = activeBlingVars.filter(
            (bv) => bv.ean === gs1.normalizedDigits && bv.ean_status !== 'duplicate'
          );
          if (eanMatches.length === 1) {
            matchedVarId = eanMatches[0]!.id;
            matchMethod = 'ean';
            confidence = 95;
          }
        }
      }

      // 4. comboKey com todos os eixos normalizados e único candidato
      if (!matchedVarId && comboNorm.comboKey && !comboNorm.hasUnknownAxisOrValue) {
        const comboMatches = activeBlingVars.filter(
          (bv) => blingComboKeyByVar.get(bv.id) === comboNorm.comboKey
        );
        if (comboMatches.length === 1) {
          matchedVarId = comboMatches[0]!.id;
          matchMethod = 'combo_key';
          confidence = 90;
        }
      }

      if (!matchedVarId || !matchMethod) {
        unmatchedChannelVariants.push(cv.platform_variant_id);
        const extraKey =
          comboNorm.comboKey ?? `extra:${input.platform}:${cv.platform_variant_id}`;
        extraChannelComboKeys.push(extraKey);
        continue;
      }

      matchedBlingVarIds.add(matchedVarId);
      linkedVariants.push({
        variant_id: matchedVarId,
        platform_variant_id: cv.platform_variant_id,
        match_method: matchMethod,
        match_confidence: confidence,
      });

      const pvLinkRes = await client.query<{ id: string }>(
        `INSERT INTO platform_variant_links (
           variant_id, master_product_id, platform, platform_product_id, platform_variant_id,
           platform_sku_raw, platform_sku_field, raw_attributes, normalized_attributes,
           match_method, match_confidence, platform_price, platform_stock, platform_ean,
           user_product_id, sync_status, last_synced_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'linked', now())
         ON CONFLICT (platform, platform_product_id, platform_variant_id) DO UPDATE
           SET variant_id = EXCLUDED.variant_id,
               match_method = EXCLUDED.match_method,
               match_confidence = EXCLUDED.match_confidence,
               platform_price = EXCLUDED.platform_price,
               platform_stock = EXCLUDED.platform_stock,
               last_synced_at = now()
         RETURNING id`,
        [
          matchedVarId,
          input.masterProductId,
          input.platform,
          input.platformProductId,
          cv.platform_variant_id,
          cv.sku ?? null,
          cv.platform_sku_field ?? null,
          JSON.stringify(cv.raw_attributes),
          JSON.stringify(comboNorm.normalizedAttributes),
          matchMethod,
          confidence,
          cv.price,
          cv.stock,
          cv.ean ?? null,
          cv.user_product_id ?? null,
        ]
      );

      const pvLinkId = pvLinkRes.rows[0]!.id;

      // Grava condições de venda no Mercado Livre e trilha de follow_store_price em control_changes (Seção 9.3)
      if (input.platform === 'mercadolivre' && cv.selling_conditions) {
        const conds = cv.selling_conditions;
        for (let idx = 0; idx < conds.length; idx++) {
          const cond = conds[idx]!;
          const existingCondRes = await client.query<{
            id: string;
            follow_store_price: boolean;
            follow_set_by: string | null;
          }>(
            `SELECT id, follow_store_price, follow_set_by
             FROM ml_selling_conditions
             WHERE item_id = $1
             FOR UPDATE`,
            [cond.item_id]
          );

          const existingCond = existingCondRes.rows[0];
          const defaultFollow = conds.length === 1 ? true : idx === 0;

          if (!existingCond) {
            await client.query(
              `INSERT INTO ml_selling_conditions (
                 platform_variant_link_id, item_id, listing_status, price,
                 follow_store_price, follow_set_by, logistic_type, inventory_id, last_synced_at
               ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, now())`,
              [
                pvLinkId,
                cond.item_id,
                cond.listing_status,
                cond.price,
                defaultFollow,
                cond.logistic_type ?? null,
                cond.inventory_id ?? null,
              ]
            );

            // Nascimento da condição grava control_changes com origin = 'system' e old_value = NULL
            await client.query(
              `INSERT INTO control_changes (
                 target, target_key, field, old_value, new_value, origin, changed_by
               ) VALUES ('selling_condition', $1, 'follow_store_price', NULL, $2, 'system', NULL)`,
              [cond.item_id, String(defaultFollow)]
            );
          } else {
            // Se follow_set_by está preenchido (admin fixou), o sync não altera follow_store_price
            const nextFollow =
              existingCond.follow_set_by !== null
                ? existingCond.follow_store_price
                : defaultFollow;

            await client.query(
              `UPDATE ml_selling_conditions
               SET listing_status = $2,
                   price = $3,
                   follow_store_price = $4,
                   last_synced_at = now()
               WHERE id = $1`,
              [existingCond.id, cond.listing_status, cond.price, nextFollow]
            );

            if (existingCond.follow_store_price !== nextFollow) {
              await client.query(
                `INSERT INTO control_changes (
                   target, target_key, field, old_value, new_value, origin, changed_by
                 ) VALUES ('selling_condition', $1, 'follow_store_price', $2, $3, 'system', NULL)`,
                [
                  cond.item_id,
                  String(existingCond.follow_store_price),
                  String(nextFollow),
                ]
              );
            }
          }
        }
      }
    }

    // Análise da matriz de variantes (variant_matrix_analysis)
    const matrixStatuses: VirResolutionReport['matrixStatuses'] = [];

    for (const bv of activeBlingVars) {
      const cKey = blingComboKeyByVar.get(bv.id) ?? `var:${bv.id}`;
      const isMatchedHere = matchedBlingVarIds.has(bv.id);
      const status: 'ok' | 'missing_ml' | 'missing_ns' = isMatchedHere
        ? 'ok'
        : input.platform === 'mercadolivre'
        ? 'missing_ml'
        : 'missing_ns';

      await client.query(
        `INSERT INTO variant_matrix_analysis (
           master_product_id, variant_id, combo_key, has_bling, has_ml, has_ns, status, analyzed_at
         ) VALUES ($1, $2, $3, true, $4, $5, $6, now())
         ON CONFLICT (master_product_id, combo_key) DO UPDATE
           SET has_bling = true,
               has_ml = CASE WHEN $7 = 'mercadolivre' THEN $4 ELSE variant_matrix_analysis.has_ml END,
               has_ns = CASE WHEN $7 = 'nuvemshop' THEN $5 ELSE variant_matrix_analysis.has_ns END,
               status = EXCLUDED.status,
               analyzed_at = now()`,
        [
          input.masterProductId,
          bv.id,
          cKey,
          input.platform === 'mercadolivre' ? isMatchedHere : false,
          input.platform === 'nuvemshop' ? isMatchedHere : false,
          status,
          input.platform,
        ]
      );

      matrixStatuses.push({ combo_key: cKey, status });
    }

    // Variantes extras no canal sem lastro no Bling -> extra_ml / extra_ns + alerta crítico
    for (const extraKey of extraChannelComboKeys) {
      const extraStatus = input.platform === 'mercadolivre' ? 'extra_ml' : 'extra_ns';
      await client.query(
        `INSERT INTO variant_matrix_analysis (
           master_product_id, variant_id, combo_key, has_bling, has_ml, has_ns, status, analyzed_at
         ) VALUES ($1, NULL, $2, false, $3, $4, $5, now())
         ON CONFLICT (master_product_id, combo_key) DO UPDATE
           SET status = EXCLUDED.status,
               analyzed_at = now()`,
        [
          input.masterProductId,
          extraKey,
          input.platform === 'mercadolivre',
          input.platform === 'nuvemshop',
          extraStatus,
        ]
      );

      await client.query(
        `INSERT INTO divergence_alerts (
           master_product_id, platform, alert_code, severity, external_value, status
         ) VALUES ($1, $2, $3, 'critical', $4, 'open')`,
        [input.masterProductId, input.platform, extraStatus, extraKey]
      );

      matrixStatuses.push({ combo_key: extraKey, status: extraStatus });
    }

    return {
      master_product_id: input.masterProductId,
      platform: input.platform,
      linkedVariants,
      unmatchedChannelVariants,
      matrixStatuses,
    };
  });
}

export interface MlCreateListingBuildInput {
  sellerTags: string[];
  categoryId: string;
  familyName: string;
  title: string;
  price: number;
  initialStockFloor: number;
  parentPkAttributes: Array<{ id: string; value_name: string }>;
  childPkAttributes: Array<{ id: string; value_name: string }>;
  legacyVariationsPayload?: Array<Record<string, unknown>>;
}

/**
 * Monta o corpo de publicação (CREATE) no Mercado Livre (Seção 8.2 e Seção 13 - Fase 4):
 * - Conta com a tag 'user_product_seller' publica no modelo User Product: usa family_name + atributos
 *   PARENT_PK/CHILD_PK e NUNCA publica o array 'variations'.
 * - Conta sem a tag (legado) publica com 'title' e 'variations'.
 */
export function buildMlCreateListingPayload(
  input: MlCreateListingBuildInput
): Record<string, unknown> {
  const isUserProductSeller = input.sellerTags.includes('user_product_seller');

  if (isUserProductSeller) {
    return {
      family_name: input.familyName,
      category_id: input.categoryId,
      price: input.price,
      currency_id: 'BRL',
      available_quantity: Math.max(0, Math.floor(input.initialStockFloor)),
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      attributes: [
        ...input.parentPkAttributes.map((a) => ({
          id: a.id,
          value_name: a.value_name,
        })),
        ...input.childPkAttributes.map((a) => ({
          id: a.id,
          value_name: a.value_name,
        })),
      ],
    };
  }

  return {
    title: input.title,
    category_id: input.categoryId,
    price: input.price,
    currency_id: 'BRL',
    available_quantity: Math.max(0, Math.floor(input.initialStockFloor)),
    buying_mode: 'buy_it_now',
    listing_type_id: 'gold_special',
    condition: 'new',
    attributes: input.parentPkAttributes,
    variations: input.legacyVariationsPayload ?? [],
  };
}
