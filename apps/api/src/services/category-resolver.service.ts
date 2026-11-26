import { PoolClient } from 'pg';
import { activeErpId } from '../connectors/strategy/factory.js';
import { query } from '../db/pool.js';

const CATEGORY_SOURCE = `master_products category_product
  INNER JOIN erp_category_mappings category_mapping
    ON category_mapping.erp_provider = category_product.erp_provider
    AND category_mapping.erp_category_id = category_product.erp_category_id`;

export function mappedCategorySql(alias: string, channel?: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('invalid_sql_alias');
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const provider = literal(activeErpId());
  return `(${alias}.erp_provider = ${provider} AND ${alias}.erp_category_id IS NOT NULL AND ${alias}.erp_category_id IN (SELECT erp_category_id FROM erp_category_mappings WHERE erp_provider = ${provider}${channel ? ` AND channel = ${literal(channel)}` : ''}))`;
}

export async function resolveProductCategories(
  productIds: string[], channels: readonly string[], client?: PoolClient
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  if (productIds.length === 0 || channels.length === 0) return result;
  const slots = (values: readonly string[], offset: number) => values.map((_, i) => `$${i + offset}`).join(', ');
  const sql = `SELECT category_product.id AS product_id, category_mapping.channel, category_mapping.channel_category_id
    FROM ${CATEGORY_SOURCE}
    WHERE category_product.erp_provider = $1 AND category_product.id IN (${slots(productIds, 2)})
      AND category_mapping.channel IN (${slots(channels, productIds.length + 2)})`;
  const args = [activeErpId(), ...productIds, ...channels];
  const found = client
    ? await client.query<{ product_id: string; channel: string; channel_category_id: string }>(sql, args)
    : await query<{ product_id: string; channel: string; channel_category_id: string }>(sql, args);
  for (const row of found.rows) {
    const mappings = result.get(row.product_id) ?? new Map<string, string>();
    mappings.set(row.channel, row.channel_category_id);
    result.set(row.product_id, mappings);
  }
  return result;
}

export async function resolveProductCategory(productId: string, channel: string, client?: PoolClient): Promise<string | null> {
  return (await resolveProductCategories([productId], [channel], client)).get(productId)?.get(channel) ?? null;
}
