import { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import {
  ChannelAttributeDefinition,
  channelCategoryPath,
  findChannelCategory,
  listChannelCategories,
} from './channel-category-catalog.js';
import { MappingField, normalizeMappingText, suggestCategoryMappings } from './mapping-match.js';

export type MappingPlatform = 'nuvemshop' | 'mercadolivre';

export interface ErpCategoryNode {
  key: string;
  name: string;
  path: string[];
  parentKey: string | null;
  hubCategoryId: string | null;
  productCount: number;
  channelCategoryId: string | null;
  channelCategoryName: string | null;
}

export interface StudioChannelNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  attributes: ChannelAttributeDefinition[];
}

export interface AttributeMapDraft {
  channelAttributeId: string;
  channelAttributeName: string;
  required: boolean;
  mode: 'fixed' | 'dynamic' | 'manual';
  fixedValue: string | null;
  sourceField: string | null;
  valueMaps: Array<{ hubValue: string; channelValue: string }>;
}

const PRODUCT_FIELDS: MappingField[] = [
  { code: 'name', label: 'Nome', type: 'text' },
  { code: 'brand', label: 'Marca', type: 'text' },
  { code: 'description', label: 'Descrição', type: 'text' },
  { code: 'sku', label: 'SKU', type: 'text' },
  { code: 'ean', label: 'EAN', type: 'text' },
  { code: 'ncm', label: 'NCM', type: 'text' },
  { code: 'price', label: 'Preço', type: 'number' },
  { code: 'weight', label: 'Peso bruto', type: 'number' },
];

const PRODUCT_TEXT_COLUMN: Record<string, string> = {
  name: 'name',
  brand: 'brand',
  description: 'description',
  sku: 'erp_sku',
  ncm: 'ncm',
};

const NUMBER_AXES = new Set(['peso']);

function pathKey(path: string[]): string {
  return path.map((segment) => normalizeMappingText(segment)).join('>');
}

export async function listMappingFields(): Promise<MappingField[]> {
  const axes = await query<{ canonical_name: string; display_name: string }>(
    `SELECT canonical_name, display_name FROM attribute_axes ORDER BY sort_order, display_name`
  );
  const fields = [...PRODUCT_FIELDS];
  for (const axis of axes.rows) {
    if (fields.some((field) => field.code === axis.canonical_name)) continue;
    fields.push({
      code: axis.canonical_name,
      label: axis.display_name,
      type: NUMBER_AXES.has(axis.canonical_name) ? 'number' : 'text',
    });
  }
  return fields;
}

export async function loadMappingStudio(platform: MappingPlatform): Promise<{
  channelTreeSource: 'fixture';
  erp: ErpCategoryNode[];
  channel: StudioChannelNode[];
  fields: MappingField[];
}> {
  const [hub, maps, erpCategories, hubCounts, fields] = await Promise.all([
    query<{ id: string; parent_id: string | null; name: string }>(
      `SELECT id, parent_id, name FROM hub_categories`
    ),
    query<{ hub_category_id: string; channel_category_id: string; channel_category_name: string }>(
      `SELECT hub_category_id, channel_category_id, channel_category_name
       FROM channel_category_maps WHERE platform = $1`,
      [platform]
    ),
    query<{ category: string; count: number }>(
      `SELECT trim(category) AS category, count(*)::int AS count
       FROM master_products
       WHERE catalog_status = 'active' AND archived_at IS NULL AND hub_category_id IS NULL
         AND category IS NOT NULL AND trim(category) <> ''
       GROUP BY trim(category)`
    ),
    query<{ hub_category_id: string; count: number }>(
      `SELECT hub_category_id, count(*)::int AS count
       FROM master_products
       WHERE catalog_status = 'active' AND archived_at IS NULL AND hub_category_id IS NOT NULL
       GROUP BY hub_category_id`
    ),
    listMappingFields(),
  ]);

  const mapByHub = new Map(maps.rows.map((row) => [row.hub_category_id, row]));
  const countByHub = new Map(hubCounts.rows.map((row) => [row.hub_category_id, row.count]));
  const nodes = new Map<string, ErpCategoryNode>();
  const byPath = new Map<string, string>();
  const pending = [...hub.rows];
  const hubIds = new Set(hub.rows.map((row) => row.id));
  let guard = 0;
  while (pending.length > 0 && guard < hub.rows.length * 2) {
    guard += 1;
    const row = pending.shift()!;
    if (row.parent_id && hubIds.has(row.parent_id) && !nodes.has(row.parent_id)) {
      pending.push(row);
      continue;
    }
    const parent = row.parent_id ? nodes.get(row.parent_id) ?? null : null;
    const path = [...(parent?.path ?? []), row.name];
    const linked = mapByHub.get(row.id);
    const node: ErpCategoryNode = {
      key: row.id,
      name: row.name,
      path,
      parentKey: parent?.key ?? null,
      hubCategoryId: row.id,
      productCount: countByHub.get(row.id) ?? 0,
      channelCategoryId: linked?.channel_category_id ?? null,
      channelCategoryName: linked?.channel_category_name ?? null,
    };
    nodes.set(row.id, node);
    byPath.set(pathKey(path), row.id);
  }

  for (const row of erpCategories.rows) {
    const parts = row.category.split(/\s*(?:>|\/)\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    let parentKey: string | null = null;
    const built: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      built.push(parts[index]!);
      const existing = byPath.get(pathKey(built));
      if (existing) {
        parentKey = existing;
        if (index === parts.length - 1) {
          const node = nodes.get(existing);
          if (node) node.productCount += row.count;
        }
        continue;
      }
      const key = `erp:${pathKey(built)}`;
      nodes.set(key, {
        key,
        name: parts[index]!,
        path: [...built],
        parentKey,
        hubCategoryId: null,
        productCount: index === parts.length - 1 ? row.count : 0,
        channelCategoryId: null,
        channelCategoryName: null,
      });
      byPath.set(pathKey(built), key);
      parentKey = key;
    }
  }

  const channel = listChannelCategories(platform).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    path: channelCategoryPath(platform, node.id),
    attributes: node.attributes,
  }));

  return {
    channelTreeSource: 'fixture',
    erp: [...nodes.values()].sort((a, b) => a.path.join(' > ').localeCompare(b.path.join(' > '), 'pt-BR')),
    channel,
    fields,
  };
}

export async function suggestStudioMappings(platform: MappingPlatform) {
  const studio = await loadMappingStudio(platform);
  return suggestCategoryMappings(
    studio.erp.map((node) => ({ key: node.key, name: node.name, mapped: Boolean(node.channelCategoryId) })),
    studio.channel.map((node) => ({ id: node.id, name: node.name }))
  );
}

export async function listFieldValues(field: string): Promise<string[] | null> {
  if (PRODUCT_TEXT_COLUMN[field]) {
    const column = PRODUCT_TEXT_COLUMN[field];
    const rows = await query<{ value: string }>(
      `SELECT DISTINCT trim(${column}) AS value FROM master_products
       WHERE ${column} IS NOT NULL AND trim(${column}) <> ''
       ORDER BY 1 LIMIT 100`
    );
    return rows.rows.map((row) => row.value);
  }
  if (field === 'ean' || field === 'price' || field === 'weight') {
    const column = field === 'ean' ? 'ean' : field === 'price' ? 'price' : 'gross_weight';
    const rows = await query<{ value: string }>(
      `SELECT DISTINCT ${column}::text AS value FROM product_variants
       WHERE ${column} IS NOT NULL AND ${column}::text <> ''
       ORDER BY 1 LIMIT 100`
    );
    return rows.rows.map((row) => row.value);
  }
  const axis = await query<{ id: string }>(
    `SELECT id FROM attribute_axes WHERE canonical_name = $1`,
    [field]
  );
  if (!axis.rows[0]) return null;
  const rows = await query<{ value: string }>(
    `SELECT DISTINCT va.canonical_value AS value
     FROM variant_attributes va
     WHERE va.axis_id = $1 AND trim(va.canonical_value) <> ''
     ORDER BY 1 LIMIT 100`,
    [axis.rows[0].id]
  );
  return rows.rows.map((row) => row.value);
}

async function ensureHubCategory(client: Pick<PoolClient, 'query'>, name: string, parentId: string | null): Promise<string> {
  const found = await client.query<{ id: string }>(
    `SELECT id FROM hub_categories
     WHERE lower(name) = lower($1)
       AND (($2::text IS NULL AND parent_id IS NULL) OR parent_id::text = $2)
     LIMIT 1`,
    [name, parentId]
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO hub_categories (name, parent_id) VALUES ($1, $2) RETURNING id`,
    [name, parentId]
  );
  return created.rows[0]!.id;
}

export async function ensureHubCategoryPath(
  client: Pick<PoolClient, 'query'>,
  path: string[],
  hubCategoryId: string | null
): Promise<string> {
  if (hubCategoryId) return hubCategoryId;
  let parentId: string | null = null;
  let leaf = '';
  for (const segment of path) {
    leaf = await ensureHubCategory(client, segment, parentId);
    parentId = leaf;
  }
  return leaf;
}

export async function descendantHubCategoryIds(client: Pick<PoolClient, 'query'>, rootId: string): Promise<string[]> {
  const rows = await client.query<{ id: string; parent_id: string | null }>(`SELECT id, parent_id FROM hub_categories`);
  const children = new Map<string, string[]>();
  for (const row of rows.rows) {
    if (!row.parent_id) continue;
    const list = children.get(row.parent_id) ?? [];
    list.push(row.id);
    children.set(row.parent_id, list);
  }
  const out: string[] = [];
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export async function linkChannelCategory(
  client: Pick<PoolClient, 'query'>,
  hubCategoryId: string,
  platform: MappingPlatform,
  channelCategoryId: string,
  channelCategoryName: string,
  matchLabels: string[],
  userId: string | null
): Promise<void> {
  const spec = findChannelCategory(platform, channelCategoryId);
  await client.query(
    `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (hub_category_id, platform) DO UPDATE
       SET channel_category_id = EXCLUDED.channel_category_id,
           channel_category_name = EXCLUDED.channel_category_name`,
    [hubCategoryId, platform, channelCategoryId, channelCategoryName]
  );
  const labels = [...new Set(matchLabels.map((label) => label.trim()).filter(Boolean))];
  if (labels.length > 0) {
    await client.query(
      `UPDATE master_products
       SET hub_category_id = $1, updated_at = now()
       WHERE catalog_status = 'active' AND archived_at IS NULL AND hub_category_id IS NULL
         AND lower(trim(category)) = ANY($2::text[])`,
      [hubCategoryId, labels.map((label) => label.toLowerCase())]
    );
  }
  const required = (spec?.attributes ?? [])
    .filter((attribute) => attribute.required)
    .map((attribute) => ({ id: attribute.id, name: attribute.name }));
  await client.query(
    `INSERT INTO product_category_mappings (
       master_product_id, platform, channel_category_id, channel_path, required_attributes,
       is_verified, verified_by, verified_at, updated_at
     )
     SELECT mp.id, $2, $3, $4, $5::jsonb, true, $6, now(), now()
     FROM master_products mp
     WHERE mp.hub_category_id = $1 AND mp.catalog_status = 'active'
     ON CONFLICT (master_product_id, platform) DO UPDATE
       SET channel_category_id = EXCLUDED.channel_category_id,
           channel_path = EXCLUDED.channel_path,
           required_attributes = EXCLUDED.required_attributes,
           is_verified = true,
           verified_by = EXCLUDED.verified_by,
           verified_at = now(),
           updated_at = now()`,
    [hubCategoryId, platform, channelCategoryId, channelCategoryPath(platform, channelCategoryId), JSON.stringify(required), userId]
  );
}

export async function replaceAttributeMaps(
  client: Pick<PoolClient, 'query'>,
  hubCategoryId: string,
  platform: MappingPlatform,
  attributes: AttributeMapDraft[]
): Promise<void> {
  const map = await client.query<{ id: string }>(
    `SELECT id FROM channel_category_maps WHERE hub_category_id = $1 AND platform = $2`,
    [hubCategoryId, platform]
  );
  const mapId = map.rows[0]?.id;
  if (!mapId) return;
  await client.query(`DELETE FROM channel_attribute_maps WHERE channel_category_map_id = $1`, [mapId]);
  for (const attribute of attributes) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO channel_attribute_maps (
         channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value, source_field
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        mapId,
        attribute.channelAttributeId,
        attribute.channelAttributeName,
        attribute.required,
        attribute.mode,
        attribute.fixedValue,
        attribute.sourceField,
      ]
    );
    for (const value of attribute.valueMaps) {
      await client.query(
        `INSERT INTO channel_attribute_value_maps (channel_attribute_map_id, hub_value, channel_value)
         VALUES ($1, $2, $3)`,
        [inserted.rows[0]!.id, value.hubValue, value.channelValue]
      );
      await rememberAxisAlias(client, attribute.sourceField, value.hubValue, value.channelValue);
    }
  }
}

async function rememberAxisAlias(
  client: Pick<PoolClient, 'query'>,
  sourceField: string | null,
  hubValue: string,
  channelValue: string
): Promise<void> {
  if (!sourceField) return;
  const axis = await client.query<{ id: string }>(
    `SELECT id FROM attribute_axes WHERE canonical_name = $1`,
    [sourceField]
  );
  const axisId = axis.rows[0]?.id;
  if (!axisId) return;
  const existing = await client.query<{ id: string; aliases: string[] }>(
    `SELECT id, aliases FROM attribute_value_aliases WHERE axis_id = $1 AND canonical_value = $2`,
    [axisId, channelValue]
  );
  const current = existing.rows[0];
  const aliases = [...new Set([...(current?.aliases ?? []), hubValue])];
  if (!current) {
    await client.query(
      `INSERT INTO attribute_value_aliases (axis_id, canonical_value, aliases, sort_order) VALUES ($1, $2, $3, 0)`,
      [axisId, channelValue, aliases]
    );
    return;
  }
  await client.query(`UPDATE attribute_value_aliases SET aliases = $2 WHERE id = $1`, [current.id, aliases]);
}

export async function readAttributeDraft(
  hubCategoryId: string,
  platform: MappingPlatform
): Promise<{ channelCategoryId: string; attributes: ChannelAttributeDefinition[]; maps: AttributeMapDraft[] } | null> {
  const linked = await query<{ id: string; channel_category_id: string }>(
    `SELECT id, channel_category_id FROM channel_category_maps WHERE hub_category_id = $1 AND platform = $2`,
    [hubCategoryId, platform]
  );
  const map = linked.rows[0];
  if (!map) return null;
  const spec = findChannelCategory(platform, map.channel_category_id);
  const rows = await query<{
    channel_attribute_id: string;
    channel_attribute_name: string;
    required: boolean;
    mode: AttributeMapDraft['mode'];
    fixed_value: string | null;
    source_field: string | null;
    id: string;
  }>(
    `SELECT id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value, source_field
     FROM channel_attribute_maps WHERE channel_category_map_id = $1`,
    [map.id]
  );
  const values = rows.rows.length
    ? await query<{ channel_attribute_map_id: string; hub_value: string; channel_value: string }>(
        `SELECT channel_attribute_map_id, hub_value, channel_value
         FROM channel_attribute_value_maps
         WHERE channel_attribute_map_id = ANY($1::uuid[])`,
        [rows.rows.map((row) => row.id)]
      )
    : { rows: [] };
  return {
    channelCategoryId: map.channel_category_id,
    attributes: spec?.attributes ?? [],
    maps: rows.rows.map((row) => ({
      channelAttributeId: row.channel_attribute_id,
      channelAttributeName: row.channel_attribute_name,
      required: row.required,
      mode: row.mode,
      fixedValue: row.fixed_value,
      sourceField: row.source_field,
      valueMaps: values.rows
        .filter((value) => value.channel_attribute_map_id === row.id)
        .map((value) => ({ hubValue: value.hub_value, channelValue: value.channel_value })),
    })),
  };
}
