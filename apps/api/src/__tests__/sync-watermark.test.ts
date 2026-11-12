import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConnectors } from '../connectors/load.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { InboundProduct } from '../connectors/strategy/inbound.js';
import { applyVariantStockBalancesFromBling, upsertCatalogProductFromBlingPayload } from '../orchestrator/pipeline.js';

function product(overrides: Partial<InboundProduct> = {}): InboundProduct {
  return {
    id: 501,
    nome: 'Luminária',
    codigo: 'LUM-1',
    preco: 50,
    tipo: 'P',
    situacao: 'A',
    formato: 'S',
    ...overrides,
  };
}

describe('sync não pisa em webhook mais novo nem zera preço ausente', () => {
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (value: string) => (value ? value.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await loadConnectors();
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('mantém o preço do webhook quando o snapshot do Bling é mais antigo ou vem sem preço', async () => {
    await upsertCatalogProductFromBlingPayload(product({ preco: 50, dataAlteracao: '2020-01-01T00:00:00.000Z' }));
    await query(`UPDATE master_products SET last_bling_sync = now() WHERE erp_id = '501'`);

    await upsertCatalogProductFromBlingPayload(product({ preco: 10, dataAlteracao: '2019-01-01T00:00:00.000Z' }));
    const stale = await query<{ price: string }>(
      `SELECT price::text AS price FROM product_variants WHERE erp_sku = 'LUM-1'`
    );
    expect(Number(stale.rows[0]?.price)).toBe(50);

    const withoutPrice = product({ dataAlteracao: '2099-01-01T00:00:00.000Z' });
    delete withoutPrice.preco;
    await upsertCatalogProductFromBlingPayload(withoutPrice);
    const kept = await query<{ price: string }>(
      `SELECT price::text AS price FROM product_variants WHERE erp_sku = 'LUM-1'`
    );
    expect(Number(kept.rows[0]?.price)).toBe(50);

    await upsertCatalogProductFromBlingPayload(product({ preco: 80, dataAlteracao: '2099-06-01T00:00:00.000Z' }));
    const fresh = await query<{ price: string }>(
      `SELECT price::text AS price FROM product_variants WHERE erp_sku = 'LUM-1'`
    );
    expect(Number(fresh.rows[0]?.price)).toBe(80);
  });

  it('não grava estoque de um saldo mais antigo que o webhook', async () => {
    const variant = await query<{ id: string }>(
      `SELECT id FROM product_variants WHERE erp_sku = 'LUM-1'`
    );
    const variantId = variant.rows[0]!.id;
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-LUM', 'Loja', 'seller', true)`
    );
    await applyVariantStockBalancesFromBling(variantId, {
      depositos: [{ id: 'DEP-LUM', saldoFisico: 4, saldoVirtual: 4 }],
      saldoVirtualTotal: 4,
    });
    await query(`UPDATE master_products SET last_bling_sync = now() WHERE erp_id = '501'`);
    const kept = await applyVariantStockBalancesFromBling(
      variantId,
      { depositos: [{ id: 'DEP-LUM', saldoFisico: 1, saldoVirtual: 1 }], saldoVirtualTotal: 1 },
      new Date('2019-01-01T00:00:00.000Z')
    );
    expect(kept.variantStockColumn).toBe(4);
    const stored = await query<{ stock: string }>(
      `SELECT stock::text AS stock FROM product_variants WHERE id = $1`,
      [variantId]
    );
    expect(Number(stored.rows[0]?.stock)).toBe(4);
  });
});
