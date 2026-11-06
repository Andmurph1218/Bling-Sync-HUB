import https from 'node:https';
import { OAuthTokenManager } from '../oauth-token-manager.js';
import { refreshBlingTokenViaHttp } from '../../routes/oauth.js';
import { query } from '../../db/pool.js';
import {
  CreateProductDTO,
  ErpCatalogPage,
  ErpConnector,
  ErpPriceSnapshot,
  ErpProductSnapshot,
  ErpRejectedError,
  ErpStockBalance,
  ErpStockSnapshot,
} from './types.js';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';
export const STOCK_LAUNCH_WARNING = 'Produto criado no Bling, mas falha ao lançar estoque inicial';

export interface BlingCatalogReader {
  list(page: number, pageSize: number): Promise<ErpCatalogPage>;
  pull(externalId: string): Promise<unknown | null>;
  stock(externalIds: string[]): Promise<ErpStockBalance[]>;
  children(parentId: string): Promise<string[]>;
  create(input: CreateProductDTO): Promise<{ erp_id: string; stockWarning: string | null }>;
}

let productWriterForTests: Pick<BlingCatalogReader, 'create'> | null = null;

/** Testes injetam o cadastro sem chamar a API do Bling. */
export function setBlingProductWriterForTests(writer: Pick<BlingCatalogReader, 'create'> | null): void {
  productWriterForTests = writer;
}

export function blingRejectionMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error: unknown }).error;
    if (error && typeof error === 'object') {
      const fields = (error as { fields?: Array<{ msg?: unknown }> }).fields ?? [];
      const messages = fields
        .map((field) => (typeof field.msg === 'string' ? field.msg.trim() : ''))
        .filter((message) => message.length > 0);
      if (messages.length > 0) return messages.join('; ');
      const description = (error as { description?: unknown }).description;
      const message = (error as { message?: unknown }).message;
      if (typeof description === 'string' && description.trim()) return description.trim();
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
    if (typeof error === 'string' && error.trim()) return error.trim();
  }
  return `A API do Bling respondeu ${status}.`;
}

function blingError(path: string, status: number, data: unknown): Error {
  const message =
    data && typeof data === 'object' && 'error' in data
      ? JSON.stringify((data as { error: unknown }).error).slice(0, 180)
      : '';
  return new Error(`bling ${path} -> ${status}${message ? ` ${message}` : ''}`);
}

function httpsSend(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: unknown
): Promise<{ status: number; text: string }> {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: { status: number; text: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const req = https.request(
      url,
      {
        method,
        agent: false,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          Connection: 'close',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
            : {}),
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
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Leitura paginada da API v3. Uma chamada a cada 450 ms, fora do balde que travava a segunda requisição. */
export class LiveBlingCatalogReader implements BlingCatalogReader {
  private readonly tokens = new OAuthTokenManager();
  private lastCallAt = 0;

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T }> {
    let lastStatus = 0;
    let lastData: T = null as T;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wait = 450 - (Date.now() - this.lastCallAt);
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      try {
        const token = await this.tokens.getValidAccessToken('bling', refreshBlingTokenViaHttp);
        const res = await httpsSend(method, `${BLING_BASE}${path}`, token, body);
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

  private async get<T>(path: string): Promise<{ status: number; data: T }> {
    return this.call<T>('GET', path);
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

  async create(input: CreateProductDTO): Promise<{ erp_id: string; stockWarning: string | null }> {
    const created = await this.call<{ data?: { id?: number | string } }>('POST', '/produtos', {
      nome: input.name,
      codigo: input.sku,
      preco: input.price,
      tipo: 'P',
      formato: 'S',
      situacao: 'A',
      unidade: 'UN',
      estoque: {
        minimo: 0,
        maximo: input.stock,
        crossdocking: 0,
        localizacao: '',
      },
    });
    if (created.status >= 400) throw new ErpRejectedError(blingRejectionMessage(created.data, created.status));
    const id = created.data?.data?.id;
    if (id === undefined || id === null || String(id).length === 0) {
      throw new ErpRejectedError('O Bling não devolveu o ID do produto.');
    }
    const erpId = String(id);
    if (input.stock <= 0) return { erp_id: erpId, stockWarning: null };
    try {
      const deposits = await this.get<{ data?: Array<{ id?: number | string; situacao?: string }> }>(
        '/depositos?pagina=1&limite=100'
      );
      const rows = deposits.status < 400 ? deposits.data.data ?? [] : [];
      const chosen = rows.find((row) => row.situacao !== 'I' && row.id !== undefined && row.id !== null) ?? rows[0];
      const depositId = chosen?.id === undefined || chosen?.id === null ? null : String(chosen.id);
      if (!depositId) return { erp_id: erpId, stockWarning: STOCK_LAUNCH_WARNING };
      const balance = await this.call('POST', '/estoques', {
        produto: { id: Number(erpId) },
        deposito: { id: Number(depositId) },
        operacao: 'B',
        quantidade: input.stock,
        preco: input.price,
        custo: 0,
        observacoes: 'Saldo inicial pelo HUB',
      });
      if (balance.status >= 400) return { erp_id: erpId, stockWarning: STOCK_LAUNCH_WARNING };
    } catch {
      return { erp_id: erpId, stockWarning: STOCK_LAUNCH_WARNING };
    }
    return { erp_id: erpId, stockWarning: null };
  }
}

/** Espelho local para leitura. O cadastro novo sai por createProduct na API do Bling. */
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

  createProduct(productData: CreateProductDTO): Promise<{ erp_id: string; stockWarning: string | null }> {
    if (productWriterForTests) return productWriterForTests.create(productData);
    if (process.env.VITEST === 'true') {
      return Promise.reject(new ErpRejectedError('Criação no Bling não foi simulada neste teste.'));
    }
    return this.reader.create(productData);
  }
}
