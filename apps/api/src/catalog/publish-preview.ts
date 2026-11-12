import { ACTIVE_CATALOG_CHANNELS } from '../config/channels.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import {
  AttributeMapInput,
  isChannelMappingGreen,
  materializeChannelAttributes,
} from './channel-attributes.js';
import { ChecklistResult, evaluateCatalogChecklist } from './completeness.js';
import { isBlankSku } from './blank-sku.js';
import { productsWithSellerWarehouse } from './warehouse-stock.js';
import { JITTERED_BACKOFF } from '../queues/backoff.js';

export type PublishChannel = 'mercadolivre' | 'nuvemshop';

export interface MarketplacePublishBody {
  title: string | null;
  category_id: string | null;
  price: number;
  currency_id: 'BRL';
  available_quantity: number;
  buying_mode: 'buy_it_now';
  condition: 'new';
  listing_type_id: 'gold_special';
  seller_custom_field: string;
  attributes: Array<{ id: string; value_name: string }>;
}

export interface PublishPreview {
  performed: false;
  published: false;
  channel: PublishChannel;
  method: 'POST';
  endpoint: '/items' | '/products';
  payload: MarketplacePublishBody;
  attributesComplete: boolean;
  missingAttributes: string[];
}

export async function buildPublishPreview(productId: string, channel: PublishChannel): Promise<PublishPreview | null> {
  const productRes = await query<{
    id: string;
    name: string | null;
    brand: string | null;
    erp_sku: string;
    hub_category_id: string | null;
    price: string | null;
    stock: string | null;
    variant_id: string | null;
  }>(
    `SELECT mp.id, mp.name, mp.brand, mp.erp_sku, mp.hub_category_id,
            pv.price::text AS price, pv.stock::text AS stock, pv.id AS variant_id
     FROM master_products mp
     LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
     WHERE mp.id = $1 AND mp.catalog_status = 'active'`,
    [productId]
  );
  const product = productRes.rows[0];
  if (!product) return null;

  const category = product.hub_category_id
    ? await query<{ channel_category_id: string }>(
        `SELECT channel_category_id
         FROM channel_category_maps
         WHERE hub_category_id = $1 AND platform = $2`,
        [product.hub_category_id, channel]
      )
    : { rows: [] as Array<{ channel_category_id: string }> };

  const maps = product.hub_category_id
    ? await query<{
        id: string;
        channel_attribute_id: string;
        channel_attribute_name: string;
        required: boolean;
        mode: 'fixed' | 'dynamic' | 'manual';
        fixed_value: string | null;
        source_field: string | null;
      }>(
        `SELECT am.id, am.channel_attribute_id, am.channel_attribute_name, am.required, am.mode, am.fixed_value, am.source_field
         FROM channel_attribute_maps am
         INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
         WHERE cm.hub_category_id = $1 AND cm.platform = $2`,
        [product.hub_category_id, channel]
      )
    : { rows: [] };

  const valueRows = product.hub_category_id
    ? await query<{ channel_attribute_map_id: string; hub_value: string; channel_value: string }>(
        `SELECT v.channel_attribute_map_id, v.hub_value, v.channel_value
         FROM channel_attribute_value_maps v
         INNER JOIN channel_attribute_maps am ON am.id = v.channel_attribute_map_id
         INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
         WHERE cm.hub_category_id = $1 AND cm.platform = $2`,
        [product.hub_category_id, channel]
      )
    : { rows: [] };

  const variantAttributes: Record<string, string> = {};
  if (product.variant_id) {
    const attrs = await query<{ canonical_name: string; canonical_value: string }>(
      `SELECT ax.canonical_name, va.canonical_value
       FROM variant_attributes va
       INNER JOIN attribute_axes ax ON ax.id = va.axis_id
       WHERE va.variant_id = $1`,
      [product.variant_id]
    );
    for (const row of attrs.rows) variantAttributes[row.canonical_name] = row.canonical_value;
  }

  const mapsInput: AttributeMapInput[] = maps.rows.map((row) => ({
    channelAttributeId: row.channel_attribute_id,
    channelAttributeName: row.channel_attribute_name,
    required: row.required,
    mode: row.mode,
    fixedValue: row.fixed_value,
    sourceField: row.source_field,
    valueMaps: valueRows.rows
      .filter((value) => value.channel_attribute_map_id === row.id)
      .map((value) => ({ hubValue: value.hub_value, channelValue: value.channel_value })),
  }));
  const materialized = materializeChannelAttributes({
    maps: mapsInput,
    product: { brand: product.brand, name: product.name },
    variantAttributes,
  });

  const price = product.price === null ? 0 : Number(product.price);
  const stock = product.stock === null ? 0 : Math.max(0, Math.floor(Number(product.stock)));
  const payload: MarketplacePublishBody = {
    title: product.name,
    category_id: category.rows[0]?.channel_category_id ?? null,
    price: Number.isFinite(price) ? price : 0,
    currency_id: 'BRL',
    available_quantity: stock,
    buying_mode: 'buy_it_now',
    condition: 'new',
    listing_type_id: 'gold_special',
    seller_custom_field: isBlankSku(product.erp_sku) ? '' : product.erp_sku,
    attributes: materialized.attributes,
  };

  return {
    performed: false,
    published: false,
    channel,
    method: 'POST',
    endpoint: channel === 'mercadolivre' ? '/items' : '/products',
    payload,
    attributesComplete: mapsInput.length > 0 && materialized.complete && Boolean(payload.category_id),
    missingAttributes: materialized.missing,
  };
}

/** Só a string exata "true" publica sozinho. Ausente ou qualquer outro valor deixa o envio manual. */
export function isAutoPublishEnabled(): boolean {
  return process.env.AUTO_PUBLISH_ENABLED === 'true';
}

export async function recalculateCompleteness(ids: string[]): Promise<Array<{ id: string; percent: number; ready: boolean }>> {
  const byProduct = await checklistForChannels(ids);
  const items = [];
  for (const id of ids) {
    const scores = byProduct.get(id) ?? [];
    if (scores.length === 0) continue;
    for (const checklist of scores) {
      if (checklist.percent === 100) await enqueueAutoPublish(id, checklist.channel);
    }
    const percent = Math.min(...scores.map((score) => score.percent));
    items.push({ id, percent, ready: scores.every((score) => score.percent === 100) });
  }
  return items;
}

async function enqueueAutoPublish(productId: string, channel: PublishChannel): Promise<void> {
  if (!isAutoPublishEnabled()) return;
  const open = await query<{ id: string }>(
    `SELECT id FROM publish_queue
     WHERE product_id = $1 AND channel = $2 AND status IN ('pending', 'processing')
     LIMIT 1`,
    [productId, channel]
  );
  if (open.rows[0]) return;
  const preview = await buildPublishPreview(productId, channel);
  if (!preview?.payload.seller_custom_field) return;
  const inserted = await query<{ id: string }>(
    `INSERT INTO publish_queue (product_id, channel, status, payload_json)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id`,
    [
      productId,
      channel,
      JSON.stringify({
        sku: preview.payload.seller_custom_field,
        price: preview.payload.price,
        stock: preview.payload.available_quantity,
        attributes: preview.payload.attributes,
      }),
    ]
  );
  const id = inserted.rows[0]?.id;
  if (!id || process.env.VITEST) return;
  try {
    const { getPublishQueue } = await import('../queues/publish-queue.js');
    await getPublishQueue().add('publish', { publishQueueId: id }, { jobId: id, attempts: 5, backoff: JITTERED_BACKOFF, removeOnComplete: 1000, removeOnFail: 500 });
  } catch (error) {
    logger.error('Não foi possível acordar o worker. O item ficou pendente na fila.', {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** listing_id do vínculo é o external_id do anúncio naquele canal. */
export async function linkedListingExternalId(productId: string, channel: string): Promise<string | null> {
  const found = await query<{ listing_id: string }>(
    `SELECT listing_id
     FROM channel_listing_links
     WHERE product_id = $1
       AND channel = $2
       AND link_status = 'vinculado'
       AND listing_id <> ''
     LIMIT 1`,
    [productId, channel]
  );
  const listingId = found.rows[0]?.listing_id?.trim() ?? '';
  return listingId || null;
}

type ChannelMapRow = {
  hub_category_id: string;
  platform: PublishChannel;
  channel_attribute_id: string | null;
  channel_attribute_name: string | null;
  required: boolean | null;
  mode: 'fixed' | 'dynamic' | 'manual' | null;
  fixed_value: string | null;
  source_field: string | null;
};

const MAP_CACHE_TTL_MS = 60_000;
const categoryMapCache = new Map<string, { at: number; rows: ChannelMapRow[] }>();

function placeholders(count: number, start = 1): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(', ');
}

async function cachedCategoryMaps(categoryIds: string[], channels: readonly PublishChannel[]): Promise<Map<string, ChannelMapRow[]>> {
  const now = Date.now();
  const out = new Map<string, ChannelMapRow[]>();
  const missing = new Set<string>();
  for (const categoryId of categoryIds) {
    for (const channel of channels) {
      const key = `${categoryId}:${channel}`;
      const hit = categoryMapCache.get(key);
      if (hit && now - hit.at < MAP_CACHE_TTL_MS) out.set(key, hit.rows);
      else missing.add(categoryId);
    }
  }
  if (missing.size === 0) return out;
  const ids = [...missing];
  const found = await query<ChannelMapRow>(
    `SELECT cm.hub_category_id, cm.platform,
            am.channel_attribute_id, am.channel_attribute_name, am.required, am.mode, am.fixed_value, am.source_field
     FROM channel_category_maps cm
     LEFT JOIN channel_attribute_maps am ON am.channel_category_map_id = cm.id
     WHERE cm.hub_category_id IN (${placeholders(ids.length)})
       AND cm.platform IN (${placeholders(channels.length, ids.length + 1)})`,
    [...ids, ...channels]
  );
  const grouped = new Map<string, ChannelMapRow[]>();
  for (const row of found.rows) {
    const key = `${row.hub_category_id}:${row.platform}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  for (const categoryId of ids) {
    for (const channel of channels) {
      const key = `${categoryId}:${channel}`;
      const rows = grouped.get(key) ?? [];
      categoryMapCache.set(key, { at: now, rows });
      out.set(key, rows);
    }
  }
  return out;
}

export type ChannelChecklist = ChecklistResult & { sku: string; channel: PublishChannel };

/** Checklist de vários produtos e canais com uma leitura de cada tabela. */
export async function checklistForChannels(
  productIds: string[],
  channels: readonly PublishChannel[] = ACTIVE_CATALOG_CHANNELS
): Promise<Map<string, ChannelChecklist[]>> {
  const result = new Map<string, ChannelChecklist[]>();
  const ids = [...new Set(productIds.filter((id) => id.length > 0))];
  if (ids.length === 0 || channels.length === 0) return result;
  const idSlots = placeholders(ids.length);
  const [products, covers, links, sellerProducts] = await Promise.all([
    query<{
      id: string;
      erp_id: string;
      erp_sku: string | null;
      ncm_status: string;
      ncm_fiscal_risk: boolean;
      hub_category_id: string | null;
      price: string | null;
      ean: string | null;
      ean_status: string | null;
    }>(
      `SELECT mp.id, mp.erp_id, mp.erp_sku, mp.ncm_status, mp.ncm_fiscal_risk, mp.hub_category_id,
              pv.price::text AS price, pv.ean, pv.ean_status
       FROM master_products mp
       LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
       WHERE mp.id IN (${idSlots})`,
      ids
    ),
    query<{ master_product_id: string; cover_count: number }>(
      `SELECT master_product_id, count(*)::int AS cover_count
       FROM product_images
       WHERE is_cover_eligible = true AND master_product_id IN (${idSlots})
       GROUP BY master_product_id`,
      ids
    ),
    query<{ product_id: string; channel: PublishChannel; listing_id: string }>(
      `SELECT product_id, channel, listing_id
       FROM channel_listing_links
       WHERE link_status = 'vinculado' AND listing_id <> '' AND product_id IN (${idSlots})`,
      ids
    ),
    productsWithSellerWarehouse(ids),
  ]);
  const productById = new Map<string, (typeof products.rows)[number]>();
  for (const row of products.rows) {
    if (!productById.has(row.id)) productById.set(row.id, row);
  }
  const coverById = new Map(covers.rows.map((row) => [row.master_product_id, Number(row.cover_count) || 0]));
  const listingByKey = new Map(links.rows.map((row) => [`${row.product_id}:${row.channel}`, row.listing_id]));
  const eans = [...new Set(products.rows.map((row) => row.ean).filter((ean): ean is string => Boolean(ean)))];
  const duplicateEans = new Set<string>();
  if (eans.length > 0) {
    const owners = await query<{ ean: string; count: number }>(
      `SELECT ean, count(DISTINCT master_product_id)::int AS count
       FROM product_variants
       WHERE ean IN (${placeholders(eans.length)})
       GROUP BY ean`,
      eans
    );
    for (const row of owners.rows) {
      if ((row.count ?? 0) > 1) duplicateEans.add(row.ean);
    }
  }
  const categoryIds = [...new Set(
    [...productById.values()].map((row) => row.hub_category_id).filter((id): id is string => Boolean(id))
  )];
  const mapsByKey = await cachedCategoryMaps(categoryIds, channels);

  for (const id of ids) {
    const row = productById.get(id);
    if (!row) continue;
    const checks: ChannelChecklist[] = [];
    for (const channel of channels) {
      const maps = row.hub_category_id ? mapsByKey.get(`${row.hub_category_id}:${channel}`) ?? [] : [];
      const mapInputs: AttributeMapInput[] = maps
        .filter((map) => map.channel_attribute_id && map.mode)
        .map((map) => ({
          channelAttributeId: map.channel_attribute_id as string,
          channelAttributeName: map.channel_attribute_name ?? '',
          required: Boolean(map.required),
          mode: map.mode as 'fixed' | 'dynamic' | 'manual',
          fixedValue: map.fixed_value,
          sourceField: map.source_field,
          valueMaps: [],
        }));
      const green = maps.length > 0 && mapInputs.length > 0 && isChannelMappingGreen(mapInputs);
      const eanRequired = mapInputs.some(
        (map) => map.required && (['GTIN', 'EAN', 'GTIN14'].includes(map.channelAttributeId) || map.sourceField === 'ean')
      );
      const checklist = evaluateCatalogChecklist({
        erpId: row.erp_id,
        sku: row.erp_sku,
        hasCoverImage: (coverById.get(id) ?? 0) > 0,
        hubCategoryId: row.hub_category_id,
        mappedPlatforms: green ? [channel] : [],
        greenPlatforms: green ? [channel] : [],
        eanStatus: row.ean_status,
        eanRequired,
        ncmStatus: row.ncm_status,
        ncmFiscalRisk: row.ncm_fiscal_risk,
        price: row.price === null ? null : Number(row.price),
        hasDuplicateCandidate: Boolean(row.ean && duplicateEans.has(row.ean)),
        hasSellerWarehouse: sellerProducts.has(id),
        existingListingId: listingByKey.get(`${id}:${channel}`) ?? null,
        channels: [channel],
      });
      checks.push({ ...checklist, sku: row.erp_sku ?? '', channel });
    }
    result.set(id, checks);
  }
  return result;
}

export async function checklistForChannel(
  productId: string,
  channel: PublishChannel
): Promise<(ChecklistResult & { sku: string }) | null> {
  const checks = await checklistForChannels([productId], [channel]);
  return checks.get(productId)?.[0] ?? null;
}
