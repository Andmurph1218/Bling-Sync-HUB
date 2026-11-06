export type AttributeMode = 'fixed' | 'dynamic' | 'manual';

export interface AttributeMapInput {
  channelAttributeId: string;
  channelAttributeName: string;
  required: boolean;
  mode: AttributeMode;
  fixedValue: string | null;
  sourceField: string | null;
  valueMaps: Array<{ hubValue: string; channelValue: string }>;
}

export interface MaterializeInput {
  maps: AttributeMapInput[];
  product: { brand: string | null; name: string | null };
  variantAttributes: Record<string, string>;
}

export interface MaterializedAttributes {
  complete: boolean;
  attributes: Array<{ id: string; value_name: string }>;
  missing: string[];
}

export interface ChannelAttributeSpec {
  id: string;
  name: string;
  required: boolean;
}

interface MlCategoryFixture {
  id: string;
  name: string;
  attributes: Array<{ id: string; name: string; tags?: { required?: boolean } }>;
}

interface NsCategoryFixture {
  id: string;
  name: string;
  attributes: Array<{ id: string; name: string; required?: boolean }>;
}

/** Categoria de exemplo no formato de GET /categories/{id} do Mercado Livre. */
export const ML_CATEGORY_ATTRIBUTES_FIXTURE: MlCategoryFixture = {
  id: 'MLB999001',
  name: 'Lâmpadas',
  attributes: [
    { id: 'BRAND', name: 'Marca', tags: { required: true } },
    { id: 'COLOR', name: 'Cor', tags: { required: true } },
    { id: 'LINE', name: 'Linha', tags: { required: false } },
  ],
};

/** Atributos obrigatórios no formato simplificado da categoria da Nuvemshop. */
export const NS_CATEGORY_ATTRIBUTES_FIXTURE: NsCategoryFixture = {
  id: 'ns-cat-lamps',
  name: 'Lâmpadas',
  attributes: [
    { id: 'brand', name: 'Marca', required: true },
    { id: 'color', name: 'Cor', required: true },
  ],
};

export function parseMercadoLivreCategoryAttributes(payload: MlCategoryFixture): ChannelAttributeSpec[] {
  return payload.attributes.map((attribute) => ({
    id: attribute.id,
    name: attribute.name,
    required: attribute.tags?.required === true,
  }));
}

export function parseNuvemshopCategoryAttributes(payload: NsCategoryFixture): ChannelAttributeSpec[] {
  return payload.attributes.map((attribute) => ({
    id: attribute.id,
    name: attribute.name,
    required: attribute.required === true,
  }));
}

export function lookupChannelAttributeSpecs(
  platform: 'mercadolivre' | 'nuvemshop',
  channelCategoryId: string
): { known: boolean; name: string | null; attributes: ChannelAttributeSpec[] } {
  if (platform === 'mercadolivre' && channelCategoryId === ML_CATEGORY_ATTRIBUTES_FIXTURE.id) {
    return {
      known: true,
      name: ML_CATEGORY_ATTRIBUTES_FIXTURE.name,
      attributes: parseMercadoLivreCategoryAttributes(ML_CATEGORY_ATTRIBUTES_FIXTURE),
    };
  }
  if (platform === 'nuvemshop' && channelCategoryId === NS_CATEGORY_ATTRIBUTES_FIXTURE.id) {
    return {
      known: true,
      name: NS_CATEGORY_ATTRIBUTES_FIXTURE.name,
      attributes: parseNuvemshopCategoryAttributes(NS_CATEGORY_ATTRIBUTES_FIXTURE),
    };
  }
  return { known: false, name: null, attributes: [] };
}

export function isAttributeMapResolved(map: AttributeMapInput): boolean {
  if (!map.required) return true;
  if (map.mode === 'fixed') return Boolean(map.fixedValue && map.fixedValue.trim());
  if (map.mode === 'dynamic') return Boolean(map.sourceField && map.sourceField.trim());
  return map.mode === 'manual';
}

/** Verde só quando todo atributo obrigatório tem modo e origem definidos. */
export function isChannelMappingGreen(maps: AttributeMapInput[]): boolean {
  return maps.filter((map) => map.required).every(isAttributeMapResolved);
}

function readSource(
  sourceField: string | null,
  input: MaterializeInput
): string | null {
  if (!sourceField) return null;
  if (sourceField === 'brand') return input.product.brand;
  if (sourceField === 'name') return input.product.name;
  return input.variantAttributes[sourceField] ?? null;
}

/**
 * Monta os atributos do anúncio a partir do mapa da categoria.
 * Campo manual obrigatório impede payload completo: o operador ainda precisaria preencher SKU a SKU.
 */
export function materializeChannelAttributes(input: MaterializeInput): MaterializedAttributes {
  const attributes: Array<{ id: string; value_name: string }> = [];
  const missing: string[] = [];

  for (const map of input.maps) {
    if (map.mode === 'manual') {
      if (map.required) missing.push(map.channelAttributeId);
      continue;
    }
    if (map.mode === 'fixed') {
      const value = map.fixedValue?.trim() ?? '';
      if (!value) {
        if (map.required) missing.push(map.channelAttributeId);
        continue;
      }
      attributes.push({ id: map.channelAttributeId, value_name: value });
      continue;
    }
    const raw = readSource(map.sourceField, input)?.trim() ?? '';
    if (!raw) {
      if (map.required) missing.push(map.channelAttributeId);
      continue;
    }
    const translated = map.valueMaps.find(
      (row) => row.hubValue.trim().toLowerCase() === raw.toLowerCase()
    );
    attributes.push({
      id: map.channelAttributeId,
      value_name: translated?.channelValue ?? raw,
    });
  }

  return { complete: missing.length === 0, attributes, missing };
}
