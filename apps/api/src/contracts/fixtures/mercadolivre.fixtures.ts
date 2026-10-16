/**
 * Fixtures sanitizados do Mercado Livre (Seção 11 do Plano Mestre):
 * - Formato Legado (variations)
 * - Formato User Product (family_id, user_product_id, múltiplas condições de venda)
 * - Estoque por local (meli_facility vs seller_warehouse com x-version)
 * - Item legado Full (inventory_id e GET /inventories/{id}/stock/fulfillment)
 * - Notificação de migração UPtin
 */

export interface MlAttributePayload {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  tags?: Record<string, boolean>;
}

export interface MlLegacyVariationPayload {
  id: number;
  price: number;
  available_quantity: number;
  seller_custom_field?: string | null;
  attribute_combinations: MlAttributePayload[];
  attributes?: MlAttributePayload[];
  picture_ids: string[];
  user_product_id?: string | null;
}

export interface MlItemPayload {
  id: string;
  site_id: 'MLB';
  title: string;
  seller_id: number;
  category_id: string;
  price: number;
  currency_id: 'BRL';
  available_quantity: number;
  status: 'active' | 'paused' | 'closed';
  seller_custom_field?: string | null;
  user_product_id?: string | null;
  family_id?: string | null;
  family_name?: string | null;
  inventory_id?: string | null;
  shipping?: {
    mode?: string;
    logistic_type?: 'fulfillment' | 'xd_drop_off' | 'cross_docking' | 'self_service';
  };
  attributes: MlAttributePayload[];
  variations: MlLegacyVariationPayload[];
}

/** 8. Produto com variação no formato legado do Mercado Livre (variations) */
export const ML_LEGACY_VARIATIONS_ITEM_FIXTURE: MlItemPayload = {
  id: 'MLB4010203040',
  site_id: 'MLB',
  title: 'Camiseta Dry Fit Performance Masculina Academia',
  seller_id: 88990011,
  category_id: 'MLB31447',
  price: 79.9,
  currency_id: 'BRL',
  available_quantity: 20,
  status: 'active',
  seller_custom_field: 'CAM-DRY-PAI',
  shipping: {
    mode: 'me2',
    logistic_type: 'xd_drop_off',
  },
  attributes: [
    { id: 'BRAND', name: 'Marca', value_name: 'MoveFit' },
  ],
  variations: [
    {
      id: 18001001,
      price: 79.9,
      available_quantity: 12,
      // Exemplo onde o SKU vem via attributes[SELLER_SKU]
      seller_custom_field: null,
      attribute_combinations: [
        { id: 'COLOR', name: 'Cor', value_name: 'Azul' },
        { id: 'SIZE', name: 'Tamanho', value_name: 'M' },
      ],
      attributes: [
        { id: 'SELLER_SKU', value_name: 'CAM-DRY-AZ-M' },
        { id: 'GTIN', value_name: '7891000100011' },
      ],
      picture_ids: ['700001-MLB1'],
    },
    {
      id: 18001002,
      price: 79.9,
      available_quantity: 8,
      // Exemplo onde o SKU vem em seller_custom_field
      seller_custom_field: 'CAM-DRY-PT-G',
      attribute_combinations: [
        { id: 'COLOR', name: 'Cor', value_name: 'Preto' },
        { id: 'SIZE', name: 'Tamanho', value_name: 'G' },
      ],
      attributes: [
        { id: 'GTIN', value_name: '7891000100028' },
      ],
      picture_ids: ['700002-MLB2'],
    },
  ],
};

/** 9. Família User Product com dois user_product_id e duas condições de venda para o primeiro */
export const ML_USER_PRODUCT_FAMILY_ITEMS_FIXTURE: MlItemPayload[] = [
  // Condição 1 (Clássico) da variante Azul/M (MLBU100001)
  {
    id: 'MLB5000000001',
    site_id: 'MLB',
    title: 'Camiseta Dry Fit Performance Azul M',
    seller_id: 88990011,
    category_id: 'MLB31447',
    price: 79.9,
    currency_id: 'BRL',
    available_quantity: 12,
    status: 'active',
    user_product_id: 'MLBU100001',
    family_id: 'MLBF990011',
    family_name: 'Camiseta Dry Fit Performance',
    shipping: {
      mode: 'me2',
      logistic_type: 'xd_drop_off',
    },
    attributes: [
      { id: 'BRAND', value_name: 'MoveFit', tags: { PARENT_PK: true } },
      { id: 'COLOR', value_name: 'Azul', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SIZE', value_name: 'M', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SELLER_SKU', value_name: 'CAM-DRY-AZ-M' },
      { id: 'GTIN', value_name: '7891000100011' },
    ],
    variations: [],
  },
  // Condição 2 (Premium parcelado sem juros) da MESMA variante Azul/M (MLBU100001)
  {
    id: 'MLB5000000002',
    site_id: 'MLB',
    title: 'Camiseta Dry Fit Performance Azul M',
    seller_id: 88990011,
    category_id: 'MLB31447',
    price: 89.9,
    currency_id: 'BRL',
    available_quantity: 12,
    status: 'active',
    user_product_id: 'MLBU100001',
    family_id: 'MLBF990011',
    family_name: 'Camiseta Dry Fit Performance',
    shipping: {
      mode: 'me2',
      logistic_type: 'xd_drop_off',
    },
    attributes: [
      { id: 'BRAND', value_name: 'MoveFit', tags: { PARENT_PK: true } },
      { id: 'COLOR', value_name: 'Azul', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SIZE', value_name: 'M', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SELLER_SKU', value_name: 'CAM-DRY-AZ-M' },
      { id: 'GTIN', value_name: '7891000100011' },
    ],
    variations: [],
  },
  // Condição 1 da segunda variante Preto/G (MLBU100002)
  {
    id: 'MLB5000000003',
    site_id: 'MLB',
    title: 'Camiseta Dry Fit Performance Preto G',
    seller_id: 88990011,
    category_id: 'MLB31447',
    price: 84.9,
    currency_id: 'BRL',
    available_quantity: 8,
    status: 'active',
    user_product_id: 'MLBU100002',
    family_id: 'MLBF990011',
    family_name: 'Camiseta Dry Fit Performance',
    shipping: {
      mode: 'me2',
      logistic_type: 'xd_drop_off',
    },
    attributes: [
      { id: 'BRAND', value_name: 'MoveFit', tags: { PARENT_PK: true } },
      { id: 'COLOR', value_name: 'Preto', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SIZE', value_name: 'G', tags: { CHILD_PK: true, allow_variations: true } },
      { id: 'SELLER_SKU', value_name: 'CAM-DRY-PT-G' },
      { id: 'GTIN', value_name: '7891000100028' },
    ],
    variations: [],
  },
];

export interface MlUserProductStockResponse {
  headers: {
    'x-version': string;
  };
  body: {
    id: string;
    user_id: number;
    locations: Array<{
      type: 'meli_facility' | 'seller_warehouse' | 'selling_address';
      quantity: number;
      store_id?: string;
      network_node_id?: string;
    }>;
  };
}

/** 10. User Product só com meli_facility */
export const ML_UP_STOCK_ONLY_MELI_FACILITY_FIXTURE: MlUserProductStockResponse = {
  headers: {
    'x-version': '4',
  },
  body: {
    id: 'MLBU206642488',
    user_id: 88990011,
    locations: [
      {
        type: 'meli_facility',
        quantity: 45,
      },
    ],
  },
};

/** 11. User Product com seller_warehouse e meli_facility */
export const ML_UP_STOCK_SELLER_AND_MELI_FACILITY_FIXTURE: MlUserProductStockResponse = {
  headers: {
    'x-version': '11',
  },
  body: {
    id: 'MLBU100001',
    user_id: 88990011,
    locations: [
      {
        type: 'seller_warehouse',
        store_id: 'STORE-SP-01',
        network_node_id: 'NODE-SP-01',
        quantity: 12,
      },
      {
        type: 'meli_facility',
        quantity: 30,
      },
    ],
  },
};

/** 12. Item legado Full com inventory_id e estoque fulfillment */
export const ML_LEGACY_FULL_ITEM_FIXTURE: {
  item: MlItemPayload;
  fulfillmentStock: {
    inventory_id: string;
    total: number;
    available_quantity: number;
    not_available_quantity: number;
  };
} = {
  item: {
    id: 'MLB3999888777',
    site_id: 'MLB',
    title: 'Garrafa Térmica Inox 500ml Preta Parede Dupla',
    seller_id: 88990011,
    category_id: 'MLB1592',
    price: 94.9,
    currency_id: 'BRL',
    available_quantity: 105,
    status: 'active',
    seller_custom_field: 'GAR-INOX-500-PT',
    inventory_id: 'MLBI09182736',
    shipping: {
      mode: 'me2',
      logistic_type: 'fulfillment',
    },
    attributes: [
      { id: 'BRAND', value_name: 'ThermoHub' },
      { id: 'GTIN', value_name: '7891234567895' },
    ],
    variations: [],
  },
  fulfillmentStock: {
    inventory_id: 'MLBI09182736',
    total: 108,
    available_quantity: 105,
    not_available_quantity: 3,
  },
};

/** 13. Notificação de migração UPtin (legado -> User Product) */
export interface MlUptinMigrationNotification {
  topic: 'items' | 'user-products-families';
  resource: string;
  user_id: number;
  migration: {
    old_item_id: string;
    old_variation_id: string;
    new_item_id: string;
    new_user_product_id: string;
    family_id: string;
    family_name: string;
  };
}

export const ML_UPTIN_MIGRATION_WEBHOOK_FIXTURE: MlUptinMigrationNotification = {
  topic: 'user-products-families',
  resource: '/user-products-families/MLBF990011',
  user_id: 88990011,
  migration: {
    old_item_id: 'MLB4010203040',
    old_variation_id: '18001001',
    new_item_id: 'MLB5000000001',
    new_user_product_id: 'MLBU100001',
    family_id: 'MLBF990011',
    family_name: 'Camiseta Dry Fit Performance',
  },
};
