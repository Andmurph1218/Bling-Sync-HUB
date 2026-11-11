import { afterEach, describe, expect, it } from 'vitest';
import {
  ADD_ITEM_PATH,
  ATTRIBUTE_TREE_PATH,
  AUTH_PARTNER_PATH,
  buildAuthorizationUrl,
  parseWebhook,
  ShopeeConnector,
  ShopeeCredentials,
  shopBaseString,
  signShopee,
} from '../connectors/shopee/index.js';
import { createMarketplaceConnector } from '../connectors/strategy/factory.js';
import { ConnectorNotInstalledError, ListingDraft } from '../connectors/strategy/types.js';

const CREDS: ShopeeCredentials = {
  partnerId: '10090',
  partnerKey: 'partner-key',
  accessToken: 'token-shop',
  shopId: '14701711',
  host: 'https://partner.test',
  now: () => 1700000000,
};

function mockFetch(payload: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('ShopeeConnector', () => {
  afterEach(() => {
    delete process.env.ENABLE_LIVE_PUBLISHING;
  });

  it('assina a Shop API e lê a árvore de atributos', async () => {
    const { calls, fetchImpl } = mockFetch({
      error: '',
      message: '',
      response: {
        list: [{
          category_id: 100102,
          attribute_tree: [
            { attribute_id: 100134, name: 'Material', mandatory: true, attribute_value_list: [] },
            {
              attribute_id: 100010,
              name: 'Marca',
              mandatory: false,
              attribute_value_list: [{
                value_id: 1,
                name: 'Nike',
                child_attribute_list: [{ attribute_id: 100011, name: 'Linha', mandatory: true }],
              }],
            },
          ],
        }],
      },
    });
    const connector = new ShopeeConnector({ ...CREDS, fetchImpl });
    await expect(connector.getCategoryAttributes('100102')).resolves.toEqual([
      { id: '100134', name: 'Material', required: true },
      { id: '100010', name: 'Marca', required: false },
      { id: '100011', name: 'Linha', required: true },
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.origin).toBe('https://partner.test');
    expect(url.pathname).toBe(ATTRIBUTE_TREE_PATH);
    expect(url.searchParams.get('category_id_list')).toBe('100102');
    expect(url.searchParams.get('language')).toBe('pt-BR');
    expect(url.searchParams.get('partner_id')).toBe(CREDS.partnerId);
    expect(url.searchParams.get('shop_id')).toBe(CREDS.shopId);
    expect(url.searchParams.get('access_token')).toBe(CREDS.accessToken);
    const base = shopBaseString({
      partnerId: CREDS.partnerId,
      path: ATTRIBUTE_TREE_PATH,
      timestamp: 1700000000,
      accessToken: CREDS.accessToken,
      shopId: CREDS.shopId,
    });
    expect(url.searchParams.get('sign')).toBe(signShopee(CREDS.partnerKey, base));
  });

  it('não chama a Shopee enquanto a escrita ao vivo está desligada', async () => {
    const { calls, fetchImpl } = mockFetch({});
    const connector = new ShopeeConnector({ ...CREDS, fetchImpl });
    await expect(connector.createListing({ sku: 'SKU-1', price: 10, stock: 2, attributes: [] })).resolves.toEqual({
      performed: false,
      reason: 'escrita_ao_vivo_desligada',
    });
    expect(calls).toEqual([]);
  });

  it('publica com add_item quando a escrita ao vivo está ligada', async () => {
    process.env.ENABLE_LIVE_PUBLISHING = 'true';
    const { calls, fetchImpl } = mockFetch({ error: '', response: { item_id: 998877 } });
    const connector = new ShopeeConnector({ ...CREDS, fetchImpl });
    const draft = {
      sku: 'SKU-1',
      price: 39.9,
      stock: 4,
      attributes: [{ id: '100134', value_name: 'Algodão' }],
      itemName: 'Camiseta',
      categoryId: 100102,
      description: 'Camiseta de algodão com manga curta.',
      weightKg: 0.2,
      imageIds: ['img-1'],
      logisticId: 5001,
    };
    await expect(connector.createListing(draft as ListingDraft)).resolves.toEqual({
      performed: true,
      reason: 'publicado',
      externalId: '998877',
    });
    expect(calls[0]!.method).toBe('POST');
    expect(new URL(calls[0]!.url).pathname).toBe(ADD_ITEM_PATH);
    expect(JSON.parse(calls[0]!.body ?? '{}')).toEqual({
      item_name: 'Camiseta',
      description: 'Camiseta de algodão com manga curta.',
      item_sku: 'SKU-1',
      category_id: 100102,
      original_price: 39.9,
      weight: 0.2,
      image: { image_id_list: ['img-1'] },
      logistic_info: [{ logistic_id: 5001, enabled: true }],
      seller_stock: [{ stock: 4 }],
      attribute_list: [{
        attribute_id: 100134,
        attribute_value_list: [{ value_id: 0, original_value_name: 'Algodão' }],
      }],
    });
  });

  it('não envia add_item incompleto', async () => {
    process.env.ENABLE_LIVE_PUBLISHING = 'true';
    const { calls, fetchImpl } = mockFetch({});
    const connector = new ShopeeConnector({ ...CREDS, fetchImpl });
    await expect(connector.createListing({ sku: 'SKU-1', price: 10, stock: 1, attributes: [] })).rejects.toThrow(
      'shopee_listing_incomplete'
    );
    expect(calls).toEqual([]);
  });

  it('recusa pedido e aceita alteração de item no push', async () => {
    const connector = new ShopeeConnector(CREDS);
    const order = parseWebhook({ code: 3, shop_id: 10, data: { ordersn: '240101ABC' } });
    expect(order).toEqual({ eventType: 'order_status', resourceId: '240101ABC' });
    await expect(connector.receiveWebhook(order)).resolves.toEqual({ accepted: false, reason: 'modo_catalogo' });
    const item = parseWebhook({ code: 6, shop_id: 10, data: { item_id: 55 } });
    expect(item).toEqual({ eventType: 'banned_item', resourceId: '55' });
    await expect(connector.receiveWebhook(item)).resolves.toEqual({ accepted: true, reason: 'evento_de_catalogo' });
    expect(() => parseWebhook({ shop_id: 1 })).toThrow('shopee_push_invalid');
  });

  it('propaga o erro de negócio da Open Platform', async () => {
    const { fetchImpl } = mockFetch({ error: 'product.error_param', message: 'category invalid' });
    const connector = new ShopeeConnector({ ...CREDS, fetchImpl });
    await expect(connector.getCategoryAttributes('1')).rejects.toThrow('shopee_api:product.error_param:category invalid');
  });

  it('exige credencial antes de ler atributo', async () => {
    const connector = new ShopeeConnector({ partnerId: '', partnerKey: '', accessToken: '', shopId: '' });
    await expect(connector.getCategoryAttributes('1')).rejects.toBeInstanceOf(ConnectorNotInstalledError);
  });

  it('monta a URL de autorização OAuth 2.0', () => {
    const url = new URL(buildAuthorizationUrl({
      partnerId: '10090',
      partnerKey: 'partner-key',
      redirect: 'https://hub.exemplo/oauth/shopee/callback',
      timestamp: 1700000000,
      host: 'https://partner.test',
    }));
    expect(url.pathname).toBe(AUTH_PARTNER_PATH);
    expect(url.searchParams.get('partner_id')).toBe('10090');
    expect(url.searchParams.get('sign')).toBe(signShopee('partner-key', `10090${AUTH_PARTNER_PATH}1700000000`));
    expect(url.searchParams.get('redirect')).toBe('https://hub.exemplo/oauth/shopee/callback');
  });

  it('a fábrica devolve o conector e mantém o estoque no ERP', async () => {
    const connector = createMarketplaceConnector('shopee');
    expect(connector).toBeInstanceOf(ShopeeConnector);
    await expect(connector.updateStock({ externalId: '1', quantity: 3 })).resolves.toEqual({
      performed: false,
      reason: 'estoque_na_integracao_nativa',
    });
  });
});
