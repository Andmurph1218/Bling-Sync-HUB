import https from 'node:https';
import { OAuthTokenManager } from '../oauth-token-manager.js';
async function refreshBlingToken(currentRefreshToken: string) {
  const oauth = await import('../../routes/oauth.js');
  return oauth.refreshBlingTokenViaHttp(currentRefreshToken);
}
import { acquireBlingRequestSlot } from './bling-http-limit.js';
import { query } from '../../db/pool.js';
import {
  CreateProductDTO,
  ErpCatalogPage,
  ErpCommerceSnapshot,
  ErpConnector,
  ErpPriceSnapshot,
  ErpProductSnapshot,
  ErpRejectedError,
  ErpStockBalance,
  ErpStockSnapshot,
} from '../strategy/types.js';

const BLING_BASE = 'https://api.bling.com.br/Api/v3';

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

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

function numberField(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStockBalance(row: unknown): ErpStockBalance | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as {
    produto?: { id?: number | string };
    id?: number | string;
    saldoVirtualTotal?: unknown;
    depositos?: unknown[];
  };
  const id = record.produto?.id ?? record.id;
  if (id === undefined || id === null || String(id).trim() === '') return null;
  const depositos = (Array.isArray(record.depositos) ? record.depositos : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const deposit = entry as {
      id?: number | string;
      deposito?: { id?: number | string };
      saldoVirtual?: unknown;
      saldoFisico?: unknown;
    };
    const depositId = deposit.id ?? deposit.deposito?.id;
    if (depositId === undefined || depositId === null) return [];
    return [{
      id: depositId,
      saldoVirtual: numberField(deposit.saldoVirtual),
      saldoFisico: numberField(deposit.saldoFisico),
    }];
  });
  const saldoVirtualTotal = record.saldoVirtualTotal == null
    ? depositos.reduce((sum, deposit) => sum + deposit.saldoVirtual, 0)
    : numberField(record.saldoVirtualTotal);
  return {
    externalId: String(id),
    raw: { produto: { id }, depositos, saldoVirtualTotal },
  };
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pushLink(links: string[], value: unknown): void {
  const link = textField(value);
  if (!/^https?:\/\//i.test(link) || links.includes(link)) return;
  links.push(link);
}

function linksFrom(value: unknown, links: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    pushLink(links, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) linksFrom(item, links);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as { link?: unknown; url?: unknown; imagemURL?: unknown; externas?: unknown; internas?: unknown; imagens?: unknown };
  pushLink(links, record.link);
  pushLink(links, record.url);
  pushLink(links, record.imagemURL);
  linksFrom(record.externas, links);
  linksFrom(record.internas, links);
  linksFrom(record.imagens, links);
}

/** Lê imagens, NCM e categoria do JSON de GET /produtos/{id}. Não grava nada no Bling. */
export function readBlingEnrichment(product: unknown): { images: string[]; ncm: string; category: string } {
  if (!product || typeof product !== 'object') return { images: [], ncm: '', category: '' };
  const record = product as {
    imagem?: unknown;
    imagemURL?: unknown;
    galeria?: unknown;
    midia?: { imagens?: unknown; video?: unknown };
    tributacao?: { ncm?: unknown };
    ncm?: unknown;
    categoria?: { descricao?: unknown } | string;
  };
  const images: string[] = [];
  linksFrom(record.imagemURL, images);
  linksFrom(record.imagem, images);
  linksFrom(record.galeria, images);
  linksFrom(record.midia?.imagens, images);
  const ncm = textField(record.tributacao?.ncm ?? record.ncm).replace(/\D/g, '').slice(0, 8);
  const category = typeof record.categoria === 'string'
    ? record.categoria.trim()
    : textField(record.categoria?.descricao);
  return { images, ncm, category };
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
): Promise<{ status: number; text: string; headers: Record<string, string | undefined> }> {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: { status: number; text: string; headers: Record<string, string | undefined> }) => {
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
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
          }
          finish(null, { status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers });
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

export const BLING_POST_TIMEOUT_MESSAGE =
  'O Bling não confirmou a tempo. A criação não foi repetida. Verifique no Bling se o produto foi cadastrado.';

export class BlingPostTimeoutError extends Error {
  constructor() {
    super(BLING_POST_TIMEOUT_MESSAGE);
    this.name = 'BlingPostTimeoutError';
  }
}

export class SkuAlreadyInBlingError extends Error {
  constructor(sku: string, readonly erpId: string | null = null) {
    super(
      erpId
        ? `O SKU ${sku} já existe no Bling. O HUB vai recuperar o cadastro ${erpId}.`
        : `O SKU ${sku} já existe no Bling. A criação foi cancelada. Verifique o cadastro no ERP.`
    );
    this.name = 'SkuAlreadyInBlingError';
  }
}

export function isBlingTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === 'bling_timeout';
}

/** O filtro por código devolve o produto. Sem `codigo` no JSON, qualquer linha já é o SKU pedido. */
export function blingSkuAlreadyListed(
  rows: Array<{ codigo?: string | null }>,
  sku: string
): boolean {
  const wanted = sku.trim().toLowerCase();
  if (!wanted || rows.length === 0) return false;
  const codes = rows.map((row) => (row.codigo ?? '').trim().toLowerCase()).filter((code) => code.length > 0);
  if (codes.length === 0) return true;
  return codes.includes(wanted);
}

const BLING_RETRY_CAP_MS = 60_000;

/** `Retry-After` em segundos ou data HTTP. Sem o cabeçalho, devolve null. */
export function blingRetryAfterMs(
  headers?: Record<string, string | undefined>,
  now = Date.now()
): number | null {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (raw === undefined || raw.trim() === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(BLING_RETRY_CAP_MS, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.min(BLING_RETRY_CAP_MS, Math.max(0, date - now));
}

/** 1s, 2s, 4s… até 30s. Vale quando o Bling não manda Retry-After. */
export function blingBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/** 429 e 5xx podem repetir. 4xx de cliente não. */
export function blingRetryDelayMs(
  attempt: number,
  status: number,
  headers?: Record<string, string | undefined>,
  now = Date.now()
): number | null {
  if (status !== 429 && status < 500) return null;
  return blingRetryAfterMs(headers, now) ?? blingBackoffMs(attempt);
}

/**
 * GET repete timeout, 429 e 5xx. A espera segue Retry-After ou dobra a cada tentativa.
 * POST com timeout ou 5xx não repete: o Bling pode ter gravado o produto.
 */
export async function runBlingCall<T>(
  method: 'GET' | 'POST',
  send: () => Promise<{ status: number; data: T; headers?: Record<string, string | undefined> }>,
  wait: (ms: number) => Promise<void> = sleep
): Promise<{ status: number; data: T }> {
  let lastStatus = 0;
  let lastData: T = null as T;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await send();
      lastStatus = res.status;
      lastData = res.data;
      lastError = null;
      const delay = method === 'POST' && res.status !== 429
        ? null
        : blingRetryDelayMs(attempt, res.status, res.headers);
      if (delay === null || attempt === 3) return { status: res.status, data: res.data };
      await wait(delay);
    } catch (error) {
      if (method === 'POST' && isBlingTimeout(error)) throw new BlingPostTimeoutError();
      lastError = error;
      if (method === 'POST' || attempt === 3) break;
      await wait(blingBackoffMs(attempt));
    }
  }
  if (lastError) throw lastError;
  return { status: lastStatus, data: lastData };
}

/** Leitura e escrita na API v3. A cota de 3 req/s é a mesma para sync, enriquecimento e reconciliação. */
export class LiveBlingCatalogReader implements BlingCatalogReader {
  private readonly tokens = new OAuthTokenManager();

  protected async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T }> {
    return runBlingCall(method, async () => {
      await acquireBlingRequestSlot();
      const token = await this.tokens.getValidAccessToken('bling', refreshBlingToken);
      const res = await httpsSend(method, `${BLING_BASE}${path}`, token, body);
      const data = res.text ? (JSON.parse(res.text) as T) : (null as T);
      return { status: res.status, data, headers: res.headers };
    });
  }

  private async get<T>(path: string): Promise<{ status: number; data: T }> {
    return this.call<T>('GET', path);
  }

  async list(page: number, pageSize: number): Promise<ErpCatalogPage> {
    const path = `/produtos?pagina=${page}&limite=${pageSize}&tipo=P&criterio=2`;
    process.stderr.write(`bling-list ${path}\n`);
    const res = await this.get<{
      data?: Array<{ id?: number | string; variacao?: { produtoPai?: { id?: number | string } }; idProdutoPai?: number | string }>;
      total?: number;
    }>(path);
    process.stderr.write(`bling-list status=${res.status} rows=${res.data.data?.length ?? 0}\n`);
    if (res.status >= 400) {
      throw blingError(path, res.status, res.data);
    }
    const rows = res.data.data ?? [];
    const externalIds = rows
      .map((row) => (row.id === undefined || row.id === null ? '' : String(row.id)))
      .filter((id) => id.length > 0);
    const childIds = rows.flatMap((row) => {
      const id = row.id === undefined || row.id === null ? '' : String(row.id);
      const parent = row.variacao?.produtoPai?.id ?? row.idProdutoPai;
      if (!id || parent === undefined || parent === null || String(parent).trim() === '') return [];
      return [id];
    });
    const total = typeof res.data.total === 'number' ? res.data.total : undefined;
    return {
      page,
      pageSize,
      externalIds,
      childIds,
      done: externalIds.length < pageSize,
      ...(total === undefined ? {} : { total }),
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
    const unique = [...new Set(externalIds.map((id) => String(id)).filter((id) => id.length > 0))];
    const balances: ErpStockBalance[] = [];
    for (const chunk of chunkIds(unique, 50)) {
      balances.push(...(await this.stockChunk(chunk)));
    }
    return balances;
  }

  private async stockChunk(externalIds: string[]): Promise<ErpStockBalance[]> {
    try {
      return await this.stockOnce(externalIds);
    } catch (error) {
      if (externalIds.length <= 1) throw error;
      const middle = Math.ceil(externalIds.length / 2);
      const left = await this.stockChunk(externalIds.slice(0, middle));
      const right = await this.stockChunk(externalIds.slice(middle));
      return [...left, ...right];
    }
  }

  private async stockOnce(externalIds: string[]): Promise<ErpStockBalance[]> {
    const queryString = externalIds.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&');
    const path = `/estoques/saldos?${queryString}`;
    const res = await this.get<{ data?: unknown[] }>(path);
    if (res.status >= 400) throw blingError(path, res.status, res.data);
    return (res.data.data ?? []).flatMap((row) => {
      const normalized = normalizeStockBalance(row);
      return normalized ? [normalized] : [];
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
    const sku = input.sku.trim();
    const lookup = await this.get<{ data?: Array<{ id?: number | string | null; codigo?: string | null }> }>(
      `/produtos?codigo=${encodeURIComponent(sku)}`
    );
    if (lookup.status >= 400) throw new ErpRejectedError(blingRejectionMessage(lookup.data, lookup.status));
    const listed = lookup.data.data ?? [];
    if (blingSkuAlreadyListed(listed, sku)) {
      const match = listed.find((row) => (row.codigo ?? '').trim().toLowerCase() === sku.toLowerCase()) ?? listed[0];
      const foundId = match?.id === undefined || match?.id === null ? null : String(match.id);
      throw new SkuAlreadyInBlingError(sku, foundId);
    }

    const created = await this.call<{ data?: { id?: number | string } }>('POST', '/produtos', {
      nome: input.name,
      codigo: sku,
      preco: input.price,
      tipo: 'P',
      formato: 'S',
      situacao: 'A',
      unidade: 'UN',
      estoque: {
        minimo: 0,
        maximo: 0,
        crossdocking: 0,
        localizacao: '',
      },
    });
    if (created.status >= 400) throw new ErpRejectedError(blingRejectionMessage(created.data, created.status));
    const identity = blingRecordToErpIdentity({ id: created.data?.data?.id, codigo: sku });
    if (!identity.erpId) {
      throw new ErpRejectedError('O ERP não devolveu o ID do produto.');
    }
    return { erp_id: identity.erpId, stockWarning: null };
  }
}

/** Espelho local para leitura. O cadastro novo sai por createProduct na API do Bling. */
export function blingRecordToErpIdentity(record: { id?: number | string | null; codigo?: string | null }): {
  erpId: string;
  erpSku: string;
} {
  return {
    erpId: record.id === undefined || record.id === null ? '' : String(record.id),
    erpSku: record.codigo ?? '',
  };
}

function blingMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

interface BlingCommerceProduct {
  id?: number | string;
  codigo?: string | null;
  preco?: unknown;
  formato?: string;
  dataAlteracao?: string | null;
  variacoes?: BlingCommerceProduct[];
}

/** Traduz o JSON do Bling para preço, SKU e saldos. O restante do HUB não vê esses nomes. */
export function blingCommerceFromPayload(raw: unknown, balances: ErpStockBalance[]): ErpCommerceSnapshot | null {
  if (!raw || typeof raw !== 'object' || !('id' in raw) || (raw as { id?: unknown }).id == null) return null;
  const product = raw as BlingCommerceProduct;
  const externalId = String(product.id);
  const sku = (product.codigo ?? '').trim() || `BLING-${externalId}`;
  const rows = product.variacoes && product.variacoes.length > 0 ? product.variacoes : [product];
  const changed = product.dataAlteracao ? new Date(product.dataAlteracao) : null;
  return {
    externalId,
    sku,
    changedAt: changed && !Number.isNaN(changed.getTime()) ? changed : null,
    lines: rows.flatMap((row) => {
      const id = row.id == null ? '' : String(row.id);
      const lineSku = (row.codigo ?? '').trim();
      if (!id || !lineSku) return [];
      return [{ externalId: id, sku: lineSku, price: blingMoney(row.preco) }];
    }),
    balances,
  };
}

export class BlingErpConnector implements ErpConnector {
  readonly id = 'bling';

  recordUrl(erpId: string): string {
    return `https://www.bling.com.br/produtos.php#edit/${encodeURIComponent(erpId)}`;
  }

  constructor(private readonly reader: BlingCatalogReader = new LiveBlingCatalogReader()) {}

  async syncProduct(productId: string): Promise<ErpProductSnapshot> {
    const found = await query<{ id: string; erp_id: string; erp_sku: string; name: string | null }>(
      `SELECT id, erp_id, erp_sku, name
       FROM master_products
       WHERE id::text = $1 OR erp_id = $1
       LIMIT 1`,
      [productId]
    );
    const row = found.rows[0];
    if (!row) {
      return { found: false, productId: null, externalId: null, sku: null, name: null };
    }
    return { found: true, productId: row.id, externalId: row.erp_id, sku: row.erp_sku, name: row.name };
  }

  async getStock(productId: string): Promise<ErpStockSnapshot> {
    const found = await query<{ stock: string | null }>(
      `SELECT pv.stock::text AS stock
       FROM product_variants pv
       INNER JOIN master_products mp ON mp.id = pv.master_product_id
       WHERE (mp.id::text = $1 OR mp.erp_id = $1) AND pv.is_default = true
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
       WHERE (mp.id::text = $1 OR mp.erp_id = $1) AND pv.is_default = true
       LIMIT 1`,
      [productId]
    );
    const price = found.rows[0]?.price;
    return { found: Boolean(found.rows[0]), price: price === null || price === undefined ? null : Number(price) };
  }

  listCatalogPage(page: number, pageSize: number): Promise<ErpCatalogPage> {
    return this.reader.list(page, pageSize);
  }

  async fetchProductEnrichmentData(erpId: string): Promise<{ images: string[]; ncm: string; category: string }> {
    const product = await this.reader.pull(erpId);
    return readBlingEnrichment(product);
  }

  async pullCatalogProduct(externalId: string): Promise<unknown | null> {
    return this.reader.pull(externalId);
  }

  async readCommerce(externalId: string): Promise<ErpCommerceSnapshot | null> {
    const raw = await this.reader.pull(externalId);
    if (!raw || typeof raw !== 'object') return null;
    const product = raw as BlingCommerceProduct;
    if (product.formato === 'V' && (!product.variacoes || product.variacoes.length === 0)) {
      const children: BlingCommerceProduct[] = [];
      for (const childId of await this.reader.children(externalId)) {
        const child = await this.reader.pull(childId);
        if (child && typeof child === 'object') children.push(child as BlingCommerceProduct);
      }
      product.variacoes = children;
    }
    const draft = blingCommerceFromPayload(product, []);
    if (!draft) return null;
    const ids = [...new Set([draft.externalId, ...draft.lines.map((line) => line.externalId)])];
    return { ...draft, balances: await this.reader.stock(ids) };
  }

  pullStockBalances(externalIds: string[]): Promise<ErpStockBalance[]> {
    return this.reader.stock(externalIds);
  }

  listChildIds(parentId: string): Promise<string[]> {
    return this.reader.children(parentId);
  }

  /** Cria só o cadastro em POST /produtos. Não lança saldo em /estoques. */
  createProduct(productData: CreateProductDTO): Promise<{ erp_id: string; stockWarning: string | null }> {
    if (productWriterForTests) return productWriterForTests.create(productData);
    if (process.env.VITEST === 'true') {
      return Promise.reject(new ErpRejectedError('Criação no Bling não foi simulada neste teste.'));
    }
    return this.reader.create(productData);
  }
}
