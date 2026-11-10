export type ErpFieldType = 'text' | 'number';
export type ChannelValueType = 'text' | 'number' | 'list';

export interface MappingField {
  code: string;
  label: string;
  type: ErpFieldType;
}

export function normalizeMappingText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Um campo numérico do ERP não entra num atributo de texto, e o contrário também. Lista fechada aceita texto. */
export function fieldsCompatibleWith(valueType: ChannelValueType, fields: MappingField[]): MappingField[] {
  const expected: ErpFieldType = valueType === 'number' ? 'number' : 'text';
  return fields.filter((field) => field.type === expected);
}

export function suggestCategoryMappings(
  erp: Array<{ key: string; name: string; mapped: boolean }>,
  channel: Array<{ id: string; name: string }>
): Array<{ key: string; channelCategoryId: string; channelCategoryName: string; score: number }> {
  const suggestions = [];
  for (const node of erp) {
    if (node.mapped) continue;
    let best: { id: string; name: string; score: number } | null = null;
    const left = normalizeMappingText(node.name);
    if (!left) continue;
    const leftTokens = new Set(left.split(' ').filter(Boolean));
    for (const candidate of channel) {
      const right = normalizeMappingText(candidate.name);
      if (!right) continue;
      const rightTokens = new Set(right.split(' ').filter(Boolean));
      let shared = 0;
      for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
      const union = leftTokens.size + rightTokens.size - shared;
      const overlap = union === 0 ? 0 : shared / union;
      const contains = left.includes(right) || right.includes(left) ? 0.34 : 0;
      const score = Math.min(1, overlap + contains);
      if (!best || score > best.score) best = { id: candidate.id, name: candidate.name, score };
    }
    if (best && best.score >= 0.6) {
      suggestions.push({
        key: node.key,
        channelCategoryId: best.id,
        channelCategoryName: best.name,
        score: Math.round(best.score * 100) / 100,
      });
    }
  }
  return suggestions;
}

/** Valores iguais ignorando acento, caixa e espaços. "110" não é idêntico a "110V". */
export function sameMappingValue(left: string, right: string): boolean {
  const a = normalizeMappingText(left).replace(/ /g, '');
  const b = normalizeMappingText(right).replace(/ /g, '');
  return a.length > 0 && a === b;
}
