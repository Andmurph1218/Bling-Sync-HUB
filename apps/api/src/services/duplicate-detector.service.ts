import { isBlankSku } from '../catalog/blank-sku.js';
import { getMarketplaceConnector } from '../connectors/strategy/factory.js';
import { ListingSearchInput, RemoteListing } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { reconcileListings } from './reconciliation.service.js';

const CHANNELS = ['mercadolivre', 'nuvemshop'] as const;
const READY_LIMIT = 40;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export type DuplicateConflictType = 'erp_sku' | 'erp_ean' | 'marketplace';

export interface DuplicateSearch {
  (channel: string, input: ListingSearchInput): Promise<RemoteListing[]>;
}

const CHANNEL_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
  shopee: 'Shopee',
  amazon: 'Amazon',
  tiktok: 'TikTok Shop',
};

export function duplicateConflictLabel(input: {
  conflictType: DuplicateConflictType;
  marketplace: string | null;
  externalId: string;
}): string {
  if (input.conflictType === 'marketplace') {
    const channel = CHANNEL_LABEL[input.marketplace ?? ''] ?? input.marketplace ?? 'canal';
    return `Já existe no ${channel} - ${input.externalId}`;
  }
  if (input.conflictType === 'erp_ean') return `EAN repetido no ERP - ${input.externalId}`;
  return `SKU repetido no ERP - ${input.externalId}`;
}

function isActiveListing(listing: RemoteListing): boolean {
  const status = listing.status.toLowerCase();
  return status === 'ativo' || status === 'active';
}

async function openAlertExists(
  productId: string,
  conflictType: DuplicateConflictType,
  marketplace: string | null,
  externalId: string
): Promise<boolean> {
  const found = await query<{ id: string }>(
    `SELECT id FROM duplicate_alerts
     WHERE product_id = $1 AND conflict_type = $2
       AND COALESCE(marketplace, '') = COALESCE($3, '')
       AND external_id = $4 AND status = 'open'
     LIMIT 1`,
    [productId, conflictType, marketplace, externalId]
  );
  return Boolean(found.rows[0]);
}

async function saveAlert(
  productId: string,
  conflictType: DuplicateConflictType,
  marketplace: string | null,
  externalId: string
): Promise<boolean> {
  if (await openAlertExists(productId, conflictType, marketplace, externalId)) return false;
  await query(
    `INSERT INTO duplicate_alerts (product_id, conflict_type, marketplace, external_id, status)
     VALUES ($1, $2, $3, $4, 'open')`,
    [productId, conflictType, marketplace, externalId]
  );
  return true;
}

async function detectErpDuplicates(): Promise<number> {
  const products = await query<{ id: string; erp_id: string; erp_sku: string | null }>(
    `SELECT id, erp_id, erp_sku
     FROM master_products
     WHERE catalog_status = 'active' AND archived_at IS NULL`
  );
  const eans = await query<{ master_product_id: string; ean: string }>(
    `SELECT pv.master_product_id, pv.ean
     FROM product_variants pv
     INNER JOIN master_products mp ON mp.id = pv.master_product_id
     WHERE mp.catalog_status = 'active' AND mp.archived_at IS NULL
       AND pv.ean IS NOT NULL AND trim(pv.ean) <> ''`
  );
  const bySku = new Map<string, Array<{ id: string; erpId: string }>>();
  for (const row of products.rows) {
    if (isBlankSku(row.erp_sku)) continue;
    const key = row.erp_sku!.trim().toLowerCase();
    const list = bySku.get(key) ?? [];
    list.push({ id: row.id, erpId: row.erp_id });
    bySku.set(key, list);
  }
  const byEan = new Map<string, string[]>();
  for (const row of eans.rows) {
    const key = row.ean.trim();
    const list = byEan.get(key) ?? [];
    if (!list.includes(row.master_product_id)) list.push(row.master_product_id);
    byEan.set(key, list);
  }
  const erpIdByProduct = new Map(products.rows.map((row) => [row.id, row.erp_id]));
  let created = 0;
  for (const group of bySku.values()) {
    if (group.length < 2) continue;
    for (const product of group) {
      const other = group.find((item) => item.id !== product.id);
      if (!other) continue;
      if (await saveAlert(product.id, 'erp_sku', null, other.erpId)) created += 1;
    }
  }
  const skuCollisions = new Set<string>();
  const eanCollisions = new Set<string>();
  for (const group of bySku.values()) {
    if (group.length < 2) continue;
    for (const product of group) skuCollisions.add(product.id);
  }
  for (const group of byEan.values()) {
    if (group.length < 2) continue;
    for (const productId of group) eanCollisions.add(productId);
  }
  for (const group of byEan.values()) {
    if (group.length < 2) continue;
    for (const productId of group) {
      const otherId = group.find((id) => id !== productId);
      const externalId = otherId ? erpIdByProduct.get(otherId) : null;
      if (!externalId) continue;
      if (await saveAlert(productId, 'erp_ean', null, externalId)) created += 1;
    }
  }
  const openErp = await query<{ id: string; product_id: string; conflict_type: DuplicateConflictType }>(
    `SELECT id, product_id, conflict_type FROM duplicate_alerts
     WHERE status = 'open' AND conflict_type IN ('erp_sku', 'erp_ean')`
  );
  for (const alert of openErp.rows) {
    const stillThere = alert.conflict_type === 'erp_sku'
      ? skuCollisions.has(alert.product_id)
      : eanCollisions.has(alert.product_id);
    if (stillThere) continue;
    await query(
      `UPDATE duplicate_alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`,
      [alert.id]
    );
  }
  return created;
}

async function detectMarketplaceDuplicates(search: DuplicateSearch): Promise<number> {
  const ready = await query<{ id: string; erp_sku: string; ean: string | null }>(
    `SELECT DISTINCT mp.id, mp.erp_sku, pv.ean
     FROM master_products mp
     INNER JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
     INNER JOIN product_images pi ON pi.master_product_id = mp.id AND pi.is_cover_eligible = true
     WHERE mp.catalog_status = 'active' AND mp.archived_at IS NULL
       AND trim(mp.erp_sku) <> ''
       AND pv.price > 0
       AND mp.ncm_status = 'valid'
       AND mp.ncm_fiscal_risk = false
     LIMIT $1`,
    [READY_LIMIT]
  );
  let created = 0;
  for (const product of ready.rows) {
    for (const channel of CHANNELS) {
      let listings: RemoteListing[] = [];
      try {
        listings = await search(channel, { sku: product.erp_sku, ean: product.ean });
      } catch {
        continue;
      }
      for (const listing of listings.filter(isActiveListing)) {
        const linked = await query(
          `SELECT 1 FROM channel_listing_links
           WHERE product_id = $1 AND channel = $2 AND listing_id = $3
           LIMIT 1`,
          [product.id, channel, listing.id]
        );
        if (linked.rows[0]) continue;
        if (await saveAlert(product.id, 'marketplace', channel, listing.id)) created += 1;
      }
    }
  }
  return created;
}

async function searchWithFactory(channel: string, input: ListingSearchInput): Promise<RemoteListing[]> {
  return getMarketplaceConnector(channel).searchListings(input);
}

/** Varre o catálogo do HUB e os anúncios ativos dos canais. Não importa o conector do ERP. */
export async function detectDuplicates(search: DuplicateSearch = searchWithFactory): Promise<{ erp: number; marketplace: number }> {
  const erp = await detectErpDuplicates();
  const marketplace = await detectMarketplaceDuplicates(search);
  return { erp, marketplace };
}

export function startDuplicateDetector(): void {
  const run = () => {
    void detectDuplicates().catch((error: unknown) => {
      logger.error('Detector de duplicidade falhou', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    void reconcileListings().catch((error: unknown) => {
      logger.error('Reconciliação do canal falhou', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  setTimeout(run, 60_000);
  setInterval(run, SIX_HOURS_MS);
}
