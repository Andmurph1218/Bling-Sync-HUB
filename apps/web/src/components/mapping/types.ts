export type MappingPlatform = 'nuvemshop' | 'mercadolivre';
export type FieldType = 'text' | 'number';
export type AttributeValueType = 'text' | 'number' | 'list';

export interface ErpCategoryNode {
  key: string;
  name: string;
  path: string[];
  parentKey: string | null;
  hubCategoryId: string | null;
  productCount: number;
  channelCategoryId: string | null;
  channelCategoryName: string | null;
}

export interface ChannelAttributeDefinition {
  id: string;
  name: string;
  required: boolean;
  recommended: boolean;
  valueType: AttributeValueType;
  values: string[];
}

export interface StudioChannelNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  attributes: ChannelAttributeDefinition[];
}

export interface MappingField {
  code: string;
  label: string;
  type: FieldType;
}

export interface MappingStudio {
  channelTreeSource: 'fixture';
  erp: ErpCategoryNode[];
  channel: StudioChannelNode[];
  fields: MappingField[];
}

export interface ValuePair {
  hubValue: string;
  channelValue: string;
}

export interface AttributeDraft {
  channelAttributeId: string;
  channelAttributeName: string;
  required: boolean;
  recommended: boolean;
  valueType: AttributeValueType;
  values: string[];
  sourceField: string;
  valueMaps: ValuePair[];
}

export function fieldsForAttribute(valueType: AttributeValueType, fields: MappingField[]): MappingField[] {
  const expected: FieldType = valueType === 'number' ? 'number' : 'text';
  return fields.filter((field) => field.type === expected);
}
