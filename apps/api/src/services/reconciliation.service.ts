import { refreshMissingCommerce } from '../catalog/full-sync.js';
import { productsWithSellerWarehouse } from '../catalog/warehouse-stock.js';
import { activeErpConnector, getMarketplaceConnector } from '../connectors/strategy/factory.js';
import { collectListingSignals, linkStatusFromSignals, ListingSignal } from '../connectors/strategy/listing-signals.js';
import { MarketplaceListing, MasterProduct } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';

const CHANNELS = ['mercadolivre', 'nuvemshop'] as const;
const READY_LIMIT = 40;

const CHANNEL_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
};

const CHANNEL_SHORT: Record<string, string> = {
  mercadolivre: 'ML',
  nuvemshop: 'Nuvemshop',
};

export type ListingReader = (channel: string, product: MasterProduct) => Promise<MarketplaceListing | null>;

interface HubRow {
  id: string;
  erp_id: string;
  erp_sku: string;
  name: string | null;
  ean: string | null;
  price: string | null;
  stock: string | null;
  image_count: number;
}

export interface ReconcileOptions {
  limit?: number;
  /** Cursor exclusivo. A próxima página começa depois deste id. */
  afterId?: string;
  sku?: string;
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function asNumber(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signalsFor(row: Omit<HubRow, 'image_count'>, listing: MarketplaceListing): ListingSignal[] {
  const matchedBy = (listing.signals ?? []).filter((signal): signal is 'sku' | 'ean' => signal === 'sku' || signal === 'ean');
  const collected = collectListingSignals({
    hubSku: row.erp_sku,
    hubEan: row.ean,
    hubName: row.name,
    channelSku: listing.sku,
    channelEan: listing.ean,
    channelTitle: listing.title,
    matchedBy,
  });
  if (listing.signals?.includes('title') && !collected.includes('title')) collected.push('title');
  return collected.length > 0 ? collected : ['sku'];
}

async function rememberSuggestion(
  row: Omit<HubRow, 'image_count'>,
  channel: string,
  listing: MarketplaceListing,
  signals: ListingSignal[]
): Promise<void> {
  if (channel !== 'mercadolivre' && channel !== 'nuvemshop') return;
  const raw = channel === 'nuvemshop'
    ? { name: { pt: listing.title }, published: true, variants: [{ sku: row.erp_sku, barcode: row.ean, price: listing.price }] }
    : {
        title: listing.title,
        seller_custom_field: row.erp_sku,
        price: listing.price,
        status: listing.status,
        attributes: row.ean ? [{ id: 'GTIN', value_name: row.ean }] : [],
      };
  const item = await query<{ id: string }>(
    `INSERT INTO platform_items (platform, platform_product_id, status, master_product_id)
     VALUES ($1, $2, 'suggestion', $3)
     ON CONFLICT (platform, platform_product_id) DO UPDATE
       SET master_product_id = COALESCE(platform_items.master_product_id, EXCLUDED.master_product_id),
           updated_at = now()
     RETURNING id`,
    [channel, listing.externalId, row.id]
  );
  const platformItemId = item.rows[0]?.id;
  if (!platformItemId) return;
  const open = await query<{ id: string }>(
    `SELECT id FROM matching_queue WHERE platform_item_id = $1 AND status = 'pending' LIMIT 1`,
    [platformItemId]
  );
  if (open.rows[0]) return;
  await query(
    `INSERT INTO matching_queue (platform_item_id, platform_raw_data, suggested_matches, best_score, status, expires_at)
     VALUES ($1, $2, $3, 80, 'pending', NULL)`,
    [platformItemId, JSON.stringify(raw), JSON.stringify([{
      master_product_id: row.id,
      erp_sku: row.erp_sku,
      name: row.name,
      strongSignals: signals,
      auxiliarySignals: [],
      score: 80,
    }])]
  );
}

async function linkIfMissing(row: Omit<HubRow, 'image_count'>, marketplace: string, listing: MarketplaceListing): Promise<boolean> {
  const signals = signalsFor(row, listing);
  const status = linkStatusFromSignals(signals);
  try {
    const existing = await query<{ link_status: string }>(
      `SELECT link_status FROM channel_listing_links WHERE product_id = $1 AND channel = $2`,
      [row.id, marketplace]
    );
    if (existing.rows[0]?.link_status === 'vinculado') return false;
    if (existing.rows[0]) {
      if (status !== 'vinculado') return false;
      await query(
        `UPDATE channel_listing_links
         SET listing_id = $3, listing_title = $4, listing_price = $5, listing_status = $6, link_status = 'vinculado'
         WHERE product_id = $1 AND channel = $2 AND link_status = 'sugerido'`,
        [row.id, marketplace, listing.externalId, listing.title, listing.price, listing.status]
      );
      return true;
    }
    await query(
      `INSERT INTO channel_listing_links (product_id, channel, listing_id, listing_title, listing_price, listing_status, link_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, marketplace, listing.externalId, listing.title, listing.price, listing.status, status]
    );
    if (status === 'sugerido') await rememberSuggestion(row, marketplace, listing, signals);
    return status === 'vinculado';
  } catch (error) {
    logger.warn('Conflito de vínculo ignorado', {
      productId: row.id,
      marketplace,
      listingId: listing.externalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function saveSnapshot(
  productId: string,
  marketplace: string,
  listing: MarketplaceListing,
  alerts: Array<{ kind: string; message: string }>
): Promise<void> {
  await query(
    `INSERT INTO marketplace_listings_snapshot (product_id, marketplace, external_id, payload_json, last_synced_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (product_id, marketplace) DO UPDATE
     SET external_id = EXCLUDED.external_id,
         payload_json = EXCLUDED.payload_json,
         last_synced_at = now()`,
    [productId, marketplace, listing.externalId, JSON.stringify({
      price: listing.price,
      stock: listing.stock,
      title: listing.title,
      images: listing.images,
      status: listing.status,
      alerts,
    })]
  );
}

function compare(row: HubRow, marketplace: string, listing: MarketplaceListing, compareStock: boolean): Array<{
  kind: 'price' | 'stock' | 'enrichment';
  message: string;
  hubValue: string;
  channelValue: string;
}> {
  const label = CHANNEL_LABEL[marketplace] ?? marketplace;
  const short = CHANNEL_SHORT[marketplace] ?? label;
  const alerts: Array<{ kind: 'price' | 'stock' | 'enrichment'; message: string; hubValue: string; channelValue: string }> = [];
  const hubPrice = asNumber(row.price);
  const hubStock = asNumber(row.stock);
  if (hubPrice !== null && listing.price !== null && Math.abs(hubPrice - listing.price) >= 0.01) {
    const gap = Math.abs(hubPrice - listing.price);
    const direction = listing.price < hubPrice ? 'mais barato' : 'mais caro';
    alerts.push({
      kind: 'price',
      message: `${label} está R$ ${money(gap)} ${direction} que o Bling`,
      hubValue: String(hubPrice),
      channelValue: String(listing.price),
    });
  }
  if (compareStock && hubStock !== null && listing.stock !== null && hubStock !== listing.stock) {
    const sold = hubStock > listing.stock ? ` Vendeu ${hubStock - listing.stock} no ${short}, estoque no Bling não baixou.` : '';
    alerts.push({
      kind: 'stock',
      message: `Estoque: Bling ${hubStock} x ${short} ${listing.stock}.${sold}`,
      hubValue: String(hubStock),
      channelValue: String(listing.stock),
    });
  }
  const hubImages = Number(row.image_count) || 0;
  if (hubImages === 0 && listing.images.length > 0) {
    const count = listing.images.length;
    alerts.push({
      kind: 'enrichment',
      message: `O ${short} tem ${count} ${count === 1 ? 'imagem' : 'imagens'}, o HUB tem 0`,
      hubValue: '0',
      channelValue: String(count),
    });
  }
  return alerts;
}

async function defaultReader(channel: string, product: MasterProduct): Promise<MarketplaceListing | null> {
  return getMarketplaceConnector(channel).fetchListings(product);
}

/**
 * Lê o anúncio do canal, guarda o retrato e avisa divergência.
 * Não altera preço, estoque, NCM nem EAN no ERP.
 */
async function skusFor(productId: string, fallback: string): Promise<string[]> {
  const rows = await query<{ erp_sku: string | null }>(
    `SELECT erp_sku FROM product_variants WHERE master_product_id = $1 AND trim(COALESCE(erp_sku, '')) <> ''`,
    [productId]
  );
  const skus = rows.rows.map((row) => (row.erp_sku ?? '').trim()).filter((sku) => sku.length > 0);
  if (!skus.includes(fallback) && fallback.trim()) skus.unshift(fallback.trim());
  return [...new Set(skus)];
}

export async function reconcileListings(
  read: ListingReader = defaultReader,
  options: ReconcileOptions = {}
): Promise<{ snapshots: number; alerts: number; linked: number; scanned: number; lastId: string | null }> {
  const limit = options.limit ?? READY_LIMIT;
  const afterId = options.afterId?.trim() ?? '';
  const sku = options.sku?.trim() ?? '';
  const page = await query<{ id: string }>(
    `SELECT mp.id
     FROM master_products mp
     WHERE mp.catalog_status = 'active' AND mp.archived_at IS NULL
       AND trim(mp.erp_sku) <> ''
       AND ($1 = '' OR mp.id::text > $1)
       AND (
         $2 = ''
         OR mp.erp_sku = $2
         OR mp.id IN (SELECT master_product_id FROM product_variants WHERE erp_sku = $2)
       )
     ORDER BY mp.id::text ASC
     LIMIT $3`,
    [afterId, sku, limit]
  );
  const ids = page.rows.map((row) => row.id);
  const lastId = ids[ids.length - 1] ?? null;
  if (ids.length === 0) return { snapshots: 0, alerts: 0, linked: 0, scanned: 0, lastId: null };
  const idList = ids.map((_, index) => `$${index + 1}`).join(', ');
  const found = await query<Omit<HubRow, 'image_count'> & { is_default: boolean; variant_sku: string | null }>(
    `SELECT mp.id, mp.erp_id, mp.erp_sku, mp.name, pv.erp_sku AS variant_sku, pv.is_default,
            pv.ean, pv.price::text AS price, pv.stock::text AS stock
     FROM master_products mp
     INNER JOIN product_variants pv ON pv.master_product_id = mp.id
     WHERE mp.id IN (${idList})`,
    ids
  );
  const chosen = new Map<string, Omit<HubRow, 'image_count'>>();
  for (const row of found.rows) {
    const current = chosen.get(row.id);
    const candidate = { id: row.id, erp_id: row.erp_id, erp_sku: row.variant_sku?.trim() || row.erp_sku, name: row.name, ean: row.ean, price: row.price, stock: row.stock };
    if (!current) {
      chosen.set(row.id, candidate);
      continue;
    }
    const currentPrice = asNumber(current.price) ?? 0;
    const nextPrice = asNumber(row.price) ?? 0;
    if ((row.is_default && currentPrice <= 0) || (currentPrice <= 0 && nextPrice > 0)) {
      chosen.set(row.id, candidate);
    }
  }
  const products = { rows: ids.flatMap((id) => {
    const row = chosen.get(id);
    return row ? [row] : [];
  }) };
  const covers = await query<{ master_product_id: string; image_count: number }>(
    `SELECT master_product_id, count(*)::int AS image_count
     FROM product_images
     WHERE is_cover_eligible = true AND master_product_id IN (${idList})
     GROUP BY master_product_id`,
    ids
  );
  const imagesByProduct = new Map(covers.rows.map((row) => [row.master_product_id, Number(row.image_count) || 0]));
  const sellerProducts = await productsWithSellerWarehouse(products.rows.map((row) => row.id));
  let snapshots = 0;
  let alerts = 0;
  let linked = 0;
  for (const raw of products.rows) {
    const row: HubRow = { ...raw, image_count: imagesByProduct.get(raw.id) ?? 0 };
    if (process.env.VITEST !== 'true' && (asNumber(row.price) === null || (asNumber(row.price) ?? 0) <= 0 || asNumber(row.stock) === null)) {
      const refreshed = await refreshMissingCommerce(activeErpConnector(), row.erp_id);
      if (refreshed.price !== null) row.price = String(refreshed.price);
      if (refreshed.stock !== null) row.stock = String(refreshed.stock);
    }
    const skus = await skusFor(row.id, row.erp_sku);
    for (const channel of CHANNELS) {
      let listing: MarketplaceListing | null = null;
      try {
        for (const sku of skus) {
          const product: MasterProduct = {
            id: row.id,
            sku,
            ean: row.ean,
            name: row.name,
            price: asNumber(row.price),
            stock: asNumber(row.stock),
          };
          listing = await read(channel, product);
          if (listing) break;
        }
      } catch (error) {
        logger.error('Leitura do anúncio falhou', {
          channel,
          sku: row.erp_sku,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!listing) {
        await query(
          `DELETE FROM marketplace_listings_snapshot WHERE product_id = $1 AND marketplace = $2`,
          [row.id, channel]
        );
        continue;
      }
      if (await linkIfMissing(row, channel, listing)) linked += 1;
      const found = compare(row, channel, listing, sellerProducts.has(row.id));
      await saveSnapshot(row.id, channel, listing, found.map((item) => ({ kind: item.kind, message: item.message })));
      snapshots += 1;
      alerts += found.length;
    }
  }
  return { snapshots, alerts, linked, scanned: products.rows.length, lastId };
}

/** Percorre o catálogo em lotes pelo id. A leitura do canal não publica anúncio. */
export async function reconcileAll(read: ListingReader = defaultReader): Promise<{ snapshots: number; alerts: number; linked: number }> {
  let afterId = '';
  let snapshots = 0;
  let alerts = 0;
  let linked = 0;
  const page = 80;
  for (let guard = 0; guard < 250; guard += 1) {
    const result = await reconcileListings(read, { limit: page, afterId });
    snapshots += result.snapshots;
    alerts += result.alerts;
    linked += result.linked;
    if (result.scanned < page || !result.lastId) break;
    afterId = result.lastId;
  }
  return { snapshots, alerts, linked };
}
