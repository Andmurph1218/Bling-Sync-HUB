import { lookupChannelAttributeSpecs } from '../../catalog/channel-attributes.js';
import { isOrderOrInvoiceEvent } from './catalog-mode.js';
import {
  IncomingWebhook,
  ListingDraft,
  ListingResult,
  MarketplaceConnector,
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

export class MercadoLivreMarketplaceConnector implements MarketplaceConnector {
  readonly id = 'mercadolivre';

  async getCategoryAttributes(channelCategoryId: string) {
    return lookupChannelAttributeSpecs('mercadolivre', channelCategoryId).attributes;
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
