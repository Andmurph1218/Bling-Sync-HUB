/**
 * Fixtures sanitizados da Nuvemshop / Tiendanube (Seção 11 do Plano Mestre):
 * - Produto com variantes e inventory_levels (estoque multi-local)
 * - Webhook product/updated com x-linkedstore-hmac-sha256
 */

export interface NuvemshopLocalizedString {
  pt?: string;
  es?: string;
  en?: string;
}

export interface NuvemshopInventoryLevel {
  id?: string;
  variant_id?: number;
  location_id: string;
  stock: number;
}

export interface NuvemshopVariantPayload {
  id: number;
  product_id: number;
  sku: string | null;
  barcode: string | null;
  price: string;
  promotional_price: string | null;
  cost: string | null;
  stock_management: boolean;
  stock: number | null;
  inventory_levels: NuvemshopInventoryLevel[];
  weight: string | null;
  width: string | null;
  height: string | null;
  depth: string | null;
  values: NuvemshopLocalizedString[];
}

export interface NuvemshopProductPayload {
  id: number;
  name: NuvemshopLocalizedString;
  description: NuvemshopLocalizedString;
  handle: NuvemshopLocalizedString;
  attributes: NuvemshopLocalizedString[];
  published: boolean;
  brand: string | null;
  seo_title: NuvemshopLocalizedString;
  seo_description: NuvemshopLocalizedString;
  tags: string;
  variants: NuvemshopVariantPayload[];
}

export const NS_PRODUCT_WITH_INVENTORY_LEVELS_FIXTURE: NuvemshopProductPayload = {
  id: 991122,
  name: { pt: 'Camiseta Dry Fit Performance' },
  description: {
    pt: '<p>Camiseta esportiva leve em poliamida com secagem rápida para corrida e treino.</p>',
  },
  handle: { pt: 'camiseta-dry-fit-performance' },
  attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }],
  published: true,
  brand: 'MoveFit',
  seo_title: { pt: 'Camiseta Dry Fit Performance MoveFit' },
  seo_description: { pt: 'Compre Camiseta Dry Fit Performance com envio rápido.' },
  tags: 'dry fit, camiseta, treino, corrida',
  variants: [
    {
      id: 55001,
      product_id: 991122,
      sku: 'CAM-DRY-AZ-M',
      barcode: '7891000100011',
      price: '79.90',
      promotional_price: null,
      cost: '35.00',
      stock_management: true,
      stock: 12,
      inventory_levels: [
        {
          location_id: '01GQ2ZHK064BQRHGDB7CCV0Y6N',
          stock: 12,
        },
      ],
      weight: '0.180',
      width: '25.00',
      height: '3.00',
      depth: '30.00',
      values: [{ pt: 'Azul' }, { pt: 'M' }],
    },
    {
      id: 55002,
      product_id: 991122,
      sku: 'CAM-DRY-PT-G',
      barcode: '7891000100028',
      price: '84.90',
      promotional_price: '79.90',
      cost: '36.50',
      stock_management: true,
      stock: 8,
      inventory_levels: [
        {
          location_id: '01GQ2ZHK064BQRHGDB7CCV0Y6N',
          stock: 8,
        },
      ],
      weight: '0.190',
      width: '26.00',
      height: '3.00',
      depth: '32.00',
      values: [{ pt: 'Preto' }, { pt: 'G' }],
    },
  ],
};

export interface NuvemshopWebhookPayload {
  store_id: number;
  event: 'product/created' | 'product/updated' | 'product/deleted';
  id: number;
}

export const NS_WEBHOOK_PRODUCT_UPDATED_FIXTURE: NuvemshopWebhookPayload = {
  store_id: 441100,
  event: 'product/updated',
  id: 991122,
};
