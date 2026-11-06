import { evaluateCatalogChecklist } from './completeness.js';
import {
  AttributeMapInput,
  materializeChannelAttributes,
} from './channel-attributes.js';
import { isBlankSku } from './blank-sku.js';
import { query } from '../db/pool.js';

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
    bling_sku: string;
    hub_category_id: string | null;
    price: string | null;
    stock: string | null;
    variant_id: string | null;
  }>(
    `SELECT mp.id, mp.name, mp.brand, mp.bling_sku, mp.hub_category_id,
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
    seller_custom_field: isBlankSku(product.bling_sku) ? '' : product.bling_sku,
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

export async function recalculateCompleteness(ids: string[]): Promise<Array<{ id: string; percent: number; ready: boolean }>> {
  const items = [];
  for (const id of ids) {
    const found = await query<{
      bling_id: string;
      bling_sku: string | null;
      ncm_status: string;
      ncm_fiscal_risk: boolean;
      hub_category_id: string | null;
      price: string | null;
      ean_status: string | null;
      has_cover: boolean;
    }>(
      `SELECT mp.bling_id, mp.bling_sku, mp.ncm_status, mp.ncm_fiscal_risk, mp.hub_category_id,
              pv.price::text AS price, pv.ean_status,
              EXISTS (
                SELECT 1 FROM product_images pi
                WHERE pi.master_product_id = mp.id AND pi.is_cover_eligible = true
              ) AS has_cover
       FROM master_products mp
       LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
       WHERE mp.id = $1`,
      [id]
    );
    const row = found.rows[0];
    if (!row) continue;
    const checklist = evaluateCatalogChecklist({
      blingId: row.bling_id,
      sku: row.bling_sku,
      hasCoverImage: row.has_cover,
      hubCategoryId: row.hub_category_id,
      mappedPlatforms: [],
      greenPlatforms: [],
      eanStatus: row.ean_status,
      eanRequired: false,
      ncmStatus: row.ncm_status,
      ncmFiscalRisk: row.ncm_fiscal_risk,
      price: row.price === null ? null : Number(row.price),
      hasDuplicateCandidate: false,
    });
    items.push({ id, percent: checklist.percent, ready: checklist.ready });
  }
  return items;
}
