import crypto from 'node:crypto';
import { DataType, newDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { mappedCategorySql, resolveProductCategory } from '../services/category-resolver.service.js';
import { auditListingCategory, syncCategoryMappings } from '../services/category-audit.service.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { buildPublishPreview, checklistForChannel } from '../catalog/publish-preview.js';
import { buildNuvemshopDraft } from '../connectors/nuvemshop/nuvemshop-draft.js';
import { listCatalog } from '../catalog/list.js';
import { reconcileListings } from '../services/reconciliation.service.js';
import { calculateProductReadinessCre } from '../engines/cre.js';

let pool: DbPoolLike;
let productId: string;
const erp = { id: 'bling', fetchCategoryMappings: async () => [{ erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '123456' }] } as ErpConnector;

describe('categorias soberanas do ERP', () => {
  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => crypto.randomUUID() });
    mem.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (v: string) => v?.trim() ?? '' });
    mem.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (v: string) => v?.length ?? 0 });
    mem.public.registerFunction({ name: 'lower', args: [DataType.text], returns: DataType.text, implementation: (v: string) => v?.toLowerCase() ?? '' });
    const adapter = mem.adapters.createPg();
    pool = new adapter.Pool() as unknown as DbPoolLike;
    setPool(pool);
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    productId = (await query<{ id: string }>(`INSERT INTO master_products (erp_id, erp_sku, erp_category_id) VALUES ('erp-category', 'SKU-CATEGORY', '901') RETURNING id`)).rows[0]!.id;
  });
  afterAll(async () => { if (pool) await pool.end(); setPool(null); });

  it('não aceita a tabela antiga, mesmo com categoria HUB e mapa manual preenchidos', async () => {
    const category = (await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Legada') RETURNING id`)).rows[0]!.id;
    await query(`INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name) VALUES ($1, 'nuvemshop', '999', 'Legada')`, [category]);
    await query(`UPDATE master_products SET hub_category_id = $2 WHERE id = $1`, [productId, category]);
    expect(await resolveProductCategory(productId, 'nuvemshop')).toBeNull();
  });

  it('lê o cache importado sem exigir categoria HUB e usa a mesma resolução nos filtros SQL', async () => {
    await syncCategoryMappings(erp);
    await query(`UPDATE master_products SET hub_category_id = NULL WHERE id = $1`, [productId]);
    expect(await resolveProductCategory(productId, 'nuvemshop')).toBe('123456');
    expect(await resolveProductCategory(productId, 'mercadolivre')).toBeNull();
    const filtered = await query<{ id: string }>(`SELECT mp.id FROM master_products mp WHERE ${mappedCategorySql('mp', 'nuvemshop')}`);
    expect(filtered.rows.map((row) => row.id)).toContain(productId);
  });

  it('recupera referências normalizadas dos snapshots existentes sem exigir nova chamada por produto', async () => {
    const legacyId = (await query<{ id: string }>(`INSERT INTO master_products (erp_id, erp_sku) VALUES ('legacy-category-cache', 'LEGACY-CAT') RETURNING id`)).rows[0]!.id;
    await syncCategoryMappings({ ...erp, readCachedCategoryReferences: async () => [{ externalId: 'legacy-category-cache', erpCategoryId: '901' }] });
    expect(await resolveProductCategory(legacyId, 'nuvemshop')).toBe('123456');
  });

  it('upsert é idempotente e não mistura canais nem provedores', async () => {
    await syncCategoryMappings(erp);
    await syncCategoryMappings(erp);
    expect((await query(`SELECT id FROM erp_category_mappings WHERE erp_provider = 'bling'`)).rows).toHaveLength(1);
    await query(`INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id) VALUES ('outro', '901', 'mercadolivre', 'OUTRO')`);
    expect(await resolveProductCategory(productId, 'mercadolivre')).toBeNull();
  });

  it('não altera o cache se a leitura completa do ERP falhar', async () => {
    await expect(syncCategoryMappings({ ...erp, fetchCategoryMappings: async () => { throw new Error('página 2 indisponível'); } })).rejects.toThrow('página 2');
    expect(await resolveProductCategory(productId, 'nuvemshop')).toBe('123456');
  });

  it('rejeita respostas conflitantes antes de publicar o snapshot', async () => {
    await expect(syncCategoryMappings({ ...erp, fetchCategoryMappings: async () => [
      { erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '1' },
      { erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '2' },
    ] })).rejects.toThrow('conflicting_category_mapping');
    expect(await resolveProductCategory(productId, 'nuvemshop')).toBe('123456');
  });

  it('checklist, preview e draft usam a categoria importada sem mapa manual ou categoria HUB', async () => {
    await query(`INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock) VALUES ($1, 'SKU-CATEGORY', true, 49.9, 3)`, [productId]);
    const checklist = await checklistForChannel(productId, 'nuvemshop');
    expect(checklist?.items.find((item) => item.code === 'hub_category')?.ok).toBe(true);
    expect(checklist?.items.find((item) => item.code === 'channel_category')?.ok).toBe(true);
    const preview = await buildPublishPreview(productId, 'nuvemshop');
    expect(preview?.payload.category_id).toBe('123456');
    expect(preview?.attributesComplete).toBe(true);
    expect((await buildNuvemshopDraft(productId))?.categoryIds).toEqual([123456]);
  });

  it('um vínculo apenas em canal inativo não esconde a categoria ausente no canal ativo', async () => {
    const inactiveOnly = (await query<{ id: string }>(`INSERT INTO master_products (erp_id, erp_sku, erp_category_id) VALUES ('only-ml-category', 'ONLY-ML', 'only-ml') RETURNING id`)).rows[0]!.id;
    await query(`INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id) VALUES ('bling', 'only-ml', 'mercadolivre', 'MLB777')`);
    const missing = await listCatalog({ tab: 'todos', sku: 'ONLY-ML', name: '', brand: '', page: 1, pageSize: 10, gap: 'hub_category' });
    expect(missing.items.map((item) => item.id)).toContain(inactiveOnly);
  });

  it('a listagem e seus filtros reconhecem o vínculo importado sem categoria HUB', async () => {
    await query(`UPDATE master_products SET ncm_status = 'valid', ncm_fiscal_risk = false WHERE id = $1`, [productId]);
    await query(`INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible) VALUES ($1, 'https://img.test/category.jpg', 'https://img.test/category.jpg', 'bling', true)`, [productId]);
    const result = await listCatalog({ tab: 'ready', sku: 'SKU-CATEGORY', name: '', brand: '', page: 1, pageSize: 10 });
    expect(result.items.map((item) => item.id)).toContain(productId);
    expect(result.items.find((item) => item.id === productId)?.checklist.ready).toBe(true);
    const missing = await listCatalog({ tab: 'todos', sku: 'SKU-CATEGORY', name: '', brand: '', page: 1, pageSize: 10, gap: 'hub_category' });
    expect(missing.items).toHaveLength(0);
  });

  it('cria, deduplica, resolve e reabre category_divergence sem tratar leitura desconhecida como correção', async () => {
    const listing = { externalId: 'NS-123', title: 'Produto', price: 49.9, stock: 3, images: [], status: 'active' };
    const reconciled = await reconcileListings(async () => ({ ...listing, categoryIds: ['999'] }), { channels: ['nuvemshop'], sku: 'SKU-CATEGORY', limit: 10 });
    expect(reconciled.alerts).toBe(1);
    await auditListingCategory(productId, 'nuvemshop', { ...listing, categoryIds: ['999'] });
    let alerts = await query<{ type: string; status: string }>(`SELECT type, status FROM divergence_alerts WHERE master_product_id = $1`, [productId]);
    expect(alerts.rows).toEqual([{ type: 'category_divergence', status: 'open' }]);
    await auditListingCategory(productId, 'nuvemshop', listing);
    expect((await query(`SELECT id FROM divergence_alerts WHERE status = 'open'`)).rows).toHaveLength(1);
    await auditListingCategory(productId, 'nuvemshop', { ...listing, categoryIds: ['123456', '888'] });
    alerts = await query(`SELECT type, status FROM divergence_alerts WHERE master_product_id = $1`, [productId]);
    expect(alerts.rows).toEqual([{ type: 'category_divergence', status: 'resolved' }]);
    await auditListingCategory(productId, 'nuvemshop', { ...listing, categoryIds: [] });
    expect((await query(`SELECT id FROM divergence_alerts WHERE status = 'open'`)).rows).toHaveLength(1);
  });

  it('preserva a verificação específica do Mercado Livre além do vínculo importado', async () => {
    await query(`INSERT INTO erp_category_mappings (erp_provider, erp_category_id, channel, channel_category_id) VALUES ('bling', '901', 'mercadolivre', 'MLB901')`);
    let report = await calculateProductReadinessCre(productId);
    expect(report.variants[0]?.blockers).toContain('ml_category_not_verified');
    await query(`INSERT INTO product_category_mappings (master_product_id, platform, channel_category_id, is_verified) VALUES ($1, 'mercadolivre', 'MLB999', true)`, [productId]);
    report = await calculateProductReadinessCre(productId);
    expect(report.variants[0]?.blockers).toContain('ml_category_not_verified');
    await query(`UPDATE product_category_mappings SET channel_category_id = 'MLB901' WHERE master_product_id = $1`, [productId]);
    report = await calculateProductReadinessCre(productId);
    expect(report.variants[0]?.blockers).not.toContain('ml_category_not_verified');
  });

  it('revoga vínculos removidos somente depois de uma leitura completa bem-sucedida', async () => {
    await syncCategoryMappings({ ...erp, fetchCategoryMappings: async () => [] });
    expect(await resolveProductCategory(productId, 'nuvemshop')).toBeNull();
    expect((await query(`SELECT id FROM erp_category_mappings WHERE erp_provider = 'outro'`)).rows).toHaveLength(1);
  });
});
