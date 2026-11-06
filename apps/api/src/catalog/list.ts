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

export type CatalogTab =
  | 'todos'
  | 'publicados'
  | 'completude'
  | 'rejeitados'
  | 'arquivados'
  | 'ready';

export interface CatalogListItem {
  id: string;
  blingId: string;
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
  checklist: ChecklistResult;
  archived: boolean;
  published: boolean;
  rejected: boolean;
}

interface FlagRow {
  id: string;
  bling_id: string;
  bling_sku: string;
  name: string | null;
  brand: string | null;
  bling_formato: string;
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

async function loadFlags(): Promise<FlagRow[]> {
  const res = await query<Omit<FlagRow, 'has_cover' | 'cover_url' | 'published' | 'rejected' | 'duplicate_candidate' | 'ean_required'> & {
    ean: string | null;
  }>(
    `SELECT
       mp.id,
       mp.bling_id,
       mp.bling_sku,
       mp.name,
       mp.brand,
       mp.bling_formato,
       mp.ncm_status,
       mp.ncm_fiscal_risk,
       mp.hub_category_id,
       mp.archived_at,
       pv.price::text AS price,
       pv.promotional_price::text AS promotional_price,
       pv.stock::text AS stock,
       pv.ean,
       pv.ean_status
     FROM master_products mp
     LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
     WHERE mp.catalog_status = 'active'`
  );

  const [covers, published, rejected, eanRows] = await Promise.all([
    query<{ master_product_id: string; url_normalized: string }>(
      `SELECT master_product_id, url_normalized
       FROM product_images
       WHERE is_cover_eligible = true`
    ),
    query<{ master_product_id: string }>(
      `SELECT master_product_id FROM platform_links WHERE sync_status = 'linked'`
    ),
    query<{ master_product_id: string }>(
      `SELECT master_product_id FROM push_jobs WHERE status = 'failed'`
    ),
    query<{ ean: string; master_product_id: string }>(
      `SELECT ean, master_product_id
       FROM product_variants
       WHERE ean IS NOT NULL AND ean <> ''`
    ),
  ]);

  const coverByProduct = new Map<string, string>();
  for (const row of covers.rows) {
    if (!coverByProduct.has(row.master_product_id)) coverByProduct.set(row.master_product_id, row.url_normalized);
  }
  const publishedIds = new Set(published.rows.map((row) => row.master_product_id));
  const rejectedIds = new Set(rejected.rows.map((row) => row.master_product_id));
  const eanOwners = new Map<string, Set<string>>();
  for (const row of eanRows.rows) {
    const owners = eanOwners.get(row.ean) ?? new Set<string>();
    owners.add(row.master_product_id);
    eanOwners.set(row.ean, owners);
  }

  const requiredEanCategories = new Set(
    (
      await query<{ hub_category_id: string }>(
        `SELECT cm.hub_category_id
         FROM channel_attribute_maps am
         INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
         WHERE am.required = true
           AND (am.channel_attribute_id IN ('GTIN', 'EAN', 'GTIN14') OR am.source_field = 'ean')`
      )
    ).rows.map((row) => row.hub_category_id)
  );

  return res.rows.map((row) => {
    const owners = row.ean ? eanOwners.get(row.ean) : undefined;
    return {
      ...row,
      has_cover: coverByProduct.has(row.id),
      cover_url: coverByProduct.get(row.id) ?? null,
      published: publishedIds.has(row.id),
      rejected: rejectedIds.has(row.id),
      duplicate_candidate: Boolean(owners && owners.size > 1),
      ean_required: Boolean(row.hub_category_id && requiredEanCategories.has(row.hub_category_id)),
    };
  });
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

export async function listCatalog(input: {
  tab: CatalogTab;
  sku: string;
  name: string;
  brand: string;
  page: number;
  pageSize: number;
  blingId?: string;
}): Promise<{
  items: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CatalogTab, number>;
  gaps: { missingSku: number; missingCategory: number; missingCover: number };
}> {
  const flags = await loadFlags();
  const maps = await query<{
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
      );

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

  const links = await query<{ master_product_id: string; platform: CatalogChannel; sync_status: string }>(
    `SELECT master_product_id, platform, sync_status FROM platform_links`
  );
  const linksByProduct = new Map<string, Array<{ platform: CatalogChannel; sync_status: string }>>();
  for (const link of links.rows) {
    const list = linksByProduct.get(link.master_product_id) ?? [];
    list.push({ platform: link.platform, sync_status: link.sync_status });
    linksByProduct.set(link.master_product_id, list);
  }

  const itemsAll: CatalogListItem[] = flags.map((row) => {
    const platforms = row.hub_category_id ? grouped.get(row.hub_category_id) : undefined;
    const mapped = platforms ? (Array.from(platforms.keys()) as CatalogChannel[]) : [];
    const green = platforms
      ? (Array.from(platforms.entries())
          .filter(([, mapsForPlatform]) => mapsForPlatform.length > 0 && isChannelMappingGreen(mapsForPlatform))
          .map(([platform]) => platform) as CatalogChannel[])
      : [];
    const price = num(row.price);
    const checklist = evaluateCatalogChecklist({
      blingId: row.bling_id,
      sku: row.bling_sku,
      hasCoverImage: row.has_cover,
      hubCategoryId: row.hub_category_id,
      mappedPlatforms: mapped,
      greenPlatforms: green,
      eanStatus: row.ean_status,
      eanRequired: row.ean_required,
      ncmStatus: row.ncm_status,
      ncmFiscalRisk: row.ncm_fiscal_risk,
      price,
      hasDuplicateCandidate: row.duplicate_candidate,
    });
    const productLinks = linksByProduct.get(row.id) ?? [];
    const promo = num(row.promotional_price);
    return {
      id: row.id,
      blingId: row.bling_id,
      sku: row.bling_sku,
      name: row.name,
      brand: row.brand,
      typeLabel: TYPE_LABEL[row.bling_formato] ?? 'Simples',
      formato: row.bling_formato,
      stock: row.stock === null ? null : Math.floor(Number(row.stock)),
      price,
      promotionalPrice: promo !== null && promo > 0 ? promo : null,
      coverUrl: row.cover_url,
      channels: (['mercadolivre', 'nuvemshop'] as const).map((platform) =>
        channelBadge(platform, productLinks, row.rejected)
      ),
      checklist,
      archived: row.archived_at !== null,
      published: row.published,
      rejected: row.rejected,
    };
  });

  const counts: Record<CatalogTab, number> = {
    todos: 0,
    publicados: 0,
    completude: 0,
    rejeitados: 0,
    arquivados: 0,
    ready: 0,
  };
  for (const item of itemsAll) {
    (Object.keys(counts) as CatalogTab[]).forEach((tab) => {
      if (matchesCatalogTab(item, tab)) counts[tab] += 1;
    });
  }

  const sku = input.sku.trim().toLowerCase();
  const name = input.name.trim().toLowerCase();
  const brand = input.brand.trim().toLowerCase();
  const filtered = itemsAll.filter((item) => {
    if (!matchesCatalogTab(item, input.tab)) return false;
    if (input.blingId && item.blingId !== input.blingId) return false;
    if (sku && !item.sku.toLowerCase().includes(sku)) return false;
    if (name && !(item.name ?? '').toLowerCase().includes(name)) return false;
    if (brand && !(item.brand ?? '').toLowerCase().includes(brand)) return false;
    return true;
  });

  const pageSize = Math.min(Math.max(input.pageSize, 1), 100);
  const page = Math.max(input.page, 1);
  const start = (page - 1) * pageSize;
  const active = itemsAll.filter((item) => !item.archived);
  const missing = (code: string) =>
    active.filter((item) => item.checklist.items.some((row) => row.code === code && !row.ok)).length;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    counts,
    gaps: {
      missingSku: missing('sku'),
      missingCategory: missing('hub_category'),
      missingCover: missing('cover'),
    },
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
