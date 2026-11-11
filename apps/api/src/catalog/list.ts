import { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import {
  AttributeMapInput,
  isChannelMappingGreen,
  materializeChannelAttributes,
} from './channel-attributes.js';
import {
  CatalogChannel,
  ChecklistResult,
  evaluateCatalogChecklist,
} from './completeness.js';
import { ACTIVE_CATALOG_CHANNELS, MERCADO_LIVRE_ACTIVE } from '../config/channels.js';
import { ChannelIntegrationView, describeChannelIntegration } from './integration-status.js';

export type CatalogTab =
  | 'todos'
  | 'publicados'
  | 'completude'
  | 'rejeitados'
  | 'arquivados'
  | 'ready';

export interface CatalogListItem {
  id: string;
  erpId: string;
  sku: string;
  name: string | null;
  brand: string | null;
  typeLabel: string;
  formato: string;
  stock: number | null;
  price: number | null;
  promotionalPrice: number | null;
  coverUrl: string | null;
  channels: Array<{ platform: CatalogChannel; state: 'published' | 'pending' | 'rejected' | 'absent' }>;
  integrations: ChannelIntegrationView[];
  checklist: ChecklistResult;
  archived: boolean;
  published: boolean;
  rejected: boolean;
  categoryName: string | null;
}

interface FlagRow {
  id: string;
  erp_id: string;
  erp_sku: string;
  name: string | null;
  brand: string | null;
  product_format: string;
  ncm_status: string;
  ncm_fiscal_risk: boolean;
  hub_category_id: string | null;
  archived_at: Date | string | null;
  price: string | null;
  promotional_price: string | null;
  stock: string | null;
  ean_status: string | null;
  has_cover: boolean;
  cover_url: string | null;
  published: boolean;
  rejected: boolean;
  duplicate_candidate: boolean;
  ean_required: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  S: 'Simples',
  V: 'Com variações',
  E: 'Kit',
};

function num(value: string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function matchesCatalogTab(
  item: { archived: boolean; published: boolean; rejected: boolean; checklist: ChecklistResult },
  tab: CatalogTab
): boolean {
  if (tab === 'arquivados') return item.archived;
  if (item.archived) return false;
  if (tab === 'todos') return true;
  if (tab === 'publicados') return item.published;
  if (tab === 'rejeitados') return item.rejected;
  if (tab === 'completude') return !item.checklist.ready;
  return item.checklist.ready;
}

const ACTIVE = `mp.catalog_status = 'active'`;
const NOT_ARCHIVED = `${ACTIVE} AND mp.archived_at IS NULL`;
const BLANK_SKU = `(mp.erp_sku IS NULL OR mp.erp_sku = '')`;
const NO_COVER = `mp.id NOT IN (SELECT master_product_id FROM product_images WHERE is_cover_eligible = true)`;
const NO_CATEGORY = `mp.hub_category_id IS NULL`;
const BAD_NCM = `(mp.ncm_status <> 'valid' OR mp.ncm_fiscal_risk = true)`;
const BAD_PRICE = `mp.id NOT IN (
  SELECT master_product_id FROM product_variants
  WHERE is_default = true AND price IS NOT NULL AND price > 0
)`;
const NO_STOCK = `mp.id NOT IN (
  SELECT master_product_id FROM product_variants
  WHERE is_default = true AND stock IS NOT NULL
)`;
const MISSING_CHANNEL = `(
  mp.hub_category_id IS NULL
  OR mp.hub_category_id NOT IN (SELECT hub_category_id FROM channel_category_maps WHERE platform = 'mercadolivre')
  OR mp.hub_category_id NOT IN (SELECT hub_category_id FROM channel_category_maps WHERE platform = 'nuvemshop')
)`;
const BAD_EAN = `mp.hub_category_id IN (
  SELECT cm.hub_category_id
  FROM channel_attribute_maps am
  INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
  WHERE am.required = true
    AND (am.channel_attribute_id IN ('GTIN', 'EAN', 'GTIN14') OR am.source_field = 'ean')
) AND mp.id NOT IN (
  SELECT master_product_id FROM product_variants
  WHERE is_default = true AND ean_status = 'valid'
)`;
const DUPLICATE_EAN = `mp.id IN (
  SELECT pv.master_product_id
  FROM product_variants pv
  INNER JOIN product_variants other
    ON other.ean = pv.ean AND other.master_product_id <> pv.master_product_id
  WHERE pv.ean IS NOT NULL AND pv.ean <> ''
)`;
const LINKED = `mp.id IN (SELECT master_product_id FROM platform_links WHERE sync_status = 'linked')`;
const FAILED_PUSH = `mp.id IN (SELECT master_product_id FROM push_jobs WHERE status = 'failed')`;
const INCOMPLETE = `(${BLANK_SKU} OR ${NO_COVER} OR ${NO_CATEGORY} OR ${BAD_NCM} OR ${BAD_PRICE} OR ${MISSING_CHANNEL} OR ${BAD_EAN} OR ${DUPLICATE_EAN})`;

const GAP_SQL: Record<string, string> = {
  sku: BLANK_SKU,
  cover: NO_COVER,
  hub_category: NO_CATEGORY,
  channel_category: MISSING_CHANNEL,
  attributes: MISSING_CHANNEL,
  ean: BAD_EAN,
  ncm: BAD_NCM,
  price: BAD_PRICE,
  duplicate: DUPLICATE_EAN,
  stock: NO_STOCK,
};

const NO_DIMENSIONS = `mp.id NOT IN (
  SELECT master_product_id FROM product_variants
  WHERE is_default = true
    AND (gross_weight > 0 OR net_weight > 0)
    AND width > 0 AND height > 0 AND depth > 0
)`;
const NO_DESCRIPTION = `(mp.description IS NULL OR mp.description = '')`;

export const QUALITY_SCOPE_SQL = NOT_ARCHIVED;
export const QUALITY_GAP_SQL: Record<string, string> = {
  ...GAP_SQL,
  dimensions: NO_DIMENSIONS,
  description: NO_DESCRIPTION,
  content: `(${MISSING_CHANNEL} OR ${NO_DESCRIPTION})`,
};

function tabSql(tab: CatalogTab): string {
  if (tab === 'arquivados') return `${ACTIVE} AND mp.archived_at IS NOT NULL`;
  if (tab === 'publicados') return `${NOT_ARCHIVED} AND ${LINKED}`;
  if (tab === 'rejeitados') return `${NOT_ARCHIVED} AND ${FAILED_PUSH}`;
  if (tab === 'completude') return `${NOT_ARCHIVED} AND ${INCOMPLETE}`;
  if (tab === 'ready') return `${NOT_ARCHIVED} AND NOT ${INCOMPLETE}`;
  return NOT_ARCHIVED;
}

function channelBadge(
  platform: CatalogChannel,
  links: Array<{ platform: CatalogChannel; sync_status: string }>,
  rejected: boolean
): CatalogListItem['channels'][number] {
  const link = links.find((row) => row.platform === platform);
  if (!link) return { platform, state: 'absent' };
  if (rejected || link.sync_status === 'failed') return { platform, state: 'rejected' };
  if (link.sync_status === 'linked') return { platform, state: 'published' };
  return { platform, state: 'pending' };
}

const GAP_CODES = [
  'sku',
  'cover',
  'hub_category',
  'channel_category',
  'attributes',
  'ean',
  'ncm',
  'price',
  'duplicate',
] as const;

export type CatalogGapCode = (typeof GAP_CODES)[number] | 'stock';

export async function listCatalog(input: {
  tab: CatalogTab;
  sku: string;
  name: string;
  brand: string;
  page: number;
  pageSize: number;
  erpId?: string;
  gap?: string;
  collectGapSamples?: boolean;
  all?: boolean;
}): Promise<{
  items: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CatalogTab, number>;
  gaps: {
    missingSku: number;
    missingCategory: number;
    missingCover: number;
    missingEan: number;
    missingNcm: number;
    missingPrice: number;
    missingAttributes: number;
    missingChannelCategory: number;
    missingDuplicate: number;
    missingStock: number;
    byCode: Record<string, number>;
  };
  gapSamples: Record<string, CatalogListItem[]>;
}> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses = [tabSql(input.tab)];
  if (input.erpId) clauses.push(`mp.erp_id = ${bind(input.erpId)}`);
  const sku = input.sku.trim().toLowerCase();
  const name = input.name.trim().toLowerCase();
  const brand = input.brand.trim().toLowerCase();
  if (sku) clauses.push(`lower(mp.erp_sku) LIKE ${bind(`%${sku}%`)}`);
  if (name) clauses.push(`lower(COALESCE(mp.name, '')) LIKE ${bind(`%${name}%`)}`);
  if (brand) clauses.push(`lower(COALESCE(mp.brand, '')) LIKE ${bind(`%${brand}%`)}`);
  if (input.gap && QUALITY_GAP_SQL[input.gap]) clauses.push(QUALITY_GAP_SQL[input.gap]);
  const where = clauses.join(' AND ');

  const countRow = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM master_products mp WHERE ${where}`,
    params
  );
  const total = countRow.rows[0]?.count ?? 0;
  const pageSize = input.all ? Math.max(total, 1) : Math.min(Math.max(input.pageSize, 1), 100);
  const page = input.all ? 1 : Math.max(input.page, 1);
  const offset = input.all ? 0 : (page - 1) * pageSize;
  const limit = input.all ? Math.max(total, 1) : pageSize;

  const pageRows = await query<Omit<FlagRow, 'has_cover' | 'cover_url' | 'published' | 'rejected' | 'duplicate_candidate' | 'ean_required'> & {
    ean: string | null;
  }>(
    `SELECT
       mp.id, mp.erp_id, mp.erp_sku, mp.name, mp.brand, mp.product_format,
       mp.ncm_status, mp.ncm_fiscal_risk, mp.hub_category_id, mp.archived_at,
       mp.worst_score, mp.has_fiscal_risk,
       pv.price::text AS price, pv.promotional_price::text AS promotional_price,
       pv.stock::text AS stock, pv.ean, pv.ean_status
     FROM master_products mp
     LEFT JOIN product_variants pv ON pv.id = (
       SELECT pv2.id
       FROM product_variants pv2
       WHERE pv2.master_product_id = mp.id
       ORDER BY pv2.is_default DESC, CASE WHEN pv2.price > 0 THEN 0 ELSE 1 END, pv2.updated_at DESC
       LIMIT 1
     )
     WHERE ${where}
     ORDER BY mp.updated_at DESC, mp.erp_sku ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const ids = pageRows.rows.map((row) => row.id);
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const empty = { rows: [] as never[] };
  const [covers, published, rejected, eanRows, requiredEan, maps, links, categoryNames, sends, counts, gapCounts] = await Promise.all([
    ids.length
      ? query<{ master_product_id: string; url_normalized: string }>(
          `SELECT master_product_id, url_normalized FROM product_images
           WHERE is_cover_eligible = true AND master_product_id IN (${placeholders})`,
          ids
        )
      : empty,
    ids.length
      ? query<{ master_product_id: string }>(
          `SELECT master_product_id FROM platform_links
           WHERE sync_status = 'linked' AND master_product_id IN (${placeholders})`,
          ids
        )
      : empty,
    ids.length
      ? query<{ master_product_id: string }>(
          `SELECT master_product_id FROM push_jobs
           WHERE status = 'failed' AND master_product_id IN (${placeholders})`,
          ids
        )
      : empty,
    ids.length
      ? query<{ ean: string; owners: number }>(
          `SELECT ean, count(DISTINCT master_product_id)::int AS owners
           FROM product_variants
           WHERE ean IS NOT NULL AND ean <> '' AND ean IN (
             SELECT ean FROM product_variants WHERE master_product_id IN (${placeholders}) AND ean IS NOT NULL AND ean <> ''
           )
           GROUP BY ean`,
          ids
        )
      : empty,
    query<{ hub_category_id: string }>(
      `SELECT cm.hub_category_id
       FROM channel_attribute_maps am
       INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
       WHERE am.required = true
         AND (am.channel_attribute_id IN ('GTIN', 'EAN', 'GTIN14') OR am.source_field = 'ean')`
    ),
    query<{
        hub_category_id: string;
        platform: CatalogChannel;
        channel_attribute_id: string | null;
        channel_attribute_name: string | null;
        required: boolean | null;
        mode: 'fixed' | 'dynamic' | 'manual' | null;
        fixed_value: string | null;
        source_field: string | null;
      }>(
        `SELECT cm.hub_category_id, cm.platform,
                am.channel_attribute_id, am.channel_attribute_name, am.required, am.mode, am.fixed_value, am.source_field
         FROM channel_category_maps cm
         LEFT JOIN channel_attribute_maps am ON am.channel_category_map_id = cm.id`
      ),
    ids.length
      ? query<{ master_product_id: string; platform: CatalogChannel; sync_status: string }>(
          `SELECT master_product_id, platform, sync_status FROM platform_links
           WHERE master_product_id IN (${placeholders})
           UNION
           SELECT product_id AS master_product_id, channel AS platform, 'linked' AS sync_status
           FROM channel_listing_links
           WHERE link_status = 'vinculado' AND product_id IN (${placeholders})`,
          ids
        )
      : empty,
    query<{ id: string; name: string }>(`SELECT id, name FROM hub_categories`),
    ids.length
      ? query<{ master_product_id: string; platform: CatalogChannel }>(
          `SELECT master_product_id, platform FROM push_jobs
           WHERE status IN ('pending', 'locked', 'blocked') AND master_product_id IN (${placeholders})
           UNION
           SELECT product_id AS master_product_id, channel AS platform FROM publish_queue
           WHERE status IN ('pending', 'processing') AND product_id IN (${ids.map((_, index) => `$${index + ids.length + 1}`).join(', ')})`,
          [...ids, ...ids]
        )
      : empty,
    Promise.all(
      (['todos', 'publicados', 'completude', 'rejeitados', 'arquivados', 'ready'] as const).map(async (tab) => {
        const row = await query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products mp WHERE ${tabSql(tab)}`
        );
        return [tab, row.rows[0]?.count ?? 0] as const;
      })
    ),
    Promise.all(
      Object.entries(GAP_SQL).map(async ([code, sql]) => {
        const row = await query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products mp WHERE ${NOT_ARCHIVED} AND ${sql}`
        );
        return [code, row.rows[0]?.count ?? 0] as const;
      })
    ),
  ]);

  const coverByProduct = new Map<string, string>();
  for (const row of covers.rows) {
    if (!coverByProduct.has(row.master_product_id)) coverByProduct.set(row.master_product_id, row.url_normalized);
  }
  const publishedIds = new Set(published.rows.map((row) => row.master_product_id));
  const rejectedIds = new Set(rejected.rows.map((row) => row.master_product_id));
  const duplicateEans = new Set(eanRows.rows.filter((row) => row.owners > 1).map((row) => row.ean));
  const requiredEanCategories = new Set(requiredEan.rows.map((row) => row.hub_category_id));
  const grouped = new Map<string, Map<CatalogChannel, AttributeMapInput[]>>();
  for (const row of maps.rows) {
    const platforms = grouped.get(row.hub_category_id) ?? new Map();
    const list = platforms.get(row.platform) ?? [];
    if (row.channel_attribute_id && row.mode && row.channel_attribute_name && row.required !== null) {
      list.push({
        channelAttributeId: row.channel_attribute_id,
        channelAttributeName: row.channel_attribute_name,
        required: row.required,
        mode: row.mode,
        fixedValue: row.fixed_value,
        sourceField: row.source_field,
        valueMaps: [],
      });
    } else if (!platforms.has(row.platform)) {
      platforms.set(row.platform, list);
    }
    platforms.set(row.platform, list);
    grouped.set(row.hub_category_id, platforms);
  }

  const linksByProduct = new Map<string, Array<{ platform: CatalogChannel; sync_status: string }>>();
  for (const link of links.rows) {
    const list = linksByProduct.get(link.master_product_id) ?? [];
    list.push({ platform: link.platform, sync_status: link.sync_status });
    linksByProduct.set(link.master_product_id, list);
  }

  const categoryNameById = new Map(categoryNames.rows.map((row) => [row.id, row.name]));
  const sendKeys = new Set(sends.rows.map((row) => `${row.master_product_id}:${row.platform}`));
  const activeChannels = MERCADO_LIVRE_ACTIVE
    ? (['mercadolivre', 'nuvemshop'] as const)
    : (['nuvemshop'] as const);

  const items = pageRows.rows.map((row) => {
    const platforms = row.hub_category_id ? grouped.get(row.hub_category_id) : undefined;
    const mapped = platforms ? (Array.from(platforms.keys()) as CatalogChannel[]) : [];
    const green = platforms
      ? (Array.from(platforms.entries())
          .filter(([, mapsForPlatform]) => mapsForPlatform.length > 0 && isChannelMappingGreen(mapsForPlatform))
          .map(([platform]) => platform) as CatalogChannel[])
      : [];
    const price = num(row.price);
    const hasCover = coverByProduct.has(row.id);
    const isPublished = publishedIds.has(row.id);
    const isRejected = rejectedIds.has(row.id);
    const checklist = evaluateCatalogChecklist({
      erpId: row.erp_id,
      sku: row.erp_sku,
      hasCoverImage: hasCover,
      hubCategoryId: row.hub_category_id,
      mappedPlatforms: mapped,
      greenPlatforms: green,
      eanStatus: row.ean_status,
      eanRequired: Boolean(row.hub_category_id && requiredEanCategories.has(row.hub_category_id)),
      ncmStatus: row.ncm_status,
      ncmFiscalRisk: row.ncm_fiscal_risk,
      price,
      hasDuplicateCandidate: Boolean(row.ean && duplicateEans.has(row.ean)),
      channels: [...ACTIVE_CATALOG_CHANNELS],
    });
    const productLinks = linksByProduct.get(row.id) ?? [];
    const promo = num(row.promotional_price);
    const integrations = activeChannels.map((platform) => {
      const channelChecklist = evaluateCatalogChecklist({
        erpId: row.erp_id,
        sku: row.erp_sku,
        hasCoverImage: hasCover,
        hubCategoryId: row.hub_category_id,
        mappedPlatforms: mapped,
        greenPlatforms: green,
        eanStatus: row.ean_status,
        eanRequired: Boolean(row.hub_category_id && requiredEanCategories.has(row.hub_category_id)),
        ncmStatus: row.ncm_status,
        ncmFiscalRisk: row.ncm_fiscal_risk,
        price,
        hasDuplicateCandidate: Boolean(row.ean && duplicateEans.has(row.ean)),
        channels: [platform],
      });
      const link = productLinks.find((item) => item.platform === platform);
      return describeChannelIntegration({
        platform,
        linkStatus: link?.sync_status ?? null,
        sendRequested: sendKeys.has(`${row.id}:${platform}`),
        checklist: channelChecklist,
      });
    });
    return {
      id: row.id,
      erpId: row.erp_id,
      sku: row.erp_sku,
      name: row.name,
      brand: row.brand,
      typeLabel: TYPE_LABEL[row.product_format] ?? 'Simples',
      formato: row.product_format,
      stock: row.stock === null ? null : Math.floor(Number(row.stock)),
      price,
      promotionalPrice: promo !== null && promo > 0 ? promo : null,
      coverUrl: coverByProduct.get(row.id) ?? null,
      channels: activeChannels.map((platform) => channelBadge(platform, productLinks, isRejected)),
      integrations,
      checklist,
      archived: row.archived_at !== null,
      published: isPublished,
      rejected: isRejected,
      categoryName: row.hub_category_id ? categoryNameById.get(row.hub_category_id) ?? null : null,
    };
  });

  const countRecord = Object.fromEntries(counts) as Record<CatalogTab, number>;
  const byCode = Object.fromEntries(gapCounts);
  const gapSamples: Record<string, CatalogListItem[]> = {};
  if (input.collectGapSamples) {
    for (const code of Object.keys(GAP_SQL)) {
      const samplePage = await listCatalog({
        tab: 'todos',
        sku: '',
        name: '',
        brand: '',
        page: 1,
        pageSize: 40,
        gap: code,
      });
      if (samplePage.items.length > 0) gapSamples[code] = samplePage.items;
    }
  }
  return {
    items,
    total,
    page,
    pageSize: limit,
    counts: countRecord,
    gaps: {
      missingSku: byCode.sku ?? 0,
      missingCategory: byCode.hub_category ?? 0,
      missingCover: byCode.cover ?? 0,
      missingEan: byCode.ean ?? 0,
      missingNcm: byCode.ncm ?? 0,
      missingPrice: byCode.price ?? 0,
      missingAttributes: byCode.attributes ?? 0,
      missingChannelCategory: byCode.channel_category ?? 0,
      missingDuplicate: byCode.duplicate ?? 0,
      missingStock: byCode.stock ?? 0,
      byCode,
    },
    gapSamples,
  };
}

export async function loadMappedAttributePayload(
  client: Pick<PoolClient, 'query'>,
  masterProductId: string,
  variantId: string,
  platform: CatalogChannel
): Promise<Array<{ id: string; value_name: string }>> {
  const productRes = await client.query(
    `SELECT brand, name, hub_category_id FROM master_products WHERE id = $1`,
    [masterProductId]
  );
  const product = productRes.rows[0] as
    | { brand: string | null; name: string | null; hub_category_id: string | null }
    | undefined;
  if (!product?.hub_category_id) return [];

  const mapsRes = await client.query(
    `SELECT am.channel_attribute_id, am.channel_attribute_name, am.required, am.mode, am.fixed_value, am.source_field, am.id
     FROM channel_attribute_maps am
     INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
     WHERE cm.hub_category_id = $1 AND cm.platform = $2`,
    [product.hub_category_id, platform]
  );
  const mapRows = mapsRes.rows as Array<{
    id: string;
    channel_attribute_id: string;
    channel_attribute_name: string;
    required: boolean;
    mode: 'fixed' | 'dynamic' | 'manual';
    fixed_value: string | null;
    source_field: string | null;
  }>;
  if (mapRows.length === 0) return [];

  const valueRes = await client.query(
    `SELECT v.channel_attribute_map_id, v.hub_value, v.channel_value
     FROM channel_attribute_value_maps v
     INNER JOIN channel_attribute_maps am ON am.id = v.channel_attribute_map_id
     INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
     WHERE cm.hub_category_id = $1 AND cm.platform = $2`,
    [product.hub_category_id, platform]
  );
  const values = valueRes.rows as Array<{
    channel_attribute_map_id: string;
    hub_value: string;
    channel_value: string;
  }>;

  const attrRes = await client.query(
    `SELECT ax.canonical_name, va.canonical_value
     FROM variant_attributes va
     INNER JOIN attribute_axes ax ON ax.id = va.axis_id
     WHERE va.variant_id = $1`,
    [variantId]
  );
  const variantAttributes: Record<string, string> = {};
  for (const row of attrRes.rows as Array<{ canonical_name: string; canonical_value: string }>) {
    variantAttributes[row.canonical_name] = row.canonical_value;
  }

  const mapsInput: AttributeMapInput[] = mapRows.map((row) => ({
    channelAttributeId: row.channel_attribute_id,
    channelAttributeName: row.channel_attribute_name,
    required: row.required,
    mode: row.mode,
    fixedValue: row.fixed_value,
    sourceField: row.source_field,
    valueMaps: values
      .filter((value) => value.channel_attribute_map_id === row.id)
      .map((value) => ({ hubValue: value.hub_value, channelValue: value.channel_value })),
  }));
  if (!isChannelMappingGreen(mapsInput)) return [];
  const materialized = materializeChannelAttributes({
    maps: mapsInput,
    product: { brand: product.brand, name: product.name },
    variantAttributes,
  });
  return materialized.complete ? materialized.attributes : [];
}
