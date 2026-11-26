import { loadConnectors } from '../connectors/load.js';
import { activeErpConnector, activeErpId } from '../connectors/strategy/factory.js';
import { ErpCategoryMapping, ErpConnector, MarketplaceListing } from '../connectors/strategy/types.js';
import { query, withTransaction } from '../db/pool.js';
import { resolveProductCategory } from './category-resolver.service.js';

export async function syncCategoryMappings(connector?: ErpConnector): Promise<{ provider: string; mappings: number; updatedAt: string }> {
  if (!connector) await loadConnectors();
  const erp = connector ?? activeErpConnector();
  const references = await erp.readCachedCategoryReferences?.() ?? [];
  const rows = await erp.fetchCategoryMappings();
  if (!Array.isArray(rows)) throw new Error('invalid_category_mappings_response');
  const mappings = new Map<string, ErpCategoryMapping>();
  for (const row of rows) {
    if (!row || ![row.erpCategoryId, row.channelId, row.channelCategoryId].every((value) => typeof value === 'string' && value.trim())) {
      throw new Error('invalid_category_mapping');
    }
    const normalized = { erpCategoryId: row.erpCategoryId.trim(), channelId: row.channelId.trim(), channelCategoryId: row.channelCategoryId.trim() };
    const key = JSON.stringify([normalized.erpCategoryId, normalized.channelId]);
    const previous = mappings.get(key);
    if (previous && previous.channelCategoryId !== normalized.channelCategoryId) throw new Error('conflicting_category_mapping');
    mappings.set(key, normalized);
  }
  return withTransaction(async (client) => {
    await client.query(`INSERT INTO erp_category_syncs (erp_provider) VALUES ($1) ON CONFLICT (erp_provider) DO NOTHING`, [erp.id]);
    const state = await client.query<{ last_synced_at: Date | string | null }>(
      `SELECT last_synced_at FROM erp_category_syncs WHERE erp_provider = $1 FOR UPDATE`, [erp.id]
    );
    const previousTime = state.rows[0]?.last_synced_at;
    const stamp = new Date(Math.max(Date.now(), previousTime ? new Date(previousTime).getTime() + 1 : 0)).toISOString();
    for (const row of mappings.values()) {
      await client.query(
        `INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (erp_provider, erp_category_id, channel) DO UPDATE
         SET channel_category_id = EXCLUDED.channel_category_id, updated_at = EXCLUDED.updated_at`,
        [erp.id, row.erpCategoryId, row.channelId, row.channelCategoryId, stamp]
      );
    }
    await client.query(`DELETE FROM erp_category_mappings WHERE erp_provider = $1 AND updated_at <> $2`, [erp.id, stamp]);
    for (let offset = 0; offset < references.length; offset += 500) {
      const batch = references.slice(offset, offset + 500);
      const cases = batch.map((_, index) => `WHEN erp_id = $${index * 2 + 2} THEN $${index * 2 + 3}::text`).join(' ');
      const ids = batch.map((_, index) => `$${index * 2 + 2}`).join(', ');
      await client.query(
        `UPDATE master_products SET erp_category_id = CASE ${cases} ELSE erp_category_id END
         WHERE erp_provider = $1 AND erp_category_id IS NULL AND erp_id IN (${ids})`,
        [erp.id, ...batch.flatMap((ref) => [ref.externalId, ref.erpCategoryId])]
      );
    }
    await client.query(`UPDATE erp_category_syncs SET last_synced_at = $2 WHERE erp_provider = $1`, [erp.id, stamp]);
    return { provider: erp.id, mappings: mappings.size, updatedAt: stamp };
  });
}

export async function auditListingCategory(
  productId: string, channel: string, listing: MarketplaceListing, expectedCategoryId?: string | null
): Promise<boolean> {
  const expected = expectedCategoryId === undefined ? await resolveProductCategory(productId, channel) : expectedCategoryId;
  if (!expected || !Array.isArray(listing.categoryIds)) return false;
  const divergent = !listing.categoryIds.includes(expected);
  const details = JSON.stringify({
    erpProvider: activeErpId(), listingId: listing.externalId,
    expectedCategoryId: expected, actualCategoryIds: listing.categoryIds,
    message: `Categoria no canal: ${listing.categoryIds.join(', ') || 'sem categoria'}. Esperada pelo ERP: ${expected}.`,
  });
  if (divergent) {
    await query(
      `INSERT INTO divergence_alerts (master_product_id, platform, alert_code, type, severity, bling_value, external_value, details)
       VALUES ($1, $2, 'category_divergence', 'category_divergence', 'warning', $3, $4, $5)
       ON CONFLICT (master_product_id, platform, type) DO UPDATE
       SET bling_value = EXCLUDED.bling_value, external_value = EXCLUDED.external_value,
           details = EXCLUDED.details, status = 'open', resolved_at = NULL, resolved_by = NULL`,
      [productId, channel, expected, listing.categoryIds.join(', '), details]
    );
  } else {
    await query(
      `UPDATE divergence_alerts SET status = 'resolved', resolved_at = now(), details = $3
       WHERE master_product_id = $1 AND platform = $2 AND type = 'category_divergence' AND status = 'open'`,
      [productId, channel, details]
    );
  }
  return divergent;
}

export async function readCategoryMappingAudit() {
  const provider = activeErpId();
  const [mappings, alerts, state] = await Promise.all([
    query<{ id: string; erp_category_id: string; channel: string; channel_category_id: string; updated_at: Date | string }>(
      `SELECT id, erp_category_id, channel, channel_category_id, updated_at FROM erp_category_mappings WHERE erp_provider = $1 ORDER BY channel, erp_category_id`, [provider]
    ),
    query<{ erp_category_id: string | null; platform: string }>(
      `SELECT mp.erp_category_id, a.platform FROM divergence_alerts a
       INNER JOIN master_products mp ON mp.id = a.master_product_id
       WHERE a.type = 'category_divergence' AND a.status = 'open' AND mp.erp_provider = $1`, [provider]
    ),
    query<{ last_synced_at: Date | string | null }>(`SELECT last_synced_at FROM erp_category_syncs WHERE erp_provider = $1`, [provider]),
  ]);
  const counts = new Map<string, number>();
  for (const alert of alerts.rows) {
    const key = JSON.stringify([alert.erp_category_id, alert.platform]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    provider, lastSyncedAt: state.rows[0]?.last_synced_at ?? null, divergences: alerts.rows.length,
    mappings: mappings.rows.map((row) => {
      const divergences = counts.get(JSON.stringify([row.erp_category_id, row.channel])) ?? 0;
      return { id: row.id, erpCategoryId: row.erp_category_id, channelId: row.channel, channelCategoryId: row.channel_category_id,
        updatedAt: row.updated_at, status: divergences ? 'divergent' : 'connected', divergences };
    }),
  };
}
