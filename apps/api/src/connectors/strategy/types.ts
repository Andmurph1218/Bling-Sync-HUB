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
  done: boolean;
}

export interface ErpStockBalance {
  externalId: string;
  raw: unknown;
}

/** Contrato do ERP soberano. Bling é a implementação atual; outro ERP entra como nova classe. */
export interface ErpConnector {
  readonly id: string;
  syncProduct(productId: string): Promise<ErpProductSnapshot>;
  getStock(productId: string): Promise<ErpStockSnapshot>;
  getPrice(productId: string): Promise<ErpPriceSnapshot>;
  listCatalogPage(page: number, pageSize: number): Promise<ErpCatalogPage>;
  pullCatalogProduct(externalId: string): Promise<unknown | null>;
  pullStockBalances?(externalIds: string[]): Promise<ErpStockBalance[]>;
  listChildIds?(parentId: string): Promise<string[]>;
}

export interface ListingDraft {
  sku: string;
  price: number;
  stock: number;
  attributes: Array<{ id: string; value_name: string }>;
}

export interface ListingResult {
  performed: false;
  reason: 'escrita_ao_vivo_desligada';
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

/** Contrato do marketplace. A publicação do P2 chama estes métodos, não a classe HTTP do canal. */
export interface MarketplaceConnector {
  readonly id: string;
  getCategoryAttributes(channelCategoryId: string): Promise<Array<{ id: string; name: string; required: boolean }>>;
  createListing(draft: ListingDraft): Promise<ListingResult>;
  updateStock(update: StockUpdate): Promise<StockUpdateResult>;
  receiveWebhook(event: IncomingWebhook): Promise<WebhookReceipt>;
}
