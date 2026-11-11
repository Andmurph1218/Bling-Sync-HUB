'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../utils/api-client';

interface Point {
  day: string;
  scoreNs: number;
  scoreMl: number;
  samples: number;
}

interface Report {
  periodDays: number;
  readiness: { source: string; points: Point[] };
  quality: { source: string; bySource: Array<{ source: string; count: number }> };
}

const PERIODS = [7, 30, 90] as const;

export default function CompletenessReportPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    void apiFetch<Report>(`/api/reports/completeness?days=${days}`)
      .then((payload) => {
        setReport(payload);
        setError(null);
      })
      .catch(() => setError('Não foi possível ler a série de completude.'));
  }, [days]);

  const peak = Math.max(100, ...(report?.readiness.points.map((point) => Math.max(point.scoreNs, point.scoreMl)) ?? [100]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Completude no tempo</h1>
          <p className="mt-1 text-sm text-text-muted">
            Média diária dos scores de canal. Fonte: {report?.readiness.source ?? 'channel_readiness_history'}.
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => setDays(period)}
              aria-pressed={days === period}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${days === period ? 'bg-emerald-700 text-white' : 'border border-border-color text-text-primary'}`}
            >
              {period} dias
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mt-4 text-sm text-rose-600" role="alert">{error}</p>}
      {!report && !error && <p className="mt-6 text-sm text-text-muted">Lendo o período...</p>}

      {report && report.readiness.points.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">Não há score gravado neste período.</p>
      )}

      {report && report.readiness.points.length > 0 && (
        <ul className="mt-6 space-y-3" aria-label="Série de completude">
          {report.readiness.points.map((point) => (
            <li key={point.day}>
              <div className="flex justify-between text-xs text-text-muted">
                <span>{point.day}</span>
                <span>Nuvemshop {point.scoreNs} · Mercado Livre {point.scoreMl} · {point.samples} amostras</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg-base">
                <div className="h-full bg-emerald-600" style={{ width: `${Math.round((point.scoreNs / peak) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 rounded-xl border border-border-color bg-bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Alterações de conteúdo</h2>
        <p className="mt-1 text-xs text-text-muted">Fonte: {report?.quality.source ?? 'quality_history'}.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {(report?.quality.bySource ?? []).length === 0 && <li className="text-text-muted">Nenhuma alteração neste período.</li>}
          {(report?.quality.bySource ?? []).map((row) => (
            <li key={row.source} className="flex justify-between">
              <span>{row.source}</span>
              <span className="tabular-nums text-text-muted">{row.count}</span>
            </li>
          ))}
        </ul>
        <Link href="/completude" className="mt-4 inline-block text-xs font-semibold text-emerald-700">Voltar à qualidade de dados</Link>
      </section>
    </main>
  );
}
