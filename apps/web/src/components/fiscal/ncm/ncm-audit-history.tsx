'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { formatNcm, NcmHistoryRow } from './types';

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function NcmAuditHistory({ rows }: { rows: NcmHistoryRow[] }) {
  const download = () => {
    const lines = ['data;sku;ncm_anterior;ncm_novo;aprovador_1;aprovador_2;justificativa;decisao'];
    for (const row of rows) {
      lines.push(
        [row.createdAt, row.sku ?? '', formatNcm(row.previous_ncm), formatNcm(row.new_ncm), row.firstReviewerName ?? '', row.secondReviewerName ?? '', row.tipi_note ?? '', row.decision]
          .map(csvCell)
          .join(';')
      );
    }
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'historico-ncm.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold">
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-border-color px-4 py-8 text-center text-sm text-text-muted">Nenhuma decisão de NCM nos últimos 12 meses.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
              <tr className="h-10">
                <th className="px-3 font-semibold">Data/Hora</th>
                <th className="px-2 font-semibold">SKU</th>
                <th className="px-2 font-semibold">NCM anterior</th>
                <th className="px-2 font-semibold">NCM novo</th>
                <th className="px-2 font-semibold">Aprovador 1</th>
                <th className="px-2 font-semibold">Aprovador 2</th>
                <th className="px-3 font-semibold">Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border-color">
                  <td className="px-3 py-3 text-xs tabular-nums text-text-muted">{new Date(row.createdAt).toLocaleString('pt-BR')}</td>
                  <td className="px-2 py-3 font-mono text-xs">{row.sku || '—'}</td>
                  <td className="px-2 py-3 font-mono text-xs">{formatNcm(row.previous_ncm)}</td>
                  <td className="px-2 py-3 font-mono text-xs">{formatNcm(row.new_ncm)}</td>
                  <td className="px-2 py-3 text-xs">{row.firstReviewerName || '—'}</td>
                  <td className="px-2 py-3 text-xs">{row.secondReviewerName || '—'}</td>
                  <td className="max-w-xs truncate px-3 py-3 text-xs" title={row.tipi_note ?? ''}>{row.tipi_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
