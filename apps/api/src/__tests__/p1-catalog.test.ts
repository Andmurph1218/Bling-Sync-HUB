import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import {
  ML_CATEGORY_ATTRIBUTES_FIXTURE,
  NS_CATEGORY_ATTRIBUTES_FIXTURE,
  materializeChannelAttributes,
  parseMercadoLivreCategoryAttributes,
  parseNuvemshopCategoryAttributes,
} from '../catalog/channel-attributes.js';
import { evaluateCatalogChecklist } from '../catalog/completeness.js';
import { listCatalog, loadMappedAttributePayload } from '../catalog/list.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('P1 — atributos e completude', () => {
  it('lê os obrigatórios das fixtures de Mercado Livre e Nuvemshop', () => {
    const ml = parseMercadoLivreCategoryAttributes(ML_CATEGORY_ATTRIBUTES_FIXTURE);
    const ns = parseNuvemshopCategoryAttributes(NS_CATEGORY_ATTRIBUTES_FIXTURE);
    expect(ml.filter((row) => row.required).map((row) => row.id)).toEqual(['BRAND', 'COLOR']);
    expect(ns.filter((row) => row.required).map((row) => row.id)).toEqual(['brand', 'color']);
  });

  it('categoria verde sem campo manual gera payload completo', () => {
    const materialized = materializeChannelAttributes({
      maps: [
        {
          channelAttributeId: 'BRAND',
          channelAttributeName: 'Marca',
          required: true,
          mode: 'dynamic',
          fixedValue: null,
          sourceField: 'brand',
          valueMaps: [],
        },
        {
          channelAttributeId: 'COLOR',
          channelAttributeName: 'Cor',
          required: true,
          mode: 'fixed',
          fixedValue: 'Branco',
          sourceField: null,
          valueMaps: [],
        },
      ],
      product: { brand: 'JHS', name: 'Lâmpada' },
      variantAttributes: {},
    });
    expect(materialized.complete).toBe(true);
    expect(materialized.missing).toEqual([]);
    expect(materialized.attributes).toEqual([
      { id: 'BRAND', value_name: 'JHS' },
      { id: 'COLOR', value_name: 'Branco' },
    ]);
  });

  it('campo manual obrigatório não fecha o payload', () => {
    const materialized = materializeChannelAttributes({
      maps: [
        {
          channelAttributeId: 'COLOR',
          channelAttributeName: 'Cor',
          required: true,
          mode: 'manual',
          fixedValue: null,
          sourceField: null,
          valueMaps: [],
        },
      ],
      product: { brand: null, name: null },
      variantAttributes: {},
    });
    expect(materialized.complete).toBe(false);
    expect(materialized.attributes).toEqual([]);
  });

  it('produto ativo sem categoria aparece como sem categoria', () => {
    const checklist = evaluateCatalogChecklist({
      blingId: '1',
      sku: 'SKU-1',
      hasCoverImage: true,
      hubCategoryId: null,
      mappedPlatforms: [],
      greenPlatforms: [],
      eanStatus: 'valid',
      eanRequired: false,
      ncmStatus: 'valid',
      ncmFiscalRisk: false,
      price: 10,
      hasDuplicateCandidate: false,
    });
    expect(checklist.items.find((item) => item.code === 'hub_category')?.title).toBe('Sem categoria');
    expect(checklist.ready).toBe(false);
  });
});

describe('P1 — catálogo no banco', () => {
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
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'operador.p1@blingsync.local',
      name: 'Operador P1',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'operador.p1@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('arquiva e desarquiva sem mudar o status do ERP', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('p1-1', 'P1-ARQ', 'Luminária', 'P', 'S')
       RETURNING id`
    );
    const id = created.rows[0]!.id;
    const before = await request(app).get('/api/catalog/products?status=todos').set('Cookie', cookie);
    expect(before.status).toBe(200);
    expect(before.body.counts.todos).toBe(1);

    const archived = await request(app).post(`/api/catalog/products/${id}/archive`).set('Cookie', cookie);
    expect(archived.status).toBe(200);
    expect(archived.body.erpUntouched).toBe(true);

    const after = await request(app).get('/api/catalog/products?status=arquivados').set('Cookie', cookie);
    expect(after.body.counts.arquivados).toBe(1);
    expect(after.body.counts.todos).toBe(0);
    const status = await query<{ catalog_status: string }>(
      `SELECT catalog_status FROM master_products WHERE id = $1`,
      [id]
    );
    expect(status.rows[0]?.catalog_status).toBe('active');

    const restored = await request(app).post(`/api/catalog/products/${id}/unarchive`).set('Cookie', cookie);
    expect(restored.status).toBe(200);
    const home = await request(app).get('/api/catalog/home').set('Cookie', cookie);
    expect(home.status).toBe(200);
    expect(home.body.cards.products.value).toBe(home.body.counts.todos);
  });

  it('filtra mil SKUs em menos de um segundo e o card bate com a lista', async () => {
    for (let index = 0; index < 1000; index += 1) {
      const sku = `SKU-${String(index).padStart(4, '0')}`;
      await query(
        `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
         VALUES ($1, $2, $3, 'P', 'S')`,
        [`bulk-${index}`, sku, `Produto ${index}`]
      );
    }
    const started = Date.now();
    const filtered = await listCatalog({
      tab: 'todos',
      sku: 'SKU-0999',
      name: '',
      brand: '',
      page: 1,
      pageSize: 50,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(filtered.items.map((item) => item.sku)).toEqual(['SKU-0999']);
    const home = await request(app).get('/api/catalog/home').set('Cookie', cookie);
    const list = await request(app).get('/api/catalog/products?status=todos&pageSize=1').set('Cookie', cookie);
    expect(home.body.cards.products.value).toBe(list.body.counts.todos);
    expect(home.body.cards.incomplete.value).toBe(list.body.counts.completude);
  }, 20000);

  it('mapa verde materializa atributos no payload e manual não entra', async () => {
    const category = await query<{ id: string }>(
      `INSERT INTO hub_categories (name) VALUES ('Lâmpadas') RETURNING id`
    );
    const categoryId = category.rows[0]!.id;
    const product = await query<{ id: string }>(
      `INSERT INTO master_products (
         bling_id, bling_sku, name, brand, bling_tipo, bling_formato, ncm_status, hub_category_id
       ) VALUES ('p1-green', 'LAMP-1', 'Lâmpada LED', 'JHS', 'P', 'S', 'valid', $1)
       RETURNING id`,
      [categoryId]
    );
    const masterId = product.rows[0]!.id;
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (
         master_product_id, bling_sku, is_default, bling_formato, price, stock, ean_status
       ) VALUES ($1, 'LAMP-1', true, 'S', 25.00, 4, 'valid')
       RETURNING id`,
      [masterId]
    );
    await query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform, is_cover_eligible
       ) VALUES ($1, 'https://img.local/lamp.jpg', 'https://img.local/lamp.jpg', 'bling', true)`,
      [masterId]
    );

    const save = await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/mercadolivre`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: 'MLB999001',
        channelCategoryName: 'Lâmpadas',
        attributes: [
          {
            channelAttributeId: 'BRAND',
            channelAttributeName: 'Marca',
            required: true,
            mode: 'dynamic',
            sourceField: 'brand',
          },
          {
            channelAttributeId: 'COLOR',
            channelAttributeName: 'Cor',
            required: true,
            mode: 'fixed',
            fixedValue: 'Branco',
          },
        ],
      });
    expect(save.status).toBe(200);

    const client = await poolInstance.connect();
    try {
      const payload = await loadMappedAttributePayload(client, masterId, variant.rows[0]!.id, 'mercadolivre');
      expect(payload).toEqual([
        { id: 'BRAND', value_name: 'JHS' },
        { id: 'COLOR', value_name: 'Branco' },
      ]);
    } finally {
      client.release();
    }

    await request(app)
      .put(`/api/catalog/categories/${categoryId}/channels/mercadolivre`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: 'MLB999001',
        channelCategoryName: 'Lâmpadas',
        attributes: [
          {
            channelAttributeId: 'COLOR',
            channelAttributeName: 'Cor',
            required: true,
            mode: 'manual',
          },
        ],
      });
    const clientManual = await poolInstance.connect();
    try {
      const payload = await loadMappedAttributePayload(clientManual, masterId, variant.rows[0]!.id, 'mercadolivre');
      expect(payload).toEqual([]);
    } finally {
      clientManual.release();
    }
  });
});
