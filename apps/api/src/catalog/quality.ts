import { query } from '../db/pool.js';
import { QUALITY_GAP_SQL, QUALITY_SCOPE_SQL } from './list.js';

export const QUALITY_METRICS = [
  { code: 'sku', label: 'Sem SKU' },
  { code: 'duplicate', label: 'Possível duplicata' },
  { code: 'stock', label: 'Sem leitura de estoque' },
  { code: 'ncm', label: 'Sem NCM válido' },
  { code: 'ean', label: 'Sem EAN' },
  { code: 'dimensions', label: 'Sem peso e dimensões' },
  { code: 'cover', label: 'Sem imagem de capa' },
  { code: 'hub_category', label: 'Sem categoria' },
  { code: 'content', label: 'Sem atributos/descrição' },
] as const;

export type QualityMetricCode = (typeof QUALITY_METRICS)[number]['code'];

export function isQualityMetricCode(value: unknown): value is QualityMetricCode {
  return QUALITY_METRICS.some((metric) => metric.code === value);
}

export async function loadQualitySummary(): Promise<{ total: number; metrics: Record<QualityMetricCode, number> }> {
  const [totalRow, counts] = await Promise.all([
    query<{ count: number }>(`SELECT count(*)::int AS count FROM master_products mp WHERE ${QUALITY_SCOPE_SQL}`),
    Promise.all(
      QUALITY_METRICS.map(async ({ code }) => {
        const row = await query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products mp WHERE ${QUALITY_SCOPE_SQL} AND ${QUALITY_GAP_SQL[code]}`
        );
        return [code, row.rows[0]?.count ?? 0] as const;
      })
    ),
  ]);
  return {
    total: totalRow.rows[0]?.count ?? 0,
    metrics: Object.fromEntries(counts) as Record<QualityMetricCode, number>,
  };
}

function csvCell(value: string | null): string {
  const text = value ?? '';
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function buildQualityCsv(gap?: QualityMetricCode): Promise<string> {
  const metrics = gap ? QUALITY_METRICS.filter((metric) => metric.code === gap) : QUALITY_METRICS;
  const flags = metrics.map((metric, index) => `(${QUALITY_GAP_SQL[metric.code]}) AS gap_${index}`).join(',\n       ');
  const anyGap = metrics.map((metric) => QUALITY_GAP_SQL[metric.code]).join(' OR ');
  const result = await query<Record<string, unknown> & { erp_sku: string | null; erp_id: string; name: string | null }>(
    `SELECT mp.erp_sku, mp.erp_id, mp.name,
       ${flags}
     FROM master_products mp
     WHERE ${QUALITY_SCOPE_SQL} AND (${anyGap})
     ORDER BY mp.erp_sku NULLS FIRST, mp.erp_id`
  );
  const lines = ['sku;erp_id;nome;pendencias'];
  for (const row of result.rows) {
    const missing = metrics.filter((_, index) => row[`gap_${index}`] === true).map((metric) => metric.label);
    lines.push([row.erp_sku, row.erp_id, row.name, missing.join(', ')].map(csvCell).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
