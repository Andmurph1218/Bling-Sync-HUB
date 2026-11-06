import https from 'node:https';
import { OAuthTokenManager } from '../oauth-token-manager.js';
import { refreshBlingTokenViaHttp } from '../../routes/oauth.js';
import { query } from '../../db/pool.js';
import {
  ErpCatalogPage,
  ErpConnector,
  ErpPriceSnapshot,
  ErpProductSnapshot,
  ErpStockBalance,
  ErpStockSnapshot,
} from './types.js';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';

export interface BlingCatalogReader {
  list(page: number, pageSize: number): Promise<ErpCatalogPage>;
  pull(externalId: string): Promise<unknown | null>;
  stock(externalIds: string[]): Promise<ErpStockBalance[]>;
  children(parentId: string): Promise<string[]>;
}

function blingError(path: string, status: number, data: unknown): Error {
  const message =
    data && typeof data === 'object' && 'error' in data
      ? JSON.stringify((data as { error: unknown }).error).slice(0, 180)
      : '';
  return new Error(`bling ${path} -> ${status}${message ? ` ${message}` : ''}`);
}

function httpsGet(url: string, token: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: { status: number; text: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const req = https.get(
      url,
      {
        agent: false,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          Connection: 'close',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          finish(null, { status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(new Error('bling_timeout'));
    }, 12_000);
    req.on('error', (error) => finish(error));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Leitura paginada da API v3. Uma chamada a cada 450 ms, fora do balde que travava a segunda requisição. */
export class LiveBlingCatalogReader implements BlingCatalogReader {
  private readonly tokens = new OAuthTokenManager();
  private lastCallAt = 0;

  private async get<T>(path: string): Promise<{ status: number; data: T }> {
    let lastStatus = 0;
    let lastData: T = null as T;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wait = 450 - (Date.now() - this.lastCallAt);
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      try {
        const token = await this.tokens.getValidAccessToken('bling', refreshBlingTokenViaHttp);
        const res = await httpsGet(`${BLING_BASE}${path}`, token);
        lastStatus = res.status;
        lastData = res.text ? (JSON.parse(res.text) as T) : (null as T);
        lastError = null;
        if (res.status !== 429) return { status: lastStatus, data: lastData };
      } catch (error) {
        lastError = error;
      }
      await sleep(1000 * (attempt + 1));
    }
    if (lastError) throw lastError;
    return { status: lastStatus, data: lastData };
  }

  async list(page: number, pageSize: number): Promise<ErpCatalogPage> {
    const path = `/produtos?pagina=${page}&limite=${pageSize}&tipo=P`;
    process.stderr.write(`bling-list ${path}\n`);
    const res = await this.get<{ data?: Array<{ id?: number | string }> }>(path);
    process.stderr.write(`bling-list status=${res.status}\n`);
    if (res.status >= 400) {
      throw blingError(path, res.status, res.data);
    }
    const externalIds = (res.data.data ?? [])
      .map((row) => (row.id === undefined || row.id === null ? '' : String(row.id)))
      .filter((id) => id.length > 0);
    return {
      page,
      pageSize,
      externalIds,
      done: externalIds.length < pageSize,
    };
  }

  async pull(externalId: string): Promise<unknown | null> {
    const path = `/produtos/${encodeURIComponent(externalId)}`;
    const res = await this.get<{ data?: unknown }>(path);
    if (res.status === 404) return null;
    if (res.status >= 400) throw blingError(path, res.status, res.data);
    return res.data.data ?? null;
  }

  async stock(externalIds: string[]): Promise<ErpStockBalance[]> {
    if (externalIds.length === 0) return [];
    const queryString = externalIds.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&');
    const path = `/estoques/saldos?${queryString}`;
    const res = await this.get<{ data?: Array<{ produto?: { id?: number | string } }> }>(path);
    if (res.status >= 400) throw blingError(path, res.status, res.data);
    return (res.data.data ?? []).flatMap((row) => {
      const id = row.produto?.id;
      if (id === undefined || id === null) return [];
      return [{ externalId: String(id), raw: row }];
    });
  }

  async children(parentId: string): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const path = `/produtos?pagina=${page}&limite=100&idProdutoPai=${encodeURIComponent(parentId)}`;
      const res = await this.get<{ data?: Array<{ id?: number | string }> }>(path);
      if (res.status >= 400) throw blingError(path, res.status, res.data);
      const pageIds = (res.data.data ?? [])
        .map((row) => (row.id === undefined || row.id === null ? '' : String(row.id)))
        .filter((id) => id.length > 0);
      ids.push(...pageIds);
      if (pageIds.length < 100) break;
    }
    return ids;
  }
}

/** Lê o espelho local e, na importação completa, pagina o catálogo do Bling. Não grava no ERP. */
export class BlingErpConnector implements ErpConnector {
  readonly id = 'bling';

  constructor(private readonly reader: BlingCatalogReader = new LiveBlingCatalogReader()) {}

  async syncProduct(productId: string): Promise<ErpProductSnapshot> {
    const found = await query<{ id: string; bling_id: string; bling_sku: string; name: string | null }>(
      `SELECT id, bling_id, bling_sku, name
       FROM master_products
       WHERE id::text = $1 OR bling_id = $1
       LIMIT 1`,
      [productId]
    );
    const row = found.rows[0];
    if (!row) {
      return { found: false, productId: null, externalId: null, sku: null, name: null };
    }
    return { found: true, productId: row.id, externalId: row.bling_id, sku: row.bling_sku, name: row.name };
  }

  async getStock(productId: string): Promise<ErpStockSnapshot> {
    const found = await query<{ stock: string | null }>(
      `SELECT pv.stock::text AS stock
       FROM product_variants pv
       INNER JOIN master_products mp ON mp.id = pv.master_product_id
       WHERE (mp.id::text = $1 OR mp.bling_id = $1) AND pv.is_default = true
       LIMIT 1`,
      [productId]
    );
    const stock = found.rows[0]?.stock;
    return { found: Boolean(found.rows[0]), quantity: stock === null || stock === undefined ? null : Math.floor(Number(stock)) };
  }

  async getPrice(productId: string): Promise<ErpPriceSnapshot> {
    const found = await query<{ price: string | null }>(
      `SELECT pv.price::text AS price
       FROM product_variants pv
       INNER JOIN master_products mp ON mp.id = pv.master_product_id
       WHERE (mp.id::text = $1 OR mp.bling_id = $1) AND pv.is_default = true
       LIMIT 1`,
      [productId]
    );
    const price = found.rows[0]?.price;
    return { found: Boolean(found.rows[0]), price: price === null || price === undefined ? null : Number(price) };
  }

  listCatalogPage(page: number, pageSize: number): Promise<ErpCatalogPage> {
    return this.reader.list(page, pageSize);
  }

  pullCatalogProduct(externalId: string): Promise<unknown | null> {
    return this.reader.pull(externalId);
  }

  pullStockBalances(externalIds: string[]): Promise<ErpStockBalance[]> {
    return this.reader.stock(externalIds);
  }

  listChildIds(parentId: string): Promise<string[]> {
    return this.reader.children(parentId);
  }
}
