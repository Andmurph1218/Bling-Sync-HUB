export type ChannelAttributeValueType = 'text' | 'number' | 'list';

export interface ChannelAttributeDefinition {
  id: string;
  name: string;
  required: boolean;
  recommended: boolean;
  valueType: ChannelAttributeValueType;
  values: string[];
}

export interface ChannelCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  attributes: ChannelAttributeDefinition[];
}

const LAMPS: ChannelAttributeDefinition[] = [
  { id: 'brand', name: 'Marca', required: true, recommended: false, valueType: 'text', values: [] },
  { id: 'color', name: 'Cor', required: true, recommended: false, valueType: 'list', values: ['Branco', 'Preto', 'Amarelo', 'Neutro'] },
  { id: 'voltage', name: 'Voltagem', required: true, recommended: false, valueType: 'list', values: ['110V', '220V', 'Bivolt'] },
  { id: 'power', name: 'Potência', required: false, recommended: true, valueType: 'number', values: [] },
];

const ML_LAMPS: ChannelAttributeDefinition[] = [
  { id: 'BRAND', name: 'Marca', required: true, recommended: false, valueType: 'text', values: [] },
  { id: 'COLOR', name: 'Cor', required: true, recommended: false, valueType: 'list', values: ['Branco', 'Preto', 'Amarelo'] },
  { id: 'VOLTAGE', name: 'Voltagem', required: true, recommended: false, valueType: 'list', values: ['110V', '220V', 'Bivolt'] },
  { id: 'LINE', name: 'Linha', required: false, recommended: false, valueType: 'text', values: [] },
];

/**
 * Árvore de exemplo no formato que a API do canal devolve.
 * `ns-cat-lamps` e `MLB999001` continuam sendo as categorias conhecidas pelo leitor de atributos.
 * Trocar esta lista pela resposta real do canal não muda o restante do estúdio.
 */
const TREES: Record<'nuvemshop' | 'mercadolivre', ChannelCategoryNode[]> = {
  nuvemshop: [
    { id: 'ns-casa', parentId: null, name: 'Casa e Construção', attributes: [] },
    { id: 'ns-iluminacao', parentId: 'ns-casa', name: 'Iluminação', attributes: [] },
    { id: 'ns-cat-lamps', parentId: 'ns-iluminacao', name: 'Lâmpadas', attributes: LAMPS },
    {
      id: 'ns-luminarias',
      parentId: 'ns-iluminacao',
      name: 'Luminárias',
      attributes: [
        { id: 'brand', name: 'Marca', required: true, recommended: false, valueType: 'text', values: [] },
        { id: 'color', name: 'Cor', required: false, recommended: true, valueType: 'list', values: ['Branco', 'Preto', 'Madeira'] },
      ],
    },
    { id: 'ns-eletrica', parentId: 'ns-casa', name: 'Materiais Elétricos', attributes: [] },
    {
      id: 'ns-disjuntores',
      parentId: 'ns-eletrica',
      name: 'Disjuntores',
      attributes: [
        { id: 'brand', name: 'Marca', required: true, recommended: false, valueType: 'text', values: [] },
        { id: 'current', name: 'Corrente', required: true, recommended: false, valueType: 'number', values: [] },
        { id: 'curve', name: 'Curva', required: true, recommended: false, valueType: 'list', values: ['B', 'C', 'D'] },
      ],
    },
    { id: 'ns-ferramentas', parentId: null, name: 'Ferramentas', attributes: [] },
  ],
  mercadolivre: [
    { id: 'MLB-casa', parentId: null, name: 'Casa e Construção', attributes: [] },
    { id: 'MLB-iluminacao', parentId: 'MLB-casa', name: 'Iluminação', attributes: [] },
    { id: 'MLB999001', parentId: 'MLB-iluminacao', name: 'Lâmpadas', attributes: ML_LAMPS },
    { id: 'MLB-eletrica', parentId: 'MLB-casa', name: 'Materiais Elétricos', attributes: [] },
  ],
};

export function listChannelCategories(platform: 'nuvemshop' | 'mercadolivre'): ChannelCategoryNode[] {
  return TREES[platform];
}

export function findChannelCategory(
  platform: 'nuvemshop' | 'mercadolivre',
  channelCategoryId: string
): ChannelCategoryNode | null {
  return TREES[platform].find((node) => node.id === channelCategoryId) ?? null;
}

export function channelCategoryPath(platform: 'nuvemshop' | 'mercadolivre', channelCategoryId: string): string {
  const nodes = TREES[platform];
  const names: string[] = [];
  let current = nodes.find((node) => node.id === channelCategoryId) ?? null;
  while (current) {
    names.unshift(current.name);
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) ?? null : null;
  }
  return names.join(' > ');
}
