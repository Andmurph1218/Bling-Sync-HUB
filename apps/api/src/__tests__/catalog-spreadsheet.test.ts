import crypto from 'node:crypto';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { newDb, DataType } from 'pg-mem';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createUser } from '../auth/service.js';
import { BlingPostTimeoutError, SkuAlreadyInBlingError, blingRejectionMessage, setBlingProductWriterForTests } from '../connectors/bling/bling-erp.js';
import { STOCK_LAUNCH_WARNING } from '../connectors/strategy/types.js';
import { ErpRejectedError } from '../connectors/strategy/types.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('catálogo — anti-duplicação e planilha', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let cookie = '';

  afterEach(() => {
    setBlingProductWriterForTests(null);
  });

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
    mem.public.registerFunction({
      name: 'lower',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (value: string) => (value ? value.toLowerCase() : ''),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    await createUser({
      email: 'op.planilha@blingsync.local',
      name: 'Operador Planilha',
      password: 'SenhaPessoal!2026',
      roles: ['operator'],
      mustChangePassword: false,
    });
    const login = await request(app).post('/auth/login').send({
      email: 'op.planilha@blingsync.local',
      password: 'SenhaPessoal!2026',
    });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('bloqueia SKU existente, exporta o catálogo e importa só enriquecimento', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, description, bling_tipo, product_format)
       VALUES ('plan-1', 'SKU-PLAN', 'Luminária', 'Descrição antiga', 'P', 'S')
       RETURNING id`
    );
    const productId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock, ean)
       VALUES ($1, 'SKU-PLAN', true, 19.9, 4, '7891000000001')`,
      [productId]
    );

    const exists = await request(app).get('/api/catalog/check-exists?term=7891000000001').set('Cookie', cookie);
    expect(exists.status).toBe(200);
    expect(exists.body.exists).toBe(true);
    expect(exists.body.product.sku).toBe('SKU-PLAN');

    const blocked = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'SKU-PLAN', name: 'Outro', price: 1, stock: 9 });
    expect(blocked.status).toBe(409);

    const missing = await request(app).get('/api/catalog/check-exists?term=NAO-EXISTE').set('Cookie', cookie);
    expect(missing.body.exists).toBe(false);

    const exported = await request(app)
      .get('/api/catalog/export')
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    const exportedBook = new ExcelJS.Workbook();
    await exportedBook.xlsx.load(exported.body);
    expect(exportedBook.worksheets[0]?.getRow(1).getCell(1).text).toBe('SKU');
    const values = exportedBook.worksheets[0]?.getSheetValues().flat().map((value) => String(value ?? ''));
    expect(values).toContain('SKU-PLAN');

    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Catalogo');
    sheet.addRow(['SKU', 'Descrição', 'URL da Imagem', 'Categoria', 'Preço', 'Estoque']);
    sheet.addRow(['NAO-EXISTE', 'Texto', 'https://example.com/x.jpg', 'Iluminação', 1, 9]);
    sheet.addRow(['SKU-PLAN', 'Descrição nova', 'https://example.com/capa.jpg', 'Iluminação', 1, 0]);
    const file = Buffer.from(await book.xlsx.writeBuffer());

    const imported = await request(app)
      .post('/api/catalog/import')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(file);
    expect(imported.status).toBe(200);
    expect(imported.body.lines.map((line: { message: string }) => line.message)).toEqual([
      'Linha 2: SKU não encontrado.',
      'Linha 3: Sucesso. Preço e estoque ignorados.',
    ]);

    const saved = await query<{ description: string; price: string; stock: string; hub_category_id: string }>(
      `SELECT mp.description, pv.price::text AS price, pv.stock::text AS stock, mp.hub_category_id
       FROM master_products mp
       INNER JOIN product_variants pv ON pv.master_product_id = mp.id
       WHERE mp.id = $1`,
      [productId]
    );
    expect(saved.rows[0]?.description).toBe('Descrição nova');
    expect(Number(saved.rows[0]?.price)).toBe(19.9);
    expect(Number(saved.rows[0]?.stock)).toBe(4);
    expect(saved.rows[0]?.hub_category_id).toBeNull();
    const image = await query<{ url_normalized: string }>(
      `SELECT url_normalized FROM product_images WHERE master_product_id = $1`,
      [productId]
    );
    expect(image.rows[0]?.url_normalized).toBe('https://example.com/capa.jpg');
  });

  it('grava o id oficial do Bling e não salva quando o ERP recusa', async () => {
    expect(
      blingRejectionMessage(
        { error: { fields: [{ msg: 'O NCM é obrigatório para esta operação' }] } },
        400
      )
    ).toBe('O NCM é obrigatório para esta operação');

    setBlingProductWriterForTests({
      create: async () => {
        throw new ErpRejectedError('O NCM é obrigatório para esta operação');
      },
    });
    const rejected = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'NOVO-BLING', name: 'Luminária nova', price: 12.5, stock: 3 });
    expect(rejected.status).toBe(422);
    expect(rejected.body.message).toBe('Erro no Bling: O NCM é obrigatório para esta operação');
    const absent = await query(`SELECT id FROM master_products WHERE erp_sku = 'NOVO-BLING'`);
    expect(absent.rowCount).toBe(0);

    let received: unknown = null;
    setBlingProductWriterForTests({
      create: async (input) => {
        received = input;
        return { erp_id: '99887766', stockWarning: null };
      },
    });
    const created = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'NOVO-BLING', name: 'Luminária nova', price: 12.5, stock: 3, description: 'não entra' });
    expect(created.status).toBe(201);
    expect(created.body.erpId).toBe('99887766');
    expect(String(created.body.erpId).startsWith('local-')).toBe(false);
    expect(received).toEqual({ name: 'Luminária nova', sku: 'NOVO-BLING', price: 12.5, stock: 3 });

    const saved = await query<{ erp_id: string; description: string | null; price: string; stock: string | null; catalog_stock: string }>(
      `SELECT mp.erp_id, mp.description, pv.price::text AS price, pv.stock::text AS stock,
              pv.catalog_stock::text AS catalog_stock
       FROM master_products mp
       INNER JOIN product_variants pv ON pv.master_product_id = mp.id
       WHERE mp.erp_sku = 'NOVO-BLING'`
    );
    expect(saved.rows[0]?.erp_id).toBe('99887766');
    expect(saved.rows[0]?.description).toBeNull();
    expect(Number(saved.rows[0]?.price)).toBe(12.5);
    expect(Number(saved.rows[0]?.catalog_stock)).toBe(3);
    expect(saved.rows[0]?.stock).toBeNull();

    setBlingProductWriterForTests({
      create: async () => ({ erp_id: '99887767', stockWarning: STOCK_LAUNCH_WARNING }),
    });
    const partial = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'NOVO-ESTOQUE', name: 'Sem saldo', price: 8, stock: 2 });
    expect(partial.status).toBe(201);
    expect(partial.body.erpId).toBe('99887767');
    expect(partial.body.stockWarning).toBe(STOCK_LAUNCH_WARNING);
    const logged = await query<{ error_detail: string }>(
      `SELECT error_detail FROM sync_logs WHERE idempotency_key = 'bling-stock:99887767'`
    );
    expect(logged.rows[0]?.error_detail).toBe(STOCK_LAUNCH_WARNING);
    const kept = await query<{ erp_id: string }>(
      `SELECT erp_id FROM master_products WHERE erp_sku = 'NOVO-ESTOQUE'`
    );
    expect(kept.rows[0]?.erp_id).toBe('99887767');

    setBlingProductWriterForTests({
      create: async () => {
        throw new SkuAlreadyInBlingError('JA-TEM');
      },
    });
    const duplicate = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'JA-TEM', name: 'Já cadastrado', price: 5, stock: 1 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('O SKU JA-TEM já existe no Bling. A criação foi cancelada. Verifique o cadastro no ERP.');
    const notCreated = await query(`SELECT id FROM master_products WHERE erp_sku = 'JA-TEM'`);
    expect(notCreated.rowCount).toBe(0);

    setBlingProductWriterForTests({
      create: async () => {
        throw new SkuAlreadyInBlingError('ORFAO-1', '555001');
      },
    });
    const recovered = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'ORFAO-1', name: 'Órfão recuperado', price: 6, stock: 1 });
    expect(recovered.status).toBe(201);
    expect(recovered.body).toMatchObject({ erpId: '555001', recovered: true });
    const adopted = await query<{ erp_id: string }>(
      `SELECT erp_id FROM master_products WHERE erp_sku = 'ORFAO-1'`
    );
    expect(adopted.rows[0]?.erp_id).toBe('555001');

    setBlingProductWriterForTests({
      create: async () => {
        throw new BlingPostTimeoutError();
      },
    });
    const unconfirmed = await request(app)
      .post('/api/catalog/products')
      .set('Cookie', cookie)
      .send({ sku: 'TIMEOUT-SKU', name: 'Sem confirmação', price: 5, stock: 1 });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.message).toContain('Verifique no Bling se o produto foi cadastrado.');
    const notSaved = await query(`SELECT id FROM master_products WHERE erp_sku = 'TIMEOUT-SKU'`);
    expect(notSaved.rowCount).toBe(0);
  });
});
