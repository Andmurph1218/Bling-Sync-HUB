'use client';

import React, { useMemo, useState } from 'react';
import { Download, ExternalLink, HelpCircle } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { EmptySkuNotice, isBlankSku } from '../../components/empty-sku-notice';
import { buildBlingProductUrl } from '../../utils/matching-signals';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';

interface MarginItem {
  erpId: string;
  sku: string;
  skuBlank?: boolean;
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

type QuickFilter = 'todos' | 'sem-custo' | 'negativa' | 'abaixo-15';

const FILTERS: Array<{ id: QuickFilter; label: string }> = [
  { id: 'todos', label: 'Todos os produtos' },
  { id: 'sem-custo', label: 'Sem custo cadastrado' },
  { id: 'negativa', label: 'Margem negativa' },
  { id: 'abaixo-15', label: 'Margem abaixo de 15%' },
];

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function indicator(list: AdminIndicator[], code: string): AdminIndicator | undefined {
  return list.find((item) => item.code === code);
}

function leadingNumber(value: string | undefined): string {
  const match = value?.match(/[\d.,]+/);
  return match?.[0] ?? '0';
}

function syncHeadline(value: string): string {
  const minutes = Number(value.match(/(\d+)\s*min/)?.[1]);
  if (!Number.isFinite(minutes)) return value.replace('Última leitura ', 'Última sync: ');
  if (minutes < 60) return `Última sync: há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Última sync: há ${hours} h`;
  return `Última sync: há ${Math.round(hours / 24)} dias`;
}

function pendingHeadline(value: string | undefined): string {
  const count = Number(value?.match(/^(\d+)/)?.[1] ?? '0');
  return `${count.toLocaleString('pt-BR')} pendências vencidas`;
}

function readiness(item: MarginItem): { label: string; className: string; detail: string } {
  const channelReady = MERCADO_LIVRE_ACTIVE ? item.scoreMl >= 50 || item.scoreNs >= 45 : item.scoreNs >= 45;
  const hasScore = item.scoreBling > 0 || item.scoreMl > 0 || item.scoreNs > 0;
  if (!hasScore) {
    return { label: 'Não vinculado', className: 'bg-bg-base text-text-muted', detail: 'Ainda não há nota de prontidão para este produto.' };
  }
  if (channelReady) {
    return { label: 'Pronto', className: 'bg-emerald-600 text-white', detail: `Nota do canal ativo: ${MERCADO_LIVRE_ACTIVE ? item.scoreMl : item.scoreNs}/100.` };
  }
  return {
    label: 'Bloqueado',
    className: 'bg-rose-600 text-white',
    detail: `Nota Nuvemshop ${item.scoreNs}/100. Publicar exige 45.`,
  };
}

function FormulaTip({ item }: { item?: AdminIndicator }) {
  if (!item) return null;
  return (
    <span className="group relative inline-flex">
      <button type="button" className="rounded-full p-1 text-text-muted" aria-label={`Como calculamos ${item.name}`}>
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-0 top-6 z-20 hidden w-64 rounded-lg border border-border-color bg-bg-base p-2 text-[11px] font-normal leading-relaxed text-text-muted shadow-lg group-hover:block group-focus-within:block">
        {item.definition} Cálculo: {item.formula}. Fonte: {item.source}. Período: {item.period}.
      </span>
    </span>
  );
}

export default function QualidadeMargemPage() {
  const [items, setItems] = useState<MarginItem[]>([]);
  const [indicators, setIndicators] = useState<AdminIndicator[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuickFilter>('todos');
  const [costTip, setCostTip] = useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const [margin, admin] = await Promise.all([
          apiFetch<{ items?: MarginItem[] }>('/api/dashboard/margin'),
          apiFetch<{ indicators?: AdminIndicator[] }>('/api/dashboard/admin-indicators'),
        ]);
        setItems(margin.items ?? []);
        setIndicators(admin.indicators ?? []);
      } catch {
        setLoadError('Não foi possível carregar a saúde do catálogo.');
      }
    })();
  }, []);

  const missingCost = items.filter((item) => item.costPrice === null).length;
  const readyPct = leadingNumber(indicator(indicators, 'prontidao_publicacao')?.value);
  const syncLabel = indicator(indicators, 'atualidade_dados')?.value ?? 'Sem leitura registrada';
  const failures = indicator(indicators, 'falhas_por_canal');
  const expired = indicator(indicators, 'pendencias_vencidas');
  const success = indicator(indicators, 'taxa_sucesso');

  const visible = useMemo(() => items.filter((item) => {
    if (filter === 'sem-custo') return item.costPrice === null;
    if (filter === 'negativa') return item.belowCost;
    if (filter === 'abaixo-15') return item.grossMarginPct !== null && item.grossMarginPct < 15;
    return true;
  }), [items, filter]);

  const exportMissingCost = () => {
    const lines = ['sku;nome;preco;erp_id'];
    for (const item of items.filter((row) => row.costPrice === null)) {
      lines.push([item.sku, item.productName, String(item.salePrice), item.erpId].map((value) => /[;\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join(';'));
    }
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'produtos-sem-custo.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {loadError && <p role="alert" className="mb-4 text-sm text-rose-600">{loadError}</p>}
      <header className="border-b border-border-color pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Saúde do catálogo e margem</h1>
        <p className="mt-1 text-sm text-text-muted">O que coloca a margem em risco e o que ainda impede a publicação.</p>
      </header>

      <section className="mt-6 grid gap-3 lg:grid-cols-4">
        <article className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-200">{missingCost.toLocaleString('pt-BR')} sem custo</p>
            <FormulaTip item={indicator(indicators, 'risco_margem')} />
          </div>
          <p className="mt-1 text-xs text-rose-900/80 dark:text-rose-100/80">Risco de margem negativa. Ação imediata recomendada.</p>
          <button type="button" onClick={exportMissingCost} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white">
            <Download className="h-3.5 w-3.5" />
            Exportar lista para o ERP
          </button>
        </article>
        <article className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-2xl font-bold tabular-nums text-amber-800 dark:text-amber-100">{readyPct}% prontos</p>
            <FormulaTip item={indicator(indicators, 'prontidao_publicacao')} />
          </div>
          <p className="mt-1 text-xs text-amber-950/80 dark:text-amber-50/80">Falta de atributos ou imagens bloqueando publicação.</p>
        </article>
        <article className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold text-sky-900 dark:text-sky-100">{syncHeadline(syncLabel)}</p>
            <FormulaTip item={indicator(indicators, 'atualidade_dados')} />
          </div>
          <p className="mt-1 text-xs text-sky-950/80 dark:text-sky-50/80">{failures?.value ?? '0 falhas'} por canal no período medido.</p>
        </article>
        <article className="rounded-xl border border-border-color bg-bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold text-text-primary">{pendingHeadline(expired?.value)}</p>
            <FormulaTip item={expired} />
          </div>
          <p className="mt-1 text-xs text-text-muted">Taxa de sucesso na resolução: {success?.value ?? '100%'}.</p>
        </article>
      </section>

      <p className="mt-6 flex items-start gap-2 rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-sm text-text-muted">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Como calculamos a margem: (Preço de Venda - Custo) / Preço de Venda. Produtos sem custo no ERP aparecem com margem desconhecida para evitar cálculos falsos.</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === item.id ? 'bg-emerald-700 text-white' : 'border border-border-color text-text-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="mt-4 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
            <tr className="h-10">
              <th className="px-4 font-semibold">SKU / Produto</th>
              <th className="px-3 font-semibold">Preço</th>
              <th className="px-3 font-semibold">Custo</th>
              <th className="px-3 font-semibold">Margem</th>
              <th className="px-3 font-semibold">Estoque</th>
              <th className="px-3 font-semibold">Prontidão</th>
              <th className="px-4 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-text-muted">Nenhum produto neste filtro.</td></tr>
            )}
            {visible.map((row) => {
              const state = readiness(row);
              return (
                <tr key={row.erpId} className={`border-b border-border-color ${row.belowCost ? 'bg-rose-500/5' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-text-muted">{row.skuBlank || isBlankSku(row.sku) ? <EmptySkuNotice /> : row.sku}</p>
                    <p className="max-w-xs truncate text-sm text-text-primary" title={row.productName}>{row.productName}</p>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{money(row.salePrice)}</td>
                  <td className="relative px-3 py-3 font-mono text-xs">
                    {row.costPrice !== null ? money(row.costPrice) : (
                      <button
                        type="button"
                        className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                        onClick={() => setCostTip((current) => (current === row.erpId ? null : row.erpId))}
                      >
                        Custo ausente
                      </button>
                    )}
                    {costTip === row.erpId && (
                      <span className="absolute left-3 top-10 z-10 w-56 rounded-lg border border-border-color bg-bg-base p-2 text-[11px] text-text-muted shadow-lg">
                        Cadastre o custo no Bling para calcular a margem.
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.grossMarginPct === null ? <span className="text-text-muted">Desconhecida</span> : (
                      <span className={row.belowCost || row.grossMarginPct < 15 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-700 dark:text-emerald-300'}>
                        {row.grossMarginPct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">{row.stockSeller !== null ? `${row.stockSeller} un.` : '—'}</td>
                  <td className="px-3 py-3">
                    <span title={state.detail} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.className}`}>{state.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href={buildBlingProductUrl(row.erpId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold underline">
                      Editar no Bling
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
