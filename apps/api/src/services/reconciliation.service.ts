import { getMarketplaceConnector } from '../connectors/strategy/factory.js';
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
  erp_sku: string;
  ean: string | null;
  price: string | null;
  stock: string | null;
  image_count: number;
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function asNumber(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function linkIfMissing(productId: string, marketplace: string, listing: MarketplaceListing): Promise<void> {
  const existing = await query(
    `SELECT 1 FROM channel_listing_links WHERE product_id = $1 AND channel = $2 LIMIT 1`,
    [productId, marketplace]
  );
  if (existing.rows[0]) return;
  await query(
    `INSERT INTO channel_listing_links (product_id, channel, listing_id, listing_title, listing_price, listing_status, link_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'vinculado')
     ON CONFLICT (product_id, channel) DO NOTHING`,
    [productId, marketplace, listing.externalId, listing.title, listing.price, listing.status]
  );
}

async function saveSnapshot(
  productId: string,
  marketplace: string,
  listing: MarketplaceListing,
  alerts: Array<{ kind: string; message: string }>
): Promise<void> {
  await query(
    `DELETE FROM marketplace_listings_snapshot WHERE product_id = $1 AND marketplace = $2`,
    [productId, marketplace]
  );
  await query(
    `INSERT INTO marketplace_listings_snapshot (product_id, marketplace, external_id, payload_json, last_synced_at)
     VALUES ($1, $2, $3, $4, now())`,
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

function compare(row: HubRow, marketplace: string, listing: MarketplaceListing): Array<{
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
  if (hubStock !== null && listing.stock !== null && hubStock !== listing.stock) {
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
export async function reconcileListings(read: ListingReader = defaultReader): Promise<{ snapshots: number; alerts: number; linked: number }> {
  const products = await query<Omit<HubRow, 'image_count'>>(
    `SELECT mp.id, mp.erp_sku, pv.ean, pv.price::text AS price, pv.stock::text AS stock
     FROM master_products mp
     INNER JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
     WHERE mp.catalog_status = 'active' AND mp.archived_at IS NULL
       AND trim(mp.erp_sku) <> ''
       AND pv.price > 0
     LIMIT $1`,
    [READY_LIMIT]
  );
  const covers = await query<{ master_product_id: string; image_count: number }>(
    `SELECT master_product_id, count(*)::int AS image_count
     FROM product_images
     WHERE is_cover_eligible = true
     GROUP BY master_product_id`
  );
  const imagesByProduct = new Map(covers.rows.map((row) => [row.master_product_id, Number(row.image_count) || 0]));
  let snapshots = 0;
  let alerts = 0;
  let linked = 0;
  for (const raw of products.rows) {
    const row: HubRow = { ...raw, image_count: imagesByProduct.get(raw.id) ?? 0 };
    const product: MasterProduct = {
      id: row.id,
      sku: row.erp_sku,
      ean: row.ean,
      price: asNumber(row.price),
      stock: asNumber(row.stock),
    };
    for (const channel of CHANNELS) {
      let listing: MarketplaceListing | null = null;
      try {
        listing = await read(channel, product);
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
      const before = await query(`SELECT 1 FROM channel_listing_links WHERE product_id = $1 AND channel = $2`, [row.id, channel]);
      await linkIfMissing(row.id, channel, listing);
      if (!before.rows[0]) linked += 1;
      const found = compare(row, channel, listing);
      await saveSnapshot(row.id, channel, listing, found.map((item) => ({ kind: item.kind, message: item.message })));
      snapshots += 1;
      alerts += found.length;
    }
  }
  return { snapshots, alerts, linked };
}
