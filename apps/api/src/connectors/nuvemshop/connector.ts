import { lookupChannelAttributeSpecs } from '../../catalog/channel-attributes.js';
import { receiveCatalogWebhook, refuseStock } from '../strategy/catalog-mode.js';
import {
  IncomingWebhook,
  ListingBatchReader,
  ListingDraft,
  ListingResult,
  MarketplaceConnector,
  MarketplaceListing,
  MasterProduct,
  RemoteListing,
  StockUpdate,
  StockUpdateResult,
  WebhookReceipt,
} from '../strategy/types.js';
import { buildNuvemshopDraft } from './nuvemshop-draft.js';
import { createNuvemshopBatchReader, fetchNuvemshopListing } from './nuvemshop-listing.js';
import { createNuvemshopListing } from './nuvemshop-publish.js';

export class NuvemshopMarketplaceConnector implements MarketplaceConnector {
  readonly id = 'nuvemshop';

  async getCategoryAttributes(channelCategoryId: string) {
    return lookupChannelAttributeSpecs('nuvemshop', channelCategoryId).attributes;
  }

  async searchListings(): Promise<RemoteListing[]> {
    return [];
  }

  async fetchListings(product: MasterProduct): Promise<MarketplaceListing | null> {
    if (process.env.VITEST === 'true') return null;
    return fetchNuvemshopListing(product);
  }

  async createListing(draft: ListingDraft): Promise<ListingResult> {
    return createNuvemshopListing(draft);
  }

  async updateStock(update: StockUpdate): Promise<StockUpdateResult> {
    return refuseStock(update);
  }

  async receiveWebhook(event: IncomingWebhook): Promise<WebhookReceipt> {
    return receiveCatalogWebhook(event);
  }

  async buildListingDraft(productId: string): Promise<ListingDraft | null> {
    return buildNuvemshopDraft(productId);
  }

  async createBatchReader(): Promise<ListingBatchReader | null> {
    return createNuvemshopBatchReader();
  }
}
