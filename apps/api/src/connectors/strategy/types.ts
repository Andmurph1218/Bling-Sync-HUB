export type IntegrationCategory = 'marketplaces' | 'erps' | 'logistics';

export type IntegrationStatus = 'installed' | 'attention' | 'available';

export interface TokenSnapshot {
  expiresAt: Date | string;
  hasRefresh: boolean;
}

export class ConnectorNotInstalledError extends Error {
  constructor(readonly connectorId: string) {
    super(`connector_not_installed:${connectorId}`);
    this.name = 'ConnectorNotInstalledError';
  }
}

export class LiveWriteDisabledError extends Error {
  constructor(readonly connectorId: string, readonly operation: string) {
    super(`live_write_disabled:${connectorId}:${operation}`);
    this.name = 'LiveWriteDisabledError';
  }
}

export interface ErpProductSnapshot {
  found: boolean;
  productId: string | null;
  externalId: string | null;
  sku: string | null;
  name: string | null;
}

export interface ErpStockSnapshot {
  found: boolean;
  quantity: number | null;
}

export interface ErpPriceSnapshot {
  found: boolean;
  price: number | null;
}

export interface ErpCatalogPage {
  page: number;
  pageSize: number;
  externalIds: string[];
  /** Ids desta página que a lista já identificou como variação de outro produto. */
  childIds?: string[];
  done: boolean;
  total?: number;
}

export interface ErpStockBalance {
  externalId: string;
  raw: unknown;
}

/** Preço e saldos já traduzidos. O core não lê o JSON do ERP. */
export interface ErpCommerceLine {
  externalId: string;
  sku: string;
  price: number | null;
}

export interface ErpCommerceSnapshot {
  externalId: string;
  sku: string;
  changedAt: Date | null;
  lines: ErpCommerceLine[];
  balances: ErpStockBalance[];
}

/** Dados mínimos para abrir o cadastro no ERP. Nome, preço e estoque nascem lá. */
export interface CreateProductDTO {
  name: string;
  sku: string;
  price: number;
  stock: number;
}

export const STOCK_LAUNCH_WARNING = 'Produto criado no ERP, mas falha ao lançar estoque inicial';

export class ErpRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpRejectedError';
  }
}

export const ERP_POST_TIMEOUT_MESSAGE =
  'O Bling não confirmou a tempo. A criação não foi repetida. Verifique no Bling se o produto foi cadastrado.';

export class ErpPostTimeoutError extends Error {
  constructor(message = ERP_POST_TIMEOUT_MESSAGE) {
    super(message);
    this.name = 'BlingPostTimeoutError';
  }
}

export class SkuAlreadyInErpError extends Error {
  constructor(sku: string, readonly erpId: string | null = null) {
    super(
      erpId
        ? `O SKU ${sku} já existe no Bling. O HUB vai recuperar o cadastro ${erpId}.`
        : `O SKU ${sku} já existe no Bling. A criação foi cancelada. Verifique o cadastro no ERP.`
    );
    this.name = 'SkuAlreadyInBlingError';
  }
}

/** Contrato do ERP soberano. Bling é a implementação atual; outro ERP entra como nova classe. */
export interface ErpConnector {
  readonly id: string;
  syncProduct(productId: string): Promise<ErpProductSnapshot>;
  getStock(productId: string): Promise<ErpStockSnapshot>;
  getPrice(productId: string): Promise<ErpPriceSnapshot>;
  listCatalogPage(page: number, pageSize: number): Promise<ErpCatalogPage>;
  pullCatalogProduct(externalId: string): Promise<unknown | null>;
  readCommerce?(externalId: string): Promise<ErpCommerceSnapshot | null>;
  fetchProductEnrichmentData(erpId: string): Promise<{ images: string[]; ncm: string; category: string }>;
  pullStockBalances?(externalIds: string[]): Promise<ErpStockBalance[]>;
  listChildIds?(parentId: string): Promise<string[]>;
  createProduct(productData: CreateProductDTO): Promise<{ erp_id: string; stockWarning: string | null }>;
  recordUrl?(erpId: string): string;
}

export interface ListingDraftAttribute {
  id: string;
  value_name: string;
  /**
   * Nome do eixo na Nuvemshop. A API 2025-03 recebe `attributes: [{ pt: nome }]`;
   * `value_name` continua sendo o valor para o Mercado Livre.
   */
  name?: string | null;
}

export interface ListingDraftVariant {
  sku: string;
  price: number;
  stock: number;
  /** Valores na mesma ordem de `ListingDraft.attributes`. */
  values: string[];
}

export interface ListingDraft {
  sku: string;
  title?: string | null;
  price: number;
  stock: number;
  attributes: ListingDraftAttribute[];
  description?: string | null;
  brand?: string | null;
  categoryIds?: number[];
  variants?: ListingDraftVariant[];
  /** URLs públicas na ordem de envio; a capa vem primeiro. */
  images?: string[];
}

export interface ListingResult {
  performed: boolean;
  reason: string;
  externalId?: string;
}

export interface StockUpdate {
  externalId: string;
  quantity: number;
}

export interface StockUpdateResult {
  performed: false;
  reason: 'estoque_na_integracao_nativa' | 'escrita_ao_vivo_desligada';
}

export interface IncomingWebhook {
  eventType: string;
  resourceId: string;
}

export interface WebhookReceipt {
  accepted: boolean;
  reason: string;
}

export interface RemoteListing {
  id: string;
  title: string;
  price: number | null;
  status: string;
}

export interface ListingSearchInput {
  sku: string;
  ean: string | null;
  name?: string | null;
}

/** Produto do HUB usado na leitura do anúncio. Preço e estoque vêm do ERP e não são gravados de volta. */
export interface MasterProduct {
  id: string;
  sku: string;
  ean: string | null;
  name?: string | null;
  price: number | null;
  stock: number | null;
}

export interface MarketplaceListing {
  externalId: string;
  title: string;
  price: number | null;
  stock: number | null;
  images: string[];
  status: string;
  sku?: string | null;
  ean?: string | null;
  /** Sinais que acharam este anúncio. Um só não confirma o vínculo. */
  signals?: Array<'sku' | 'ean' | 'title'>;
}

/** Falha de escrita no canal com o status HTTP. O núcleo decide o retry sem conhecer o canal. */
export class ChannelPublishError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ChannelPublishError';
  }
}

/** Só 429 e 5xx voltam para a fila. 400 e o restante encerram o job. */
export function isRetryablePublishError(error: unknown): boolean {
  return error instanceof ChannelPublishError && (error.status === 429 || error.status >= 500);
}

export type ListingBatchReader = (product: MasterProduct) => MarketplaceListing | null;

/** Contrato do marketplace. A publicação do P2 chama estes métodos, não a classe HTTP do canal. */
export interface MarketplaceConnector {
  readonly id: string;
  getCategoryAttributes(channelCategoryId: string): Promise<Array<{ id: string; name: string; required: boolean }>>;
  searchListings(input: ListingSearchInput): Promise<RemoteListing[]>;
  fetchListings(product: MasterProduct): Promise<MarketplaceListing | null>;
  createListing(draft: ListingDraft): Promise<ListingResult>;
  updateStock(update: StockUpdate): Promise<StockUpdateResult>;
  receiveWebhook(event: IncomingWebhook): Promise<WebhookReceipt>;
  /** Draft próprio do canal, lido do modelo do HUB na hora do envio. Sem ele, a fila usa o preview genérico. */
  buildListingDraft?(productId: string): Promise<ListingDraft | null>;
  /** Índice do catálogo do canal carregado de uma vez para a reconciliação. null = usar leitura individual. */
  createBatchReader?(): Promise<ListingBatchReader | null>;
}
