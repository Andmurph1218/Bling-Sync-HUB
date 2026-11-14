import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXISTING_LISTING_MESSAGE } from '../catalog/completeness.js';
import { checklistForChannel } from '../catalog/publish-preview.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import { resetNuvemshopRateLimitForTests, setNuvemshopFetchForTests } from '../connectors/strategy/nuvemshop-http.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import { processPublishQueueItem } from '../queues/publish-queue.js';

/** Mutex em memória: o pg-mem não tem lock de linha, então o teste serializa os workers. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

describe('publicação sem duplicidade (sugerido + lock otimista)', () => {
  let poolInstance: DbPoolLike;
  let categoryId = '';
  let posts = 0;
  let listingSeq = 900000;
  let nextListingId = 900001;
  const previousStore = process.env.NUVEMSHOP_STORE_ID;
  const previousAllow = process.env.LIVE_PUBLISH_ALLOWLIST;

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

    const category = await query<{ id: string }>(`INSERT INTO hub_categories (name) VALUES ('Duplicidade') RETURNING id`);
    categoryId = category.rows[0]!.id;
    const map = await query<{ id: string }>(
      `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
       VALUES ($1, 'nuvemshop', '123457', 'Duplicidade')
       RETURNING id`,
      [categoryId]
    );
    await query(
      `INSERT INTO channel_attribute_maps (
         channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value
       ) VALUES ($1, 'BRAND', 'Marca', true, 'fixed', 'JHS')`,
      [map.rows[0]!.id]
    );
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-DUP', 'Loja Duplicidade', 'seller', true)`
    );
    await new OAuthTokenManager().upsertToken({
      provider: 'nuvemshop',
      accessToken: 'token-de-teste',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    process.env.NUVEMSHOP_STORE_ID = '998877';
    process.env.LIVE_PUBLISH_ALLOWLIST = 'SUG-1,SUG-2,CONC-1,PROC-1,IDX-1';

    setNuvemshopFetchForTests(async (url, init) => {
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
      });
      if (init?.method === 'POST') {
        posts += 1;
        return json(201, { id: nextListingId });
      }
      if (url.includes('/products/sku/')) return json(404, {});
      return json(200, []);
    });
  });

  beforeEach(() => {
    posts = 0;
    listingSeq += 1;
    nextListingId = listingSeq;
  });

  afterAll(async () => {
    setNuvemshopFetchForTests(null);
    resetNuvemshopRateLimitForTests();
    if (previousStore === undefined) delete process.env.NUVEMSHOP_STORE_ID;
    else process.env.NUVEMSHOP_STORE_ID = previousStore;
    if (previousAllow === undefined) delete process.env.LIVE_PUBLISH_ALLOWLIST;
    else process.env.LIVE_PUBLISH_ALLOWLIST = previousAllow;
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  async function createReadyProduct(sku: string): Promise<string> {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (
         erp_id, erp_sku, name, brand, bling_tipo, product_format, hub_category_id, ncm_status, ncm_fiscal_risk
       ) VALUES ($1, $2, $3, 'JHS', 'P', 'S', $4, 'valid', false)
       RETURNING id`,
      [`dup-${sku}`, sku, `Produto ${sku}`, categoryId]
    );
    const productId = created.rows[0]!.id;
    const variant = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, $2, true, 'S', 49.9, 5, 5)
       RETURNING id`,
      [productId, sku]
    );
    await query(
      `INSERT INTO product_images (master_product_id, source_url, url_normalized, source_platform, is_cover_eligible)
       VALUES ($1, $2, $2, 'bling', true)`,
      [productId, `https://img.local/${sku}.jpg`]
    );
    await query(
      `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
       VALUES ($1, 'DEP-DUP', 5, 5)`,
      [variant.rows[0]!.id]
    );
    return productId;
  }

  async function enqueue(productId: string): Promise<string> {
    const inserted = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, payload_json)
       VALUES ($1, 'nuvemshop', $2)
       RETURNING id`,
      [productId, JSON.stringify({ sku: 'IGNORADO', price: 1, stock: 1, attributes: [] })]
    );
    return inserted.rows[0]!.id;
  }

  async function insertLink(productId: string, listingId: string, linkStatus: string): Promise<void> {
    await query(
      `INSERT INTO channel_listing_links (product_id, channel, listing_id, link_status)
       VALUES ($1, 'nuvemshop', $2, $3)`,
      [productId, listingId, linkStatus]
    );
  }

  async function queueRow(id: string): Promise<{ status: string; error_message: string | null }> {
    const found = await query<{ status: string; error_message: string | null }>(
      `SELECT status, error_message FROM publish_queue WHERE id = $1`,
      [id]
    );
    return found.rows[0]!;
  }

  it('sugerido com listing_id bloqueia o Criar no checklist e no worker', async () => {
    const productId = await createReadyProduct('SUG-1');
    await insertLink(productId, '777001', 'sugerido');

    const checklist = await checklistForChannel(productId, 'nuvemshop');
    expect(checklist?.ready).toBe(false);
    expect(checklist?.items.find((item) => item.code === 'channel_listing')).toMatchObject({
      ok: false,
      title: EXISTING_LISTING_MESSAGE,
    });

    const id = await enqueue(productId);
    await processPublishQueueItem(id, { live: true });

    expect(posts).toBe(0);
    expect(await queueRow(id)).toEqual({ status: 'failed', error_message: EXISTING_LISTING_MESSAGE });
    const links = await query(`SELECT listing_id, link_status FROM channel_listing_links WHERE product_id = $1`, [productId]);
    expect(links.rows).toEqual([{ listing_id: '777001', link_status: 'sugerido' }]);
  });

  it('promove o vínculo sugerido existente para vinculado no commit, sem estourar o UNIQUE', async () => {
    const productId = await createReadyProduct('SUG-2');
    await insertLink(productId, '', 'sugerido');

    const checklist = await checklistForChannel(productId, 'nuvemshop');
    expect(checklist?.ready).toBe(true);

    const id = await enqueue(productId);
    await processPublishQueueItem(id, { live: true });

    expect(posts).toBe(1);
    expect(await queueRow(id)).toEqual({ status: 'success', error_message: null });
    const links = await query<{ listing_id: string; link_status: string }>(
      `SELECT listing_id, link_status FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
      [productId]
    );
    expect(links.rows).toEqual([{ listing_id: String(nextListingId), link_status: 'vinculado' }]);
  });

  it('dois workers no mesmo job fazem 1 POST e deixam 1 vínculo (Mutex serializa o pg-mem)', async () => {
    const productId = await createReadyProduct('CONC-1');
    const id = await enqueue(productId);
    const mutex = new Mutex();

    await Promise.all([
      mutex.run(() => processPublishQueueItem(id, { live: true })),
      mutex.run(() => processPublishQueueItem(id, { live: true })),
    ]);

    expect(posts).toBe(1);
    expect(await queueRow(id)).toEqual({ status: 'success', error_message: null });
    const links = await query<{ listing_id: string; link_status: string }>(
      `SELECT listing_id, link_status FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
      [productId]
    );
    expect(links.rows).toEqual([{ listing_id: String(nextListingId), link_status: 'vinculado' }]);

    // Com o job já em success, o índice parcial libera um novo pending, mas o vínculo
    // existente bloqueia o segundo POST.
    const replayId = await enqueue(productId);
    await processPublishQueueItem(replayId, { live: true });
    expect(posts).toBe(1);
    expect(await queueRow(replayId)).toEqual({ status: 'failed', error_message: EXISTING_LISTING_MESSAGE });
    const after = await query(`SELECT id FROM channel_listing_links WHERE product_id = $1`, [productId]);
    expect(after.rows).toHaveLength(1);
  });

  it('job já em processing não é reivindicado por outro worker', async () => {
    const productId = await createReadyProduct('PROC-1');
    const id = await enqueue(productId);
    await query(`UPDATE publish_queue SET status = 'processing' WHERE id = $1`, [id]);

    await processPublishQueueItem(id, { live: true });

    expect(posts).toBe(0);
    expect(await queueRow(id)).toEqual({ status: 'processing', error_message: null });
  });

  it('o índice parcial recusa um segundo job aberto para o mesmo produto e canal', async () => {
    const productId = await createReadyProduct('IDX-1');
    await enqueue(productId);

    await expect(enqueue(productId)).rejects.toThrow(/duplicate key|unique/i);
  });
});
