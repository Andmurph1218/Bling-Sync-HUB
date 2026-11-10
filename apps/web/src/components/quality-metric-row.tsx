'use client';

import React from 'react';
import { AlertOctagon, Download } from 'lucide-react';

export type QualityTone = 'red' | 'orange' | 'yellow';

const TONE: Record<QualityTone, { bar: string; count: string; track: string }> = {
  red: { bar: 'bg-rose-500', count: 'text-rose-600 dark:text-rose-300', track: 'bg-rose-500/15' },
  orange: { bar: 'bg-orange-500', count: 'text-orange-600 dark:text-orange-300', track: 'bg-orange-500/15' },
  yellow: { bar: 'bg-amber-400', count: 'text-amber-600 dark:text-amber-300', track: 'bg-amber-400/15' },
};

export function QualityMetricRow({
  title,
  value,
  total,
  tone,
  healthyLabel,
  actions,
  onDownload,
}: {
  title: string;
  value: number;
  total: number;
  tone: QualityTone;
  healthyLabel: string;
  actions?: React.ReactNode;
  onDownload?: () => void;
}) {
  const healthy = Math.max(total - value, 0);
  const percent = total === 0 ? 100 : Math.round((healthy / total) * 100);
  const systemic = total > 0 && value >= total;
  const style = TONE[tone];

  return (
    <li className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          {systemic && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white"
              title="Nenhum produto do catálogo passa nesta verificação. Provável falha de integração ou de leitura, não de cadastro."
            >
              <AlertOctagon className="h-3 w-3" aria-hidden="true" />
              Alerta Crítico Sistêmico
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div
            className={`h-2 flex-1 overflow-hidden rounded-full ${style.track}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${title}: ${percent}% em ordem`}
          >
            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-text-muted">{percent}%</span>
        </div>
        <p className="mt-1.5 text-xs text-text-muted">
          <span className="tabular-nums">{healthy.toLocaleString('pt-BR')}</span> de{' '}
          <span className="tabular-nums">{total.toLocaleString('pt-BR')}</span> produtos {healthyLabel}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 lg:w-28 lg:justify-end">
        <span className={`text-2xl font-bold tabular-nums ${value === 0 ? 'text-emerald-600 dark:text-emerald-300' : style.count}`}>
          {value.toLocaleString('pt-BR')}
        </span>
        {onDownload && value > 0 && (
          <button
            type="button"
            onClick={onDownload}
            className="rounded-md p-1.5 text-text-muted hover:bg-bg-base hover:text-text-primary"
            title={`Baixar SKUs: ${title} (CSV)`}
            aria-label={`Baixar SKUs: ${title} (CSV)`}
          >
            <Download className="h-4 w-4" />
          </button>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 lg:w-72 lg:justify-end">{actions}</div>}
    </li>
  );
}
