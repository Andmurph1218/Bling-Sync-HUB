import {
  ConnectorNotInstalledError,
  IncomingWebhook,
  ListingDraft,
  ListingResult,
  ListingSearchInput,
  MarketplaceConnector,
  MarketplaceListing,
  MasterProduct,
  RemoteListing,
  StockUpdate,
  StockUpdateResult,
  WebhookReceipt,
} from './types.js';

/** Canal previsto no catálogo de integrações, ainda sem conector HTTP. */
export class UnavailableMarketplaceConnector implements MarketplaceConnector {
  constructor(readonly id: string) {}

  async getCategoryAttributes(): Promise<never> {
    throw new ConnectorNotInstalledError(this.id);
  }

  async searchListings(_input: ListingSearchInput): Promise<RemoteListing[]> {
    throw new ConnectorNotInstalledError(this.id);
  }

  async fetchListings(_product: MasterProduct): Promise<MarketplaceListing | null> {
    throw new ConnectorNotInstalledError(this.id);
  }

  async createListing(_draft: ListingDraft): Promise<ListingResult> {
    throw new ConnectorNotInstalledError(this.id);
  }

  async updateStock(_update: StockUpdate): Promise<StockUpdateResult> {
    throw new ConnectorNotInstalledError(this.id);
  }

  async receiveWebhook(_event: IncomingWebhook): Promise<WebhookReceipt> {
    throw new ConnectorNotInstalledError(this.id);
  }
}
