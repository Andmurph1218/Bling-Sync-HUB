import { query } from '../db/pool.js';

export interface WarehouseSummary {
  bling_warehouse_id: string;
  name: string;
  role: string;
  include_in_push: boolean;
  variants: number;
  saldo_virtual: number;
  updated_at: string | null;
}

/**
 * Recalcula stock e catalog_stock a partir dos saldos por depósito já gravados.
 * Roda depois de uma reclassificação, sem chamar o ERP.
 */
export async function recomputeVariantStockFromBalances(): Promise<number> {
  const [balances, current] = await Promise.all([
    query<{ variant_id: string; role: string; include_in_push: boolean; saldo_virtual: string | null }>(
      `SELECT b.variant_id, w.role, w.include_in_push, b.saldo_virtual::text AS saldo_virtual
       FROM variant_stock_balances b
       INNER JOIN stock_warehouses w ON w.bling_warehouse_id = b.bling_warehouse_id`
    ),
    query<{ id: string; stock: string | null; catalog_stock: string | null }>(
      `SELECT id, stock::text AS stock, catalog_stock::text AS catalog_stock
       FROM product_variants
       WHERE id IN (SELECT variant_id FROM variant_stock_balances)`
    ),
  ]);
  const totals = new Map<string, { publishable: number; display: number }>();
  for (const row of balances.rows) {
    const total = totals.get(row.variant_id) ?? { publishable: 0, display: 0 };
    const saldo = Number(row.saldo_virtual ?? 0);
    if (row.role === 'seller' && row.include_in_push) total.publishable += saldo;
    if (row.role !== 'ml_full' && row.role !== 'damaged') total.display += saldo;
    totals.set(row.variant_id, total);
  }
  let changed = 0;
  for (const row of current.rows) {
    const total = totals.get(row.id);
    if (!total) continue;
    const publishable = Number(total.publishable.toFixed(3));
    const display = Number(total.display.toFixed(3));
    if (row.stock !== null && Number(row.stock) === publishable
      && row.catalog_stock !== null && Number(row.catalog_stock) === display) continue;
    await query(
      `UPDATE product_variants SET stock = $2, catalog_stock = $3 WHERE id = $1`,
      [row.id, publishable, display]
    );
    changed += 1;
  }
  return changed;
}

/** Ids dos produtos com pelo menos um saldo em depósito seller marcado para envio. */
export async function productsWithSellerWarehouse(productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const placeholders = productIds.map((_, index) => `$${index + 1}`).join(', ');
  const found = await query<{ master_product_id: string }>(
    `SELECT DISTINCT pv.master_product_id
     FROM product_variants pv
     INNER JOIN variant_stock_balances b ON b.variant_id = pv.id
     INNER JOIN stock_warehouses w ON w.bling_warehouse_id = b.bling_warehouse_id
     WHERE w.role = 'seller' AND w.include_in_push = true
       AND pv.master_product_id IN (${placeholders})`,
    productIds
  );
  return new Set(found.rows.map((row) => row.master_product_id));
}

export async function listWarehouseSummaries(): Promise<WarehouseSummary[]> {
  const [warehouses, totals] = await Promise.all([
    query<{ bling_warehouse_id: string; name: string; role: string; include_in_push: boolean }>(
      `SELECT bling_warehouse_id, name, role, include_in_push
       FROM stock_warehouses
       ORDER BY name ASC, bling_warehouse_id ASC`
    ),
    query<{ bling_warehouse_id: string; variants: number; saldo_virtual: string | null; updated_at: Date | string | null }>(
      `SELECT bling_warehouse_id,
              count(*)::int AS variants,
              sum(saldo_virtual)::text AS saldo_virtual,
              max(updated_at) AS updated_at
       FROM variant_stock_balances
       GROUP BY bling_warehouse_id`
    ),
  ]);
  const byId = new Map(totals.rows.map((row) => [row.bling_warehouse_id, row]));
  return warehouses.rows.map((row) => {
    const total = byId.get(row.bling_warehouse_id);
    const updated = total?.updated_at ?? null;
    return {
      ...row,
      variants: Number(total?.variants ?? 0),
      saldo_virtual: Number(total?.saldo_virtual ?? 0),
      updated_at: updated === null ? null : new Date(updated).toISOString(),
    };
  });
}
