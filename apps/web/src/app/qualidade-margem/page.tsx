'use client';

import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Info,
  BarChart3,
} from 'lucide-react';
import { apiFetch } from '../../utils/api-client';

interface MarginItem {
  blingId: string;
  sku: string;
  productName: string;
  salePrice: number;
  costPrice: number | null;
  grossMarginPct: number | null;
  belowCost: boolean;
  stockSeller: number | null;
  scoreBling: number;
  scoreMl: number;
  scoreNs: number;
}

interface AdminIndicator {
  code: string;
  name: string;
  value: string;
  definition: string;
  formula: string;
  source: string;
  period: string;
}

export default function QualidadeMargemPage() {
  const [items, setItems] = useState<MarginItem[]>([]);
  const [indicators, setIndicators] = useState<AdminIndicator[]>([]);
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [mj, ij] = await Promise.all([
          apiFetch<{ items?: MarginItem[] }>('/api/dashboard/margin'),
          apiFetch<{ indicators?: AdminIndicator[] }>('/api/dashboard/admin-indicators'),
        ]);
        setItems(mj.items ?? []);
        setIndicators(ij.indicators ?? []);
        setLiveFromDb(true);
      } catch {
        setLiveFromDb(false);
        setLoadError('Não foi possível carregar margem e indicadores da API local.');
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {loadError && (
        <div role="alert" className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{loadError}</div>
      )}
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Proteção Comercial, Margem &amp; Indicadores Administrativos
            </h1>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                liveFromDb
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {liveFromDb ? 'Dados reais do PostgreSQL 16' : 'Modo demonstração'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Monitora preço contra custo cadastrado no Bling, explica as notas de prontidão e apresenta os 10 Indicadores Administrativos formais.
          </p>
        </div>
      </header>

      {/* Seção 9: Os 10 Indicadores Administrativos com Fórmula, Fonte e Período */}
      {indicators.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              Indicadores Administrativos Conciliados (Seção 9 — Fórmula, Fonte e Período)
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {indicators.map((ind) => (
              <div
                key={ind.code}
                className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs"
              >
                <div>
                  <span className="font-semibold text-zinc-300">{ind.name}</span>
                  <p className="mt-1.5 text-base font-bold text-emerald-400">
                    {ind.value}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-400">{ind.definition}</p>
                </div>
                <div className="mt-3 border-t border-zinc-800/80 pt-2 text-[10px] text-zinc-500">
                  <div>
                    <strong>Fórmula:</strong> {ind.formula}
                  </div>
                  <div>
                    <strong>Fonte:</strong> {ind.source} ({ind.period})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Regra Formal de Cálculo de Margem (Seção 5.5) */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <strong className="text-white">
              Regra de Transparência Financeira (Margem Bruta Simplificada):
            </strong>{' '}
            Como comissões variáveis e frete por venda pertencem ao fechamento do pedido no canal, este painel apresenta a{' '}
            <strong>Margem Bruta Simplificada</strong>{' '}
            <code className="text-emerald-300">((Preço de Venda - Custo Bling) / Preço de Venda × 100)</code>. Custos não preenchidos no Bling são exibidos como{' '}
            <strong className="text-amber-300">Custo ausente</strong> (jamais presumidos como zero).
          </div>
        </div>
      </section>

      {/* Tabela de Proteção Comercial */}
      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3.5">SKU / Produto (Bling)</th>
                <th className="px-4 py-3.5">Preço Venda</th>
                <th className="px-4 py-3.5">Custo Bling</th>
                <th className="px-4 py-3.5">Margem Bruta Simplificada</th>
                <th className="px-4 py-3.5">Saldo Seller</th>
                <th className="px-4 py-3.5">Prontidão (Bling / ML / NS)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {items.map((row) => (
                <tr
                  key={row.blingId}
                  className={
                    row.belowCost
                      ? 'bg-rose-950/20 hover:bg-rose-950/30'
                      : 'hover:bg-zinc-900/80'
                  }
                >
                  <td className="px-4 py-4">
                    <div className="font-mono text-xs font-semibold text-emerald-400">
                      {row.sku}
                    </div>
                    <div className="mt-0.5 text-xs text-white">
                      {row.productName}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs font-bold text-white">
                    R$ {row.salePrice.toFixed(2)}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">
                    {row.costPrice !== null ? (
                      <span className="text-zinc-200">
                        R$ {row.costPrice.toFixed(2)}
                      </span>
                    ) : (
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        Custo ausente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-xs">
                    {row.grossMarginPct === null ? (
                      <span className="text-zinc-400">
                        Cadastrar custo no Bling para calcular
                      </span>
                    ) : row.belowCost ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 font-bold text-rose-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {row.grossMarginPct.toFixed(1)}% (Preço &lt; Custo)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />+
                        {row.grossMarginPct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-zinc-200">
                    {row.stockSeller !== null ? `${row.stockSeller} un.` : '—'}
                  </td>
                  <td className="px-4 py-4 text-xs">
                    <span className="text-zinc-300">
                      Bling: <strong>{row.scoreBling}</strong> · ML:{' '}
                      <strong className={row.scoreMl >= 50 ? 'text-emerald-400' : 'text-amber-300'}>
                        {row.scoreMl}
                      </strong>{' '}
                      · NS:{' '}
                      <strong className={row.scoreNs >= 45 ? 'text-emerald-400' : 'text-amber-300'}>
                        {row.scoreNs}
                      </strong>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
