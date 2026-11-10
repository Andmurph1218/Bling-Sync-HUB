'use client';

import React from 'react';
import { Search } from 'lucide-react';

export interface AuditRecord {
  id: string;
  at: string;
  when: string;
  sku: string;
  productName: string;
  motor: string;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  originActor: string;
  result: string;
  table: string;
}

function formatWhen(value: string): string {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return value;
  return when.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function resultTone(result: string): { label: string; className: string } {
  if (/rejeit|fail|erro|falha/i.test(result)) return { label: 'Falha', className: 'bg-rose-600 text-white' };
  if (/simula|shadow/i.test(result)) return { label: 'Simulação', className: 'bg-amber-500 text-amber-950' };
  return { label: 'Sucesso', className: 'bg-emerald-600 text-white' };
}

export function AuditLogTable({
  records,
  onOpen,
}: {
  records: AuditRecord[];
  onOpen: (record: AuditRecord) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
          <tr className="h-10">
            <th className="px-4 font-semibold">Data/Hora</th>
            <th className="px-3 font-semibold">Produto / SKU</th>
            <th className="px-3 font-semibold">Motor</th>
            <th className="px-3 font-semibold">O que mudou</th>
            <th className="px-4 font-semibold">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const tone = resultTone(record.result);
            return (
              <tr key={record.id} className="cursor-pointer border-b border-border-color hover:bg-bg-base/70" onClick={() => onOpen(record)}>
                <td className="px-4 py-3 text-xs tabular-nums text-text-muted">
                  {formatWhen(record.at)}
                </td>
                <td className="px-3 py-3">
                  <p className="max-w-[14rem] truncate font-medium text-text-primary" title={record.productName}>{record.productName || 'Registro do sistema'}</p>
                  <p className="font-mono text-[11px] text-text-muted">{record.sku || '—'}</p>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full border border-border-color px-2 py-0.5 text-[11px] font-semibold">{record.motor}</span>
                </td>
                <td className="px-3 py-3 text-xs">
                  <p className="text-text-muted">{record.whatChanged}</p>
                  <p className="mt-1">
                    <span className="text-text-muted line-through">{record.previousValue}</span>
                    <span className="mx-1 text-text-muted">→</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">{record.newValue}</span>
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.className}`} title={record.result}>{tone.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AuditEmptyState() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border-color bg-bg-surface px-6 py-12 text-center">
      <Search className="h-12 w-12 text-text-muted" />
      <p className="mt-3 text-sm text-text-muted">Nenhuma alteração encontrada para este filtro.</p>
    </div>
  );
}
