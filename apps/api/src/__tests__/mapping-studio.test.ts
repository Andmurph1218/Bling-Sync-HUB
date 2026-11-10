import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { listChannelCategories } from '../catalog/channel-category-catalog.js';
import { fieldsCompatibleWith, sameMappingValue, suggestCategoryMappings } from '../catalog/mapping-match.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('Correspondência do estúdio de mapeamento', () => {
  const channel = listChannelCategories('nuvemshop').map((node) => ({ id: node.id, name: node.name }));

  it('sugere a categoria do canal com o mesmo nome e ignora a que já está mapeada', () => {
    const suggestions = suggestCategoryMappings(
      [
        { key: 'a', name: 'Lâmpadas', mapped: false },
        { key: 'b', name: 'Disjuntores', mapped: false },
        { key: 'c', name: 'Iluminação', mapped: true },
      ],
      channel
    );
    expect(suggestions).toEqual([
      expect.objectContaining({ key: 'a', channelCategoryId: 'ns-cat-lamps' }),
      expect.objectContaining({ key: 'b', channelCategoryId: 'ns-disjuntores' }),
    ]);
    expect(suggestions.find((row) => row.key === 'c')).toBeUndefined();
  });

  it('não oferece campo de texto para atributo numérico e só trata valores iguais como idênticos', () => {
    const fields = fieldsCompatibleWith('number', [
      { code: 'brand', label: 'Marca', type: 'text' },
      { code: 'weight', label: 'Peso', type: 'number' },
    ]);
    expect(fields.map((field) => field.code)).toEqual(['weight']);
    expect(sameMappingValue('110V', '110v')).toBe(true);
    expect(sameMappingValue('110', '110V')).toBe(false);
  });
});

describe('Estúdio de mapeamento no banco', () => {
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
    for (const [name, impl] of [
      ['trim', (val: string) => (val ? val.trim() : '')],
      ['lower', (val: string) => (val ? val.toLowerCase() : '')],
    ] as const) {
      mem.public.registerFunction({ name, args: [DataType.text], returns: DataType.text, implementation: impl });
    }
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
      email: 'operador.mapa@blingsync.local',
      name: 'Operador Mapa',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'operador.mapa@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
    await query(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, category, bling_tipo, product_format)
       VALUES ('map-1', 'MAP-1', 'Lâmpada', 'Philips', 'Elétrica > Lâmpadas', 'P', 'S')`
    );
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('mostra a categoria do Bling, salva o vínculo e copia para os produtos', async () => {
    const studio = await request(app).get('/api/catalog/mapping-studio?platform=nuvemshop').set('Cookie', cookie);
    expect(studio.status).toBe(200);
    expect(studio.body.channelTreeSource).toBe('fixture');
    const leaf = studio.body.erp.find((node: { name: string }) => node.name === 'Lâmpadas');
    expect(leaf).toMatchObject({ hubCategoryId: null, productCount: 1, channelCategoryId: null });

    const saved = await request(app)
      .post('/api/catalog/mapping-studio/categories')
      .set('Cookie', cookie)
      .send({
        platform: 'nuvemshop',
        items: [{ hubCategoryId: null, path: leaf.path, channelCategoryId: 'ns-cat-lamps', channelCategoryName: 'Lâmpadas' }],
      });
    expect(saved.status).toBe(200);
    const hubCategoryId = saved.body.saved[0];

    const product = await query<{ hub_category_id: string }>(
      `SELECT hub_category_id FROM master_products WHERE erp_id = 'map-1'`
    );
    expect(product.rows[0]?.hub_category_id).toBe(hubCategoryId);
    const verified = await query<{ channel_category_id: string; is_verified: boolean }>(
      `SELECT channel_category_id, is_verified FROM product_category_mappings WHERE master_product_id = (
         SELECT id FROM master_products WHERE erp_id = 'map-1'
       )`
    );
    expect(verified.rows[0]).toMatchObject({ channel_category_id: 'ns-cat-lamps', is_verified: true });
  });

  it('salva o mapa de atributo e o valor vira alias do eixo', async () => {
    const studio = await request(app).get('/api/catalog/mapping-studio?platform=nuvemshop').set('Cookie', cookie);
    const leaf = studio.body.erp.find((node: { name: string; hubCategoryId: string | null }) => node.name === 'Lâmpadas' && node.hubCategoryId);
    const put = await request(app)
      .put(`/api/catalog/categories/${leaf.hubCategoryId}/channels/nuvemshop`)
      .set('Cookie', cookie)
      .send({
        channelCategoryId: 'ns-cat-lamps',
        channelCategoryName: 'Lâmpadas',
        attributes: [
          {
            channelAttributeId: 'voltage',
            channelAttributeName: 'Voltagem',
            required: true,
            mode: 'dynamic',
            sourceField: 'voltagem',
            valueMaps: [{ hubValue: '110', channelValue: '110V' }],
          },
          {
            channelAttributeId: 'power',
            channelAttributeName: 'Potência',
            required: false,
            mode: 'dynamic',
            sourceField: 'weight',
            valueMaps: [],
          },
        ],
      });
    expect(put.status).toBe(200);

    const values = await query<{ hub_value: string; channel_value: string }>(
      `SELECT hub_value, channel_value FROM channel_attribute_value_maps`
    );
    expect(values.rows).toEqual([{ hub_value: '110', channel_value: '110V' }]);
    const alias = await query<{ aliases: string[] }>(
      `SELECT aliases FROM attribute_value_aliases WHERE canonical_value = '110V'`
    );
    expect(alias.rows[0]?.aliases).toContain('110');

    const draft = await request(app)
      .get(`/api/catalog/mapping-studio/attributes?platform=nuvemshop&hubCategoryId=${leaf.hubCategoryId}`)
      .set('Cookie', cookie);
    expect(draft.status).toBe(200);
    expect(draft.body.attributes.map((row: { id: string }) => row.id)).toContain('voltage');
    expect(draft.body.maps).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceField: 'voltagem', valueMaps: [{ hubValue: '110', channelValue: '110V' }] })])
    );
  });
});
