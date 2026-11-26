import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checklistForChannel } from '../catalog/publish-preview.js';
import { buildNuvemshopDraft } from '../connectors/nuvemshop/nuvemshop-draft.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('buildNuvemshopDraft', () => {
  let poolInstance: DbPoolLike;
  let categoryId: string;
  const previousBase = process.env.PUBLIC_BASE_URL;

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    for (const [name, impl] of [
      ['trim', (value: string) => (value ? value.trim() : '')],
      ['lower', (value: string) => (value ? value.toLowerCase() : '')],
    ] as const) {
      mem.public.registerFunction({ name, args: [DataType.text], returns: DataType.text, implementation: impl });
    }
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const adapter = mem.adapters.createPg();
    poolInstance = new adapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });

    const category = await query<{ id: string }>(
      `INSERT INTO hub_categories (name) VALUES ('Vestuário') RETURNING id`
    );
    categoryId = category.rows[0]!.id;
    await query(`INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id) VALUES ('bling', $1, 'nuvemshop', '123456')`, [categoryId]);
    const map = await query<{ id: string }>(
      `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
       VALUES ($1, 'nuvemshop', '123456', 'Camisetas')
       RETURNING id`,
      [categoryId]
    );
    await query(
      `INSERT INTO channel_attribute_maps (
         channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value
       ) VALUES ($1, 'BRAND', 'Marca', true, 'fixed', 'JHS')`,
      [map.rows[0]!.id]
    );
    process.env.PUBLIC_BASE_URL = 'https://hub.test';
  });

  afterAll(async () => {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  async function createVariableProduct(sku: string): Promise<string> {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, description, bling_tipo, product_format, hub_category_id, ncm_status, ncm_fiscal_risk)
       VALUES ($1, $2, 'Camiseta Dry Fit', 'JHS', $3, 'P', 'V', $4, 'valid', false)
       RETURNING id`,
      [`erp-${sku}`, sku, 'Linha 1\n\nLinha 2', categoryId]
    );
    const productId = created.rows[0]!.id;
    await query(`UPDATE master_products SET erp_category_id = $2 WHERE id = $1`, [productId, categoryId]);

    const axes = await query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM attribute_axes WHERE canonical_name IN ('cor', 'tamanho')`
    );
    for (const axis of axes.rows) {
      await query(
        `INSERT INTO product_axes (master_product_id, axis_id, sort_order)
         VALUES ($1, $2, $3)`,
        [productId, axis.id, axis.canonical_name === 'cor' ? 1 : 2]
      );
    }

    const first = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-AZ-M', false, 'S', 49.9, 3, 3) RETURNING id`,
      [productId]
    );
    const second = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-PT-G', false, 'S', 54.9, 4, 4) RETURNING id`,
      [productId]
    );

    const byName = new Map(axes.rows.map((axis) => [axis.canonical_name, axis.id]));
    const rows: Array<[string, string, string]> = [
      [first.rows[0]!.id, byName.get('cor')!, 'Azul'],
      [first.rows[0]!.id, byName.get('tamanho')!, 'M'],
      [second.rows[0]!.id, byName.get('cor')!, 'Preto'],
      [second.rows[0]!.id, byName.get('tamanho')!, 'G'],
    ];
    for (const [variantId, axisId, value] of rows) {
      await query(
        `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order)
         VALUES ($1, $2, $3, 0)`,
        [variantId, axisId, value]
      );
    }

    await query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform,
         sha256_hash, format, is_cover_eligible, position_ns
       ) VALUES
         ($1, 'https://bling.test/secundaria.jpg', 'https://bling.test/secundaria.jpg', 'bling', NULL, 'jpeg', false, 2),
         ($1, 'https://bling.test/capa.jpg', 'https://bling.test/capa.jpg', 'bling', $2, 'jpeg', true, 1)`,
      [productId, 'a'.repeat(64)]
    );

    return productId;
  }

  it('monta eixos, todas as variações, descrição, categoria, marca e imagens (capa primeiro)', async () => {
    const productId = await createVariableProduct('NS-VAR-DRAFT');
    const draft = await buildNuvemshopDraft(productId);
    expect(draft).not.toBeNull();
    expect(draft!.sku).toBe('NS-VAR-DRAFT');
    expect(draft!.brand).toBe('JHS');
    expect(draft!.categoryIds).toEqual([123456]);
    expect(draft!.attributes).toEqual([
      { id: 'cor', value_name: 'Cor', name: 'Cor' },
      { id: 'tamanho', value_name: 'Tamanho', name: 'Tamanho' },
    ]);
    expect(draft!.description).toBe('<p>Linha 1</p><p>Linha 2</p>');
    expect(draft!.variants).toEqual([
      { sku: 'NS-AZ-M', price: 49.9, stock: 3, values: ['Azul', 'M'] },
      { sku: 'NS-PT-G', price: 54.9, stock: 4, values: ['Preto', 'G'] },
    ]);
    expect(draft!.images).toEqual([
      `https://hub.test/api/media/${'a'.repeat(64)}.jpg`,
      'https://bling.test/secundaria.jpg',
    ]);
  });

  it('usa o override de descrição da Nuvemshop com prioridade sobre o master', async () => {
    const productId = await createVariableProduct('NS-VAR-OVERRIDE');
    const variant = await query<{ id: string }>(
      `SELECT id FROM product_variants WHERE master_product_id = $1 ORDER BY erp_sku LIMIT 1`,
      [productId]
    );
    await query(
      `INSERT INTO channel_content_overrides (
         master_product_id, variant_id, platform, field, value, source, status
       ) VALUES ($1, $2, 'nuvemshop', 'description', '<p>Override</p><script>x</script>', 'manual', 'live')`,
      [productId, variant.rows[0]!.id]
    );
    const draft = await buildNuvemshopDraft(productId);
    expect(draft!.description).toBe('<p>Override</p>');
  });

  it('falha quando o ID da categoria não é numérico', async () => {
    const productId = await createVariableProduct('NS-VAR-CAT');
    await query(
      `UPDATE erp_category_mappings SET channel_category_id = 'NS-CAT' WHERE erp_category_id = $1 AND channel = 'nuvemshop'`,
      [categoryId]
    );
    await expect(buildNuvemshopDraft(productId)).rejects.toThrow(/Categoria da Nuvemshop inválida/);
    await query(
      `UPDATE erp_category_mappings SET channel_category_id = '123456' WHERE erp_category_id = $1 AND channel = 'nuvemshop'`,
      [categoryId]
    );
  });

  it('checklist fica verde para produto variável sem is_default', async () => {
    const productId = await createVariableProduct('NS-VAR-CHECK');
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-CHECK', 'Loja Check', 'seller', true)`
    );
    const variants = await query<{ id: string; stock: string | null }>(
      `SELECT id, stock::text AS stock FROM product_variants WHERE master_product_id = $1`,
      [productId]
    );
    for (const variant of variants.rows) {
      await query(
        `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
         VALUES ($1, 'DEP-CHECK', 3, 3)`,
        [variant.id]
      );
    }
    const checklist = await checklistForChannel(productId, 'nuvemshop');
    expect(checklist?.ready).toBe(true);
    expect(checklist?.items.filter((item) => !item.ok)).toEqual([]);
  });
});
