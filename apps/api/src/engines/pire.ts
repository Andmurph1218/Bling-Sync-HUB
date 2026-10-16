/**
 * Motor PIRE — Product Identity Resolution Engine (Seções 8.1, 9.3, 9.4 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Identidade é multi-sinal: SKU único, EAN válido único (sem duplicate e sem compartilhamento entre pais),
 *   e nome com Jaro-Winkler >= 0.90 no mesmo candidato.
 * - Preço (±10%) e peso (±15%) são sinais auxiliares e NÃO contam como um dos dois sinais fortes.
 * - Auto-vínculo (score 95) exige pelo menos DOIS sinais fortes no mesmo candidato e NENHUM sinal forte em outro.
 * - Um sinal forte só (inclusive EAN sozinho) fica em sugestão com score máximo 80.
 * - GTIN/EAN compartilhado entre dois master_products diferentes não é sinal e cai em quarentena.
 * - PIRE consulta match_rejections antes do auto-vínculo e antes da sugestão. Par rejeitado nunca volta a casar.
 * - No User Product, family_confidence mede se os itens da mesma family_id apontam para um só master_product:
 *   conflito entre itens da família cai em quarentena e NÃO parte a família.
 */

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import { validateGs1Gtin } from './gve.js';

const PORTUGUESE_STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'com',
  'para',
  'e',
  'o',
  'a',
  'em',
]);

export function normalizeProductTitleForFuzzy(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !PORTUGUESE_STOPWORDS.has(token))
    .join(' ');
}

/**
 * Similaridade Jaro-Winkler (0.0 a 1.0) sobre títulos normalizados (Seção 8.1).
 */
export function jaroWinklerSimilarity(rawA?: string | null, rawB?: string | null): number {
  const s1 = normalizeProductTitleForFuzzy(rawA);
  const s2 = normalizeProductTitleForFuzzy(rawB);

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);

  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  const transpositions = t / 2;
  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, len1, len2);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return Number((jaro + prefix * 0.1 * (1 - jaro)).toFixed(4));
}

export function normalizeSkuForMatch(raw?: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export interface PireExternalItemInput {
  platform: 'mercadolivre' | 'nuvemshop';
  platform_product_id: string;
  item_id?: string;
  title: string;
  skus: string[];
  platform_sku_field?: string | null;
  eans: string[];
  price?: number | null;
  weight?: number | null;
  ml_model?: 'legacy_variations' | 'user_product' | null;
  family_id?: string | null;
  family_name?: string | null;
  raw_payload?: Record<string, unknown>;
}

export interface CandidateEvaluation {
  master_product_id: string;
  bling_sku: string;
  name: string | null;
  strongSignals: Array<'sku' | 'ean' | 'name_jw_90'>;
  auxiliarySignals: Array<'name_jw_70_89' | 'price_10pct' | 'weight_15pct'>;
  nameSimilarity: number;
  score: number;
}

export interface PireResolutionResult {
  platform: 'mercadolivre' | 'nuvemshop';
  platform_product_id: string;
  outcome: 'auto_linked' | 'suggestion' | 'quarantine' | 'already_terminal';
  master_product_id: string | null;
  confidence: number | null;
  family_confidence: number | null;
  sharedEanQuarantine: boolean;
  candidates: CandidateEvaluation[];
  signalsBreakdown: Record<string, unknown>;
}

async function loadActiveCatalogForPire(client: PoolClient) {
  const prodsRes = await client.query<{
    id: string;
    bling_sku: string;
    name: string | null;
  }>(
    `SELECT id, bling_sku, name
     FROM master_products
     WHERE catalog_status = 'active'`
  );

  const varsRes = await client.query<{
    id: string;
    master_product_id: string;
    bling_sku: string;
    ean: string | null;
    ean_status: string;
    price: string | number | null;
    net_weight: string | number | null;
  }>(
    `SELECT id, master_product_id, bling_sku, ean, ean_status, price, net_weight
     FROM product_variants
     WHERE variant_status <> 'discontinued'`
  );

  return {
    products: prodsRes.rows,
    variants: varsRes.rows,
  };
}

/**
 * Avalia sinais fortes e auxiliares de um item externo contra o catálogo ativo do Bling,
 * filtrando pares já presentes em match_rejections.
 */
function evaluateItemSignalsAgainstCatalog(
  item: PireExternalItemInput,
  catalog: Awaited<ReturnType<typeof loadActiveCatalogForPire>>,
  rejectedMasterIds: Set<string>
): {
  sharedEansAcrossProducts: string[];
  candidates: CandidateEvaluation[];
} {
  const skuOwners = new Map<string, Set<string>>();
  const eanOwners = new Map<string, Set<string>>();

  for (const p of catalog.products) {
    const normSku = normalizeSkuForMatch(p.bling_sku);
    if (normSku) {
      const set = skuOwners.get(normSku) ?? new Set<string>();
      set.add(p.id);
      skuOwners.set(normSku, set);
    }
  }

  for (const v of catalog.variants) {
    const normSku = normalizeSkuForMatch(v.bling_sku);
    if (normSku) {
      const set = skuOwners.get(normSku) ?? new Set<string>();
      set.add(v.master_product_id);
      skuOwners.set(normSku, set);
    }

    // EAN duplicate entre variantes do mesmo produto NÃO é sinal forte (Seção 8.3)
    if (v.ean && v.ean_status !== 'duplicate') {
      const gs1 = validateGs1Gtin(v.ean);
      if (gs1.valid && gs1.normalizedDigits && gs1.contextType !== 'internal_range') {
        const set = eanOwners.get(gs1.normalizedDigits) ?? new Set<string>();
        set.add(v.master_product_id);
        eanOwners.set(gs1.normalizedDigits, set);
      }
    }
  }

  const itemNormSkus = Array.from(
    new Set(item.skus.map((s) => normalizeSkuForMatch(s)).filter((s): s is string => Boolean(s)))
  );
  const itemValidEans = Array.from(
    new Set(
      item.eans
        .map((e) => validateGs1Gtin(e))
        .filter((r) => r.valid && r.normalizedDigits && r.contextType !== 'internal_range')
        .map((r) => r.normalizedDigits!)
    )
  );

  // Detecta GTIN/EAN compartilhado entre dois master_products diferentes
  const sharedEansAcrossProducts: string[] = [];
  for (const ean of itemValidEans) {
    const owners = eanOwners.get(ean);
    if (owners && owners.size > 1) {
      sharedEansAcrossProducts.push(ean);
    }
  }

  // Pré-calcula similaridade de nome para encontrar se há único candidato >= 0.90
  const nameSimByMaster = new Map<string, number>();
  const highNameMasters: string[] = [];

  for (const p of catalog.products) {
    if (rejectedMasterIds.has(p.id)) continue;
    const sim = jaroWinklerSimilarity(item.title, p.name);
    nameSimByMaster.set(p.id, sim);
    if (sim >= 0.9) {
      highNameMasters.push(p.id);
    }
  }

  const candidates: CandidateEvaluation[] = [];

  for (const p of catalog.products) {
    if (rejectedMasterIds.has(p.id)) continue;

    const strongSignals: Array<'sku' | 'ean' | 'name_jw_90'> = [];
    const auxiliarySignals: Array<'name_jw_70_89' | 'price_10pct' | 'weight_15pct'> = [];

    // 1. Sinal Forte: SKU único
    const matchesUniqueSku = itemNormSkus.some((sku) => {
      const owners = skuOwners.get(sku);
      return owners && owners.size === 1 && owners.has(p.id);
    });
    if (matchesUniqueSku) {
      strongSignals.push('sku');
    }

    // 2. Sinal Forte: EAN com GVE válido e um único dono no catálogo
    const matchesUniqueEan = itemValidEans.some((ean) => {
      const owners = eanOwners.get(ean);
      return owners && owners.size === 1 && owners.has(p.id);
    });
    if (matchesUniqueEan) {
      strongSignals.push('ean');
    }

    // 3. Sinal Forte: Nome com Jaro-Winkler >= 0.90 em candidato único
    const nameSim = nameSimByMaster.get(p.id) ?? 0;
    if (nameSim >= 0.9 && highNameMasters.length === 1 && highNameMasters[0] === p.id) {
      strongSignals.push('name_jw_90');
    } else if (nameSim >= 0.7) {
      auxiliarySignals.push('name_jw_70_89');
    }

    // Sinais auxiliares: preço (±10%) e peso (±15%) — NUNCA contam como sinal forte
    const prodVariants = catalog.variants.filter((v) => v.master_product_id === p.id);
    if (item.price && item.price > 0) {
      const priceClose = prodVariants.some((v) => {
        const vp = v.price !== null ? Number(v.price) : 0;
        return vp > 0 && Math.abs(vp - item.price!) / vp <= 0.1;
      });
      if (priceClose) auxiliarySignals.push('price_10pct');
    }

    if (item.weight && item.weight > 0) {
      const weightClose = prodVariants.some((v) => {
        const vw = v.net_weight !== null ? Number(v.net_weight) : 0;
        return vw > 0 && Math.abs(vw - item.weight!) / vw <= 0.15;
      });
      if (weightClose) auxiliarySignals.push('weight_15pct');
    }

    if (strongSignals.length === 0 && !auxiliarySignals.includes('name_jw_70_89')) {
      continue;
    }

    let score = 0;
    if (strongSignals.length >= 2) {
      score = 95;
    } else if (strongSignals.length === 1) {
      score = 80;
    } else if (nameSim >= 0.7) {
      score = Math.round(nameSim * 75);
    }

    candidates.push({
      master_product_id: p.id,
      bling_sku: p.bling_sku,
      name: p.name,
      strongSignals,
      auxiliarySignals,
      nameSimilarity: nameSim,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.nameSimilarity - a.nameSimilarity);
  return {
    sharedEansAcrossProducts,
    candidates,
  };
}

/**
 * Executa o motor PIRE para um anúncio individual (Legado ML ou Nuvemshop).
 */
export async function resolvePlatformItemPire(
  item: PireExternalItemInput
): Promise<PireResolutionResult> {
  return withTransaction(async (client: PoolClient) => {
    // Verifica se o item já está em status terminal (linked, dismissed, new_product)
    const existingItemRes = await client.query<{
      id: string;
      status: 'suggestion' | 'quarantine' | 'linked' | 'dismissed' | 'new_product';
      master_product_id: string | null;
    }>(
      `SELECT id, status, master_product_id
       FROM platform_items
       WHERE platform = $1 AND platform_product_id = $2
       FOR UPDATE`,
      [item.platform, item.platform_product_id]
    );

    const existingItem = existingItemRes.rows[0];
    if (
      existingItem &&
      (existingItem.status === 'linked' ||
        existingItem.status === 'dismissed' ||
        existingItem.status === 'new_product')
    ) {
      return {
        platform: item.platform,
        platform_product_id: item.platform_product_id,
        outcome: 'already_terminal',
        master_product_id: existingItem.master_product_id,
        confidence: existingItem.status === 'linked' ? 95 : null,
        family_confidence: null,
        sharedEanQuarantine: false,
        candidates: [],
        signalsBreakdown: { terminalStatus: existingItem.status },
      };
    }

    let platformItemId = existingItem?.id ?? null;
    const rejectedMasterIds = new Set<string>();

    if (platformItemId) {
      const rejRes = await client.query<{ master_product_id: string }>(
        `SELECT master_product_id FROM match_rejections WHERE platform_item_id = $1`,
        [platformItemId]
      );
      for (const r of rejRes.rows) {
        rejectedMasterIds.add(r.master_product_id);
      }
    }

    const catalog = await loadActiveCatalogForPire(client);
    const { sharedEansAcrossProducts, candidates } = evaluateItemSignalsAgainstCatalog(
      item,
      catalog,
      rejectedMasterIds
    );

    const candidatesWithStrong = candidates.filter((c) => c.strongSignals.length > 0);
    const topCandidate = candidates[0] ?? null;

    // Conflito ou EAN compartilhado entre dois produtos pai -> QUARENTENA
    const hasConflictingStrongCandidates = candidatesWithStrong.length > 1;
    const hasSharedEan = sharedEansAcrossProducts.length > 0;
    const hasTopTie =
      candidates.length >= 2 &&
      topCandidate !== null &&
      candidates[1]!.score === topCandidate.score &&
      topCandidate.score >= 80;

    let outcome: 'auto_linked' | 'suggestion' | 'quarantine';
    let matchedMasterId: string | null = null;
    let confidence: number | null = null;

    if (hasSharedEan || hasConflictingStrongCandidates || hasTopTie) {
      outcome = 'quarantine';
      confidence = topCandidate?.score ?? 0;
    } else if (
      topCandidate &&
      topCandidate.strongSignals.length >= 2 &&
      candidatesWithStrong.length === 1
    ) {
      outcome = 'auto_linked';
      matchedMasterId = topCandidate.master_product_id;
      confidence = 95;
    } else {
      outcome = 'suggestion';
      confidence = topCandidate ? Math.min(80, topCandidate.score) : 0;
    }

    const signalsBreakdown = {
      sharedEansAcrossProducts,
      candidates: candidates.map((c) => ({
        master_product_id: c.master_product_id,
        bling_sku: c.bling_sku,
        strongSignals: c.strongSignals,
        auxiliarySignals: c.auxiliarySignals,
        nameSimilarity: c.nameSimilarity,
        score: c.score,
      })),
    };

    const targetItemStatus =
      outcome === 'auto_linked'
        ? 'linked'
        : outcome === 'quarantine'
        ? 'quarantine'
        : 'suggestion';

    if (!platformItemId) {
      const insItem = await client.query<{ id: string }>(
        `INSERT INTO platform_items (platform, platform_product_id, status, master_product_id, updated_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id`,
        [item.platform, item.platform_product_id, targetItemStatus, matchedMasterId]
      );
      platformItemId = insItem.rows[0]!.id;
    } else {
      await client.query(
        `UPDATE platform_items
         SET status = $2,
             master_product_id = $3,
             updated_at = now()
         WHERE id = $1`,
        [platformItemId, targetItemStatus, matchedMasterId]
      );
    }

    if (outcome === 'auto_linked' && matchedMasterId) {
      await client.query(
        `INSERT INTO platform_links (
           master_product_id, platform, platform_product_id, platform_sku_raw,
           platform_sku_field, match_method, match_confidence, match_signals,
           ml_model, sync_status, last_synced_at
         ) VALUES ($1, $2, $3, $4, $5, 'auto_multi_signal', 95, $6, $7, 'linked', now())
         ON CONFLICT (platform, platform_product_id) DO UPDATE
           SET master_product_id = EXCLUDED.master_product_id,
               match_confidence = EXCLUDED.match_confidence,
               match_signals = EXCLUDED.match_signals,
               last_synced_at = now()`,
        [
          matchedMasterId,
          item.platform,
          item.platform_product_id,
          item.skus[0] ?? null,
          item.platform_sku_field ?? null,
          JSON.stringify(signalsBreakdown),
          item.platform === 'mercadolivre' ? item.ml_model ?? 'legacy_variations' : null,
        ]
      );

      await client.query(
        `UPDATE master_products SET matching_status = 'linked', updated_at = now() WHERE id = $1`,
        [matchedMasterId]
      );
    } else {
      // Grava ou atualiza matching_queue (expires_at = NULL enquanto pendente)
      const openQueue = await client.query<{ id: string }>(
        `SELECT id FROM matching_queue
         WHERE platform_item_id = $1 AND status = 'pending'`,
        [platformItemId]
      );

      if (openQueue.rowCount && openQueue.rowCount > 0) {
        await client.query(
          `UPDATE matching_queue
           SET platform_raw_data = $2,
               suggested_matches = $3,
               best_score = $4
           WHERE id = $1`,
          [
            openQueue.rows[0]!.id,
            JSON.stringify(item.raw_payload ?? item),
            JSON.stringify(candidates),
            confidence,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO matching_queue (
             platform_item_id, platform_raw_data, suggested_matches, best_score, status, expires_at
           ) VALUES ($1, $2, $3, $4, 'pending', NULL)`,
          [
            platformItemId,
            JSON.stringify(item.raw_payload ?? item),
            JSON.stringify(candidates),
            confidence,
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO identity_resolution_logs (
         platform, platform_product_id, master_product_id, engine, outcome, confidence, signals
       ) VALUES ($1, $2, $3, 'PIRE', $4, $5, $6)`,
      [
        item.platform,
        item.platform_product_id,
        matchedMasterId,
        outcome,
        confidence,
        JSON.stringify(signalsBreakdown),
      ]
    );

    return {
      platform: item.platform,
      platform_product_id: item.platform_product_id,
      outcome,
      master_product_id: matchedMasterId,
      confidence,
      family_confidence: null,
      sharedEanQuarantine: hasSharedEan,
      candidates,
      signalsBreakdown,
    };
  });
}

/**
 * Executa o PIRE para uma família User Product do Mercado Livre (Seção 8.1):
 * - Junta os sinais fortes de todos os itens da mesma family_id.
 * - Dois sinais fortes no mesmo candidato e nenhum em outro -> family_confidence = 95, cria platform_links
 *   com platform_product_id = family_id.
 * - Sinais fortes apontando para candidatos diferentes -> vai para quarentena: a família NÃO se parte
 *   e não nasce vínculo.
 * - Item novo em family_id já vinculada: se tiver sinal forte para outro pai, manda SÓ esse item para
 *   quarentena, não abre segundo pai e não baixa o family_confidence já gravado.
 */
export async function resolveMlUserProductFamilyPire(
  familyId: string,
  familyName: string,
  familyItems: PireExternalItemInput[]
): Promise<PireResolutionResult> {
  return withTransaction(async (client: PoolClient) => {
    const existingLinkRes = await client.query<{
      id: string;
      master_product_id: string;
      family_confidence: number | null;
    }>(
      `SELECT id, master_product_id, family_confidence
       FROM platform_links
       WHERE platform = 'mercadolivre' AND platform_product_id = $1
       FOR UPDATE`,
      [familyId]
    );

    const catalog = await loadActiveCatalogForPire(client);

    // Se a família já está vinculada a um master_product, avalia se algum item novo conflita com outro pai
    const existingLink = existingLinkRes.rows[0];
    if (existingLink) {
      const conflictingNewItems: string[] = [];
      for (const item of familyItems) {
        const evalRes = evaluateItemSignalsAgainstCatalog(item, catalog, new Set());
        const strongForOther = evalRes.candidates.filter(
          (c) =>
            c.strongSignals.length > 0 &&
            c.master_product_id !== existingLink.master_product_id
        );
        if (strongForOther.length > 0) {
          const itemKey = item.item_id ?? item.platform_product_id;
          conflictingNewItems.push(itemKey);

          const qItemRes = await client.query<{ id: string }>(
            `INSERT INTO platform_items (platform, platform_product_id, status, updated_at)
             VALUES ('mercadolivre', $1, 'quarantine', now())
             ON CONFLICT (platform, platform_product_id) DO UPDATE
               SET status = 'quarantine', updated_at = now()
             RETURNING id`,
            [itemKey]
          );

          await client.query(
            `INSERT INTO matching_queue (
               platform_item_id, platform_raw_data, suggested_matches, best_score, status, expires_at
             ) VALUES ($1, $2, $3, $4, 'pending', NULL)`,
            [
              qItemRes.rows[0]!.id,
              JSON.stringify(item),
              JSON.stringify(evalRes.candidates),
              strongForOther[0]!.score,
            ]
          );
        }
      }

      return {
        platform: 'mercadolivre',
        platform_product_id: familyId,
        outcome: conflictingNewItems.length > 0 ? 'quarantine' : 'already_terminal',
        master_product_id: existingLink.master_product_id,
        confidence: existingLink.family_confidence ?? 95,
        family_confidence: existingLink.family_confidence ?? 95,
        sharedEanQuarantine: false,
        candidates: [],
        signalsBreakdown: {
          family_id: {
            familyId,
            existingMasterProductId: existingLink.master_product_id,
            quarantinedNewItems: conflictingNewItems,
          },
        },
      };
    }

    // Família ainda não vinculada: avalia todos os itens da família juntos
    const existingItemRes = await client.query<{ id: string }>(
      `SELECT id FROM platform_items WHERE platform = 'mercadolivre' AND platform_product_id = $1`,
      [familyId]
    );
    const rejectedMasterIds = new Set<string>();
    if (existingItemRes.rows[0]) {
      const rejRes = await client.query<{ master_product_id: string }>(
        `SELECT master_product_id FROM match_rejections WHERE platform_item_id = $1`,
        [existingItemRes.rows[0].id]
      );
      for (const r of rejRes.rows) {
        rejectedMasterIds.add(r.master_product_id);
      }
    }

    const strongSignalsByMaster = new Map<
      string,
      {
        signals: Set<'sku' | 'ean' | 'name_jw_90'>;
        agreeingItems: Set<string>;
      }
    >();
    const allSharedEans = new Set<string>();
    const mergedCandidateMap = new Map<string, CandidateEvaluation>();

    for (const item of familyItems) {
      const itemKey = item.item_id ?? item.platform_product_id;
      const evalRes = evaluateItemSignalsAgainstCatalog(item, catalog, rejectedMasterIds);
      for (const ean of evalRes.sharedEansAcrossProducts) {
        allSharedEans.add(ean);
      }

      for (const cand of evalRes.candidates) {
        if (!mergedCandidateMap.has(cand.master_product_id)) {
          mergedCandidateMap.set(cand.master_product_id, {
            ...cand,
            strongSignals: [...cand.strongSignals],
            auxiliarySignals: [...cand.auxiliarySignals],
          });
        } else {
          const prev = mergedCandidateMap.get(cand.master_product_id)!;
          for (const s of cand.strongSignals) {
            if (!prev.strongSignals.includes(s)) prev.strongSignals.push(s);
          }
        }

        if (cand.strongSignals.length > 0) {
          const entry = strongSignalsByMaster.get(cand.master_product_id) ?? {
            signals: new Set<'sku' | 'ean' | 'name_jw_90'>(),
            agreeingItems: new Set<string>(),
          };
          for (const s of cand.strongSignals) entry.signals.add(s);
          entry.agreeingItems.add(itemKey);
          strongSignalsByMaster.set(cand.master_product_id, entry);
        }
      }
    }

    const mastersWithStrongSignals = Array.from(strongSignalsByMaster.entries());
    const hasConflictAcrossMasters = mastersWithStrongSignals.length > 1;
    const hasSharedEan = allSharedEans.size > 0;

    let outcome: 'auto_linked' | 'suggestion' | 'quarantine';
    let matchedMasterId: string | null = null;
    let familyConfidence: number;

    const agreeingItems: string[] = [];
    const conflictingItems: string[] = [];

    if (hasConflictAcrossMasters || hasSharedEan) {
      outcome = 'quarantine';
      familyConfidence = 0;
      for (const [, info] of mastersWithStrongSignals) {
        for (const itemKey of info.agreeingItems) {
          conflictingItems.push(itemKey);
        }
      }
    } else if (
      mastersWithStrongSignals.length === 1 &&
      mastersWithStrongSignals[0]![1].signals.size >= 2
    ) {
      outcome = 'auto_linked';
      matchedMasterId = mastersWithStrongSignals[0]![0];
      familyConfidence = 95;
      agreeingItems.push(...Array.from(mastersWithStrongSignals[0]![1].agreeingItems));
    } else if (mastersWithStrongSignals.length === 1) {
      outcome = 'suggestion';
      familyConfidence = 80;
      agreeingItems.push(...Array.from(mastersWithStrongSignals[0]![1].agreeingItems));
    } else {
      outcome = 'suggestion';
      familyConfidence = 0;
    }

    const mergedCandidates = Array.from(mergedCandidateMap.values()).map((c) => ({
      ...c,
      score:
        c.strongSignals.length >= 2
          ? 95
          : c.strongSignals.length === 1
          ? 80
          : c.score,
    }));

    const signalsBreakdown = {
      family_id: {
        familyId,
        familyName,
        agreeing_items: agreeingItems,
        conflicting_items: conflictingItems,
        sharedEansAcrossProducts: Array.from(allSharedEans),
        candidatesWithStrongSignals: mastersWithStrongSignals.map(([mId, info]) => ({
          master_product_id: mId,
          signals: Array.from(info.signals),
          items: Array.from(info.agreeingItems),
        })),
      },
    };

    const targetStatus =
      outcome === 'auto_linked'
        ? 'linked'
        : outcome === 'quarantine'
        ? 'quarantine'
        : 'suggestion';

    const upsertedItem = await client.query<{ id: string }>(
      `INSERT INTO platform_items (platform, platform_product_id, status, master_product_id, updated_at)
       VALUES ('mercadolivre', $1, $2, $3, now())
       ON CONFLICT (platform, platform_product_id) DO UPDATE
         SET status = EXCLUDED.status,
             master_product_id = EXCLUDED.master_product_id,
             updated_at = now()
       RETURNING id`,
      [familyId, targetStatus, matchedMasterId]
    );
    const platformItemId = upsertedItem.rows[0]!.id;

    if (outcome === 'auto_linked' && matchedMasterId) {
      await client.query(
        `INSERT INTO platform_links (
           master_product_id, platform, platform_product_id, match_method,
           match_confidence, match_signals, ml_model, family_id, family_name,
           family_confidence, sync_status, last_synced_at
         ) VALUES ($1, 'mercadolivre', $2, 'auto_family_multi_signal', 95, $3, 'user_product', $2, $4, 95, 'linked', now())
         ON CONFLICT (platform, platform_product_id) DO UPDATE
           SET master_product_id = EXCLUDED.master_product_id,
               match_confidence = 95,
               family_confidence = 95,
               match_signals = EXCLUDED.match_signals,
               last_synced_at = now()`,
        [matchedMasterId, familyId, JSON.stringify(signalsBreakdown), familyName]
      );
    } else {
      await client.query(
        `INSERT INTO matching_queue (
           platform_item_id, platform_raw_data, suggested_matches, best_score, status, expires_at
         ) VALUES ($1, $2, $3, $4, 'pending', NULL)`,
        [
          platformItemId,
          JSON.stringify({ familyId, familyName, items: familyItems }),
          JSON.stringify(mergedCandidates),
          familyConfidence,
        ]
      );
    }

    return {
      platform: 'mercadolivre',
      platform_product_id: familyId,
      outcome,
      master_product_id: matchedMasterId,
      confidence: familyConfidence,
      family_confidence: familyConfidence,
      sharedEanQuarantine: hasSharedEan,
      candidates: mergedCandidates,
      signalsBreakdown,
    };
  });
}

/**
 * Resolução humana de um item da fila de matching (Seção 8.1):
 * - confirm: cria platform_links com score 100 e marca platform_items como 'linked'.
 * - reject_candidate: grava o par em match_rejections e tira esse pai da sugestão; o anúncio continua aberto.
 * - dismiss / new_product: marca o anúncio como terminal sem master_product_id.
 */
export async function resolveMatchingDecision(input: {
  platform: 'mercadolivre' | 'nuvemshop';
  platformProductId: string;
  userId: string;
  action: 'confirm' | 'reject_candidate' | 'dismiss' | 'new_product';
  masterProductId?: string;
  reason?: string;
  mlModel?: 'legacy_variations' | 'user_product';
  familyId?: string;
  familyName?: string;
}): Promise<{
  itemStatus: 'suggestion' | 'quarantine' | 'linked' | 'dismissed' | 'new_product';
  masterProductId: string | null;
}> {
  return withTransaction(async (client: PoolClient) => {
    const itemRes = await client.query<{
      id: string;
      status: 'suggestion' | 'quarantine' | 'linked' | 'dismissed' | 'new_product';
    }>(
      `SELECT id, status FROM platform_items
       WHERE platform = $1 AND platform_product_id = $2
       FOR UPDATE`,
      [input.platform, input.platformProductId]
    );

    const pItem = itemRes.rows[0];
    if (!pItem) {
      throw new Error(`platform_item (${input.platform}, ${input.platformProductId}) não encontrado`);
    }

    if (input.action === 'reject_candidate') {
      if (!input.masterProductId) {
        throw new Error('masterProductId é obrigatório para rejeitar um candidato');
      }

      await client.query(
        `INSERT INTO match_rejections (platform_item_id, master_product_id, rejected_by, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (platform_item_id, master_product_id) DO NOTHING`,
        [pItem.id, input.masterProductId, input.userId, input.reason ?? null]
      );

      // Remove o candidato rejeitado das sugestões abertas na matching_queue, mantendo o anúncio aberto
      const qRes = await client.query<{ id: string; suggested_matches: CandidateEvaluation[] }>(
        `SELECT id, suggested_matches FROM matching_queue
         WHERE platform_item_id = $1 AND status = 'pending'
         FOR UPDATE`,
        [pItem.id]
      );

      for (const qRow of qRes.rows) {
        const filtered = (qRow.suggested_matches ?? []).filter(
          (c) => c.master_product_id !== input.masterProductId
        );
        await client.query(
          `UPDATE matching_queue
           SET suggested_matches = $2,
               best_score = $3
           WHERE id = $1`,
          [qRow.id, JSON.stringify(filtered), filtered[0]?.score ?? 0]
        );
      }

      return {
        itemStatus: pItem.status,
        masterProductId: null,
      };
    }

    const expiresAt60d = new Date(Date.now() + 60 * 86_400_000).toISOString();

    if (input.action === 'confirm') {
      if (!input.masterProductId) {
        throw new Error('masterProductId é obrigatório para confirmar vínculo');
      }

      await client.query(
        `UPDATE platform_items
         SET status = 'linked',
             master_product_id = $2,
             decided_by = $3,
             decided_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [pItem.id, input.masterProductId, input.userId]
      );

      const isUp = input.mlModel === 'user_product';
      await client.query(
        `INSERT INTO platform_links (
           master_product_id, platform, platform_product_id, match_method,
           match_confidence, confirmed_by, confirmed_at, ml_model,
           family_id, family_name, family_confidence, sync_status, last_synced_at
         ) VALUES ($1, $2, $3, 'manual_confirmed', 100, $4, now(), $5, $6, $7, $8, 'linked', now())
         ON CONFLICT (platform, platform_product_id) DO UPDATE
           SET master_product_id = EXCLUDED.master_product_id,
               match_method = 'manual_confirmed',
               match_confidence = 100,
               confirmed_by = EXCLUDED.confirmed_by,
               confirmed_at = now(),
               family_confidence = EXCLUDED.family_confidence,
               sync_status = 'linked'`,
        [
          input.masterProductId,
          input.platform,
          input.platformProductId,
          input.userId,
          input.platform === 'mercadolivre' ? input.mlModel ?? 'legacy_variations' : null,
          isUp ? input.familyId ?? input.platformProductId : null,
          isUp ? input.familyName ?? null : null,
          isUp ? 100 : null,
        ]
      );

      await client.query(
        `UPDATE matching_queue
         SET status = 'matched',
             resolved_by = $2,
             resolved_at = now(),
             expires_at = $3
         WHERE platform_item_id = $1 AND status = 'pending'`,
        [pItem.id, input.userId, expiresAt60d]
      );

      return {
        itemStatus: 'linked',
        masterProductId: input.masterProductId,
      };
    }

    const terminalStatus = input.action === 'dismiss' ? 'dismissed' : 'new_product';
    await client.query(
      `UPDATE platform_items
       SET status = $2,
           master_product_id = NULL,
           decided_by = $3,
           decided_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [pItem.id, terminalStatus, input.userId]
    );

    await client.query(
      `UPDATE matching_queue
       SET status = $2,
           resolved_by = $3,
           resolved_at = now(),
           expires_at = $4
       WHERE platform_item_id = $1 AND status = 'pending'`,
      [pItem.id, terminalStatus, input.userId, expiresAt60d]
    );

    return {
      itemStatus: terminalStatus,
      masterProductId: null,
    };
  });
}
