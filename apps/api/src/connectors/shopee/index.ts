import crypto from 'node:crypto';
import { isOrderOrInvoiceEvent } from '../strategy/catalog-mode.js';
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
} from '../strategy/types.js';

/** Host de produção da Open Platform v2. O sandbox entra por SHOPEE_HOST. */
export const SHOPEE_HOST = 'https://partner.shopeemobile.com';
export const ATTRIBUTE_TREE_PATH = '/api/v2/product/get_attribute_tree';
export const ADD_ITEM_PATH = '/api/v2/product/add_item';
export const AUTH_PARTNER_PATH = '/api/v2/shop/auth_partner';

export interface ShopeeCredentials {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
  host?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

interface AttributeNode {
  attribute_id?: number;
  name?: string;
  display_attribute_name?: string;
  mandatory?: boolean;
  is_mandatory?: boolean;
  attribute_value_list?: Array<{ child_attribute_list?: AttributeNode[] }>;
}

interface ShopeeEnvelope {
  error?: string;
  message?: string;
  response?: unknown;
}

/** Campos que o add_item exige e o rascunho genérico do HUB não carrega. */
interface ShopeeListingFields {
  itemName?: string;
  categoryId?: number | string;
  description?: string;
  weightKg?: number;
  imageIds?: string[];
  logisticId?: number;
}

const PUSH_EVENT: Record<number, string> = {
  1: 'shop_authorization',
  2: 'shop_authorization_canceled',
  3: 'order_status',
  4: 'order_tracking',
  5: 'shopee_updates',
  6: 'banned_item',
  7: 'item_promotion',
  12: 'authorization_expiry',
  15: 'order_shipping_document',
};

export function signShopee(partnerKey: string, base: string): string {
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex');
}

/** Shop API: partner_id + path + timestamp + access_token + shop_id, sem separador. */
export function shopBaseString(input: {
  partnerId: string;
  path: string;
  timestamp: number;
  accessToken: string;
  shopId: string;
}): string {
  return `${input.partnerId}${input.path}${input.timestamp}${input.accessToken}${input.shopId}`;
}

/** Public API do OAuth: partner_id + /api/v2/shop/auth_partner + timestamp. */
export function buildAuthorizationUrl(input: {
  partnerId: string;
  partnerKey: string;
  redirect: string;
  timestamp: number;
  host?: string;
}): string {
  const sign = signShopee(input.partnerKey, `${input.partnerId}${AUTH_PARTNER_PATH}${input.timestamp}`);
  const host = (input.host ?? SHOPEE_HOST).replace(/\/$/, '');
  const url = new URL(`${host}${AUTH_PARTNER_PATH}`);
  url.searchParams.set('partner_id', input.partnerId);
  url.searchParams.set('timestamp', String(input.timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('redirect', input.redirect);
  return url.toString();
}

/** Push Mechanism da Open Platform. Pedido entra com eventType que o modo catálogo recusa. */
export function parseWebhook(body: unknown): IncomingWebhook {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('shopee_push_invalid');
  }
  const record = body as { code?: unknown; shop_id?: unknown; data?: unknown };
  if (typeof record.code !== 'number') throw new Error('shopee_push_invalid');
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {};
  const resource = data.item_id ?? data.order_sn ?? data.ordersn ?? record.shop_id ?? '';
  return {
    eventType: PUSH_EVENT[record.code] ?? `shopee_push_${record.code}`,
    resourceId: String(resource),
  };
}

function credentialsFromEnv(): ShopeeCredentials {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID ?? '',
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? '',
    accessToken: process.env.SHOPEE_ACCESS_TOKEN ?? '',
    shopId: process.env.SHOPEE_SHOP_ID ?? '',
    host: process.env.SHOPEE_HOST,
  };
}

function flattenAttributes(nodes: AttributeNode[]): Array<{ id: string; name: string; required: boolean }> {
  const found: Array<{ id: string; name: string; required: boolean }> = [];
  const walk = (node: AttributeNode) => {
    if (node.attribute_id != null) {
      found.push({
        id: String(node.attribute_id),
        name: node.name || node.display_attribute_name || String(node.attribute_id),
        required: node.mandatory === true || node.is_mandatory === true,
      });
    }
    for (const value of node.attribute_value_list ?? []) {
      for (const child of value.child_attribute_list ?? []) walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return found;
}

function readAttributes(response: unknown): Array<{ id: string; name: string; required: boolean }> {
  const record = response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const list = Array.isArray(record.list) ? record.list : [];
  const first = list[0] && typeof list[0] === 'object' ? (list[0] as Record<string, unknown>) : record;
  const tree = Array.isArray(first.attribute_tree)
    ? first.attribute_tree
    : Array.isArray(record.attribute_list)
      ? record.attribute_list
      : [];
  return flattenAttributes(tree as AttributeNode[]);
}

export class ShopeeConnector implements MarketplaceConnector {
  readonly id = 'shopee';

  constructor(private readonly config: ShopeeCredentials | null = null) {}

  async getCategoryAttributes(channelCategoryId: string): Promise<Array<{ id: string; name: string; required: boolean }>> {
    const response = await this.call(ATTRIBUTE_TREE_PATH, 'GET', {
      category_id_list: channelCategoryId,
      language: 'pt-BR',
    });
    return readAttributes(response);
  }

  async searchListings(_input: ListingSearchInput): Promise<RemoteListing[]> {
    return [];
  }

  async fetchListings(_product: MasterProduct): Promise<MarketplaceListing | null> {
    return null;
  }

  async createListing(draft: ListingDraft): Promise<ListingResult> {
    if (process.env.ENABLE_LIVE_PUBLISHING !== 'true') {
      return { performed: false, reason: 'escrita_ao_vivo_desligada' };
    }
    const fields = draft as ListingDraft & ShopeeListingFields;
    if (
      !fields.itemName ||
      fields.categoryId == null ||
      !fields.description ||
      fields.weightKg == null ||
      !fields.imageIds?.length ||
      fields.logisticId == null
    ) {
      throw new Error('shopee_listing_incomplete');
    }
    const response = await this.call(ADD_ITEM_PATH, 'POST', {}, {
      item_name: fields.itemName,
      description: fields.description,
      item_sku: draft.sku,
      category_id: Number(fields.categoryId),
      original_price: draft.price,
      weight: fields.weightKg,
      image: { image_id_list: fields.imageIds },
      logistic_info: [{ logistic_id: fields.logisticId, enabled: true }],
      seller_stock: [{ stock: draft.stock }],
      attribute_list: draft.attributes.map((attribute) => ({
        attribute_id: Number(attribute.id),
        attribute_value_list: [{ value_id: 0, original_value_name: attribute.value_name }],
      })),
    }) as { item_id?: number };
    if (response.item_id == null) throw new Error('shopee_api:missing_item_id');
    return { performed: true, reason: 'publicado', externalId: String(response.item_id) };
  }

  async updateStock(_update: StockUpdate): Promise<StockUpdateResult> {
    return { performed: false, reason: 'estoque_na_integracao_nativa' };
  }

  async receiveWebhook(event: IncomingWebhook): Promise<WebhookReceipt> {
    if (isOrderOrInvoiceEvent(event.eventType)) {
      return { accepted: false, reason: 'modo_catalogo' };
    }
    return { accepted: true, reason: 'evento_de_catalogo' };
  }

  private credentials(): ShopeeCredentials {
    const config = this.config ?? credentialsFromEnv();
    if (!config.partnerId || !config.partnerKey || !config.accessToken || !config.shopId) {
      throw new ConnectorNotInstalledError(this.id);
    }
    return config;
  }

  private async call(path: string, method: 'GET' | 'POST', query: Record<string, string>, body?: unknown): Promise<unknown> {
    const config = this.credentials();
    const timestamp = config.now?.() ?? Math.floor(Date.now() / 1000);
    const sign = signShopee(config.partnerKey, shopBaseString({
      partnerId: config.partnerId,
      path,
      timestamp,
      accessToken: config.accessToken,
      shopId: config.shopId,
    }));
    const host = (config.host ?? SHOPEE_HOST).replace(/\/$/, '');
    const url = new URL(`${host}${path}`);
    url.searchParams.set('partner_id', config.partnerId);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    url.searchParams.set('access_token', config.accessToken);
    url.searchParams.set('shop_id', config.shopId);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const fetchImpl = config.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as ShopeeEnvelope;
    if (!response.ok || (payload.error != null && payload.error !== '')) {
      throw new Error(`shopee_api:${payload.error || response.status}:${payload.message ?? ''}`);
    }
    return payload.response ?? {};
  }
}
