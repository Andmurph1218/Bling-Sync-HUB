import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { catalogOrderSql, listCatalog, needsDisplayVariant, parseCatalogSort } from '../catalog/list.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('ordenação do catálogo — allowlist', () => {
  it('aceita só as colunas da lista', () => {
    expect(parseCatalogSort('price', 'asc')).toEqual({ sortBy: 'price', sortOrder: 'asc' });
    expect(parseCatalogSort('NAME', 'DESC')).toEqual({ sortBy: 'name', sortOrder: 'desc' });
    expect(parseCatalogSort('completeness', 'asc')).toEqual({ sortBy: 'completeness', sortOrder: 'asc' });
  });

  it('descarta coluna desconhecida e injeção', () => {
    expect(parseCatalogSort('password', 'asc').sortBy).toBeNull();
    expect(parseCatalogSort('name; DROP TABLE master_products', 'asc').sortBy).toBeNull();
    expect(parseCatalogSort(undefined, undefined)).toEqual({ sortBy: null, sortOrder: 'desc' });
  });

  it('ordem inválida cai em desc', () => {
    expect(parseCatalogSort('name', 'lado').sortOrder).toBe('desc');
    expect(parseCatalogSort('name', null).sortOrder).toBe('desc');
  });

  it('sem sortBy mantém a ordenação padrão por atualização', () => {
    expect(catalogOrderSql(null, 'desc')).toBe('mp.updated_at DESC, mp.erp_sku ASC');
  });

  it('monta o ORDER BY de cada coluna', () => {
    expect(catalogOrderSql('name', 'asc')).toBe("lower(COALESCE(mp.name, '')) ASC NULLS LAST, mp.erp_sku ASC");
    expect(catalogOrderSql('sku', 'desc')).toBe("lower(COALESCE(mp.erp_sku, '')) DESC NULLS LAST, mp.erp_sku ASC");
    expect(catalogOrderSql('type', 'asc')).toBe('mp.product_format ASC NULLS LAST, mp.erp_sku ASC');
    expect(catalogOrderSql('price', 'desc')).toContain('dv.price DESC NULLS LAST');
    expect(catalogOrderSql('stock', 'asc')).toContain('COALESCE(dv.catalog_stock, dv.stock) ASC');
    expect(catalogOrderSql('completeness', 'desc')).toContain('CASE WHEN');
  });

  it('só preço, estoque e completude precisam da variante exibida', () => {
    expect(needsDisplayVariant('price')).toBe(true);
    expect(needsDisplayVariant('stock')).toBe(true);
    expect(needsDisplayVariant('completeness')).toBe(true);
    expect(needsDisplayVariant('name')).toBe(false);
    expect(needsDisplayVariant(null)).toBe(false);
  });
});

describe('ordenação do catálogo — banco e rota', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';

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
      implementation: (val: string) => (val ? val.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });
    mem.public.registerFunction({
      name: 'lower',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.toLowerCase() : ''),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'operador.sort@blingsync.local',
      name: 'Operador Sort',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'operador.sort@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';

    const seed = [
      ['s-1', 'AAA-1', 'Zebra', 'S'],
      ['s-2', 'BBB-2', 'abacaxi', 'V'],
      ['s-3', 'CCC-3', 'Melancia', 'E'],
    ] as const;
    for (const [erpId, sku, name, format] of seed) {
      await query(
        `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
         VALUES ($1, $2, $3, 'P', $4)`,
        [erpId, sku, name, format]
      );
    }
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  const list = (sortBy: string | null, sortOrder: 'asc' | 'desc') =>
    listCatalog({ tab: 'todos', sku: '', name: '', brand: '', page: 1, pageSize: 50, sortBy: sortBy as never, sortOrder });

  it('ordena por nome sem diferenciar maiúscula', async () => {
    const asc = await list('name', 'asc');
    expect(asc.items.map((item) => item.name)).toEqual(['abacaxi', 'Melancia', 'Zebra']);
    const desc = await list('name', 'desc');
    expect(desc.items.map((item) => item.name)).toEqual(['Zebra', 'Melancia', 'abacaxi']);
  });

  it('ordena por SKU e por tipo', async () => {
    expect((await list('sku', 'desc')).items.map((item) => item.sku)).toEqual(['CCC-3', 'BBB-2', 'AAA-1']);
    expect((await list('type', 'asc')).items.map((item) => item.formato)).toEqual(['E', 'S', 'V']);
  });

  it('sem sortBy devolve a ordem padrão', async () => {
    const listed = await listCatalog({ tab: 'todos', sku: '', name: '', brand: '', page: 1, pageSize: 50 });
    expect(listed.items).toHaveLength(3);
  });

  it('a rota repete a ordenação aplicada e ignora coluna inválida', async () => {
    const sorted = await request(app)
      .get('/api/catalog/products?status=todos&sortBy=name&sortOrder=asc')
      .set('Cookie', cookie);
    expect(sorted.status).toBe(200);
    expect(sorted.body.sortBy).toBe('name');
    expect(sorted.body.sortOrder).toBe('asc');
    expect(sorted.body.items.map((item: { name: string }) => item.name)).toEqual(['abacaxi', 'Melancia', 'Zebra']);

    const invalid = await request(app)
      .get('/api/catalog/products?status=todos&sortBy=senha&sortOrder=asc')
      .set('Cookie', cookie);
    expect(invalid.status).toBe(200);
    expect(invalid.body.sortBy).toBeNull();
  });
});
