import { lookupChannelAttributeSpecs } from '../../catalog/channel-attributes.js';
import { fetchMercadoLivreListing, searchMercadoLivreListings } from './ml-listing-search.js';
import { isOrderOrInvoiceEvent } from './catalog-mode.js';
import { fetchNuvemshopListing } from './nuvemshop-listing.js';
import { createNuvemshopListing } from './nuvemshop-publish.js';
import {
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

function refuseListing(_draft: ListingDraft): ListingResult {
  return { performed: false, reason: 'escrita_ao_vivo_desligada' };
}

function refuseStock(_update: StockUpdate): StockUpdateResult {
  return { performed: false, reason: 'estoque_na_integracao_nativa' };
}

function receiveCatalogWebhook(event: IncomingWebhook): WebhookReceipt {
  if (isOrderOrInvoiceEvent(event.eventType)) {
    return { accepted: false, reason: 'modo_catalogo' };
  }
  return { accepted: true, reason: 'evento_de_catalogo' };
}

let listingSearchOverride: ((input: ListingSearchInput) => Promise<RemoteListing[]>) | null = null;

/** Só os testes substituem a consulta ao Mercado Livre. */
export function setListingSearchForTests(
  search: ((input: ListingSearchInput) => Promise<RemoteListing[]>) | null
): void {
  listingSearchOverride = search;
}

export class MercadoLivreMarketplaceConnector implements MarketplaceConnector {
  readonly id = 'mercadolivre';

  async getCategoryAttributes(channelCategoryId: string) {
    return lookupChannelAttributeSpecs('mercadolivre', channelCategoryId).attributes;
  }

  async searchListings(input: ListingSearchInput): Promise<RemoteListing[]> {
    if (listingSearchOverride) return listingSearchOverride(input);
    if (process.env.VITEST === 'true') return [];
    return searchMercadoLivreListings(input);
  }

  async fetchListings(product: MasterProduct): Promise<MarketplaceListing | null> {
    if (listingSearchOverride) {
      const found = await listingSearchOverride({ sku: product.sku, ean: product.ean });
      const active = found.find((item) => item.status.toLowerCase() === 'ativo' || item.status.toLowerCase() === 'active');
      if (!active) return null;
      return {
        externalId: active.id,
        title: active.title,
        price: active.price,
        stock: null,
        images: [],
        status: active.status,
      };
    }
    if (process.env.VITEST === 'true') return null;
    return fetchMercadoLivreListing({ sku: product.sku, ean: product.ean });
  }

  async createListing(draft: ListingDraft): Promise<ListingResult> {
    return refuseListing(draft);
  }

  async updateStock(update: StockUpdate): Promise<StockUpdateResult> {
    return refuseStock(update);
  }

  async receiveWebhook(event: IncomingWebhook): Promise<WebhookReceipt> {
    return receiveCatalogWebhook(event);
  }
}

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
}
