'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Loader2, Play, RotateCcw, Shield } from 'lucide-react';
import { apiFetch, ApiError } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { classifyPublication, fiscalQueue, SovereigntyLock, StatusBadge } from '../../components/publications/status-badge';

interface PushAttempt {
  id: string;
  sku: string;
  productName: string;
  channel: string;
  operationType: string;
  state: string;
  attempts: number;
  createdAt: string;
  durationMs: number | null;
  completedSteps: string[];
  skippedSteps: string[];
  failedStep: string | null;
  failureReason: string | null;
}

interface PushAttemptsPayload {
  replayEnabled: boolean;
  replayDisabledReason: string;
  attempts: PushAttempt[];
}

interface PlannedDiff {
  productId: string;
  erpId: string;
  sku: string;
  name: string;
  stockPriceAction: string;
  contentAction: string;
}

interface SimulationResult {
  simulatedAt: string;
  externalWritesPerformed: number;
  summary: {
    totalProductsAnalyzed: number;
    aptToPublishContent: number;
    blockedByFiscalRule: number;
    awaitingContentOrCategory: number;
    ignoredStockPriceByNativeOwner: number;
    excludedEmptySku: number;
  };
  protectedBlingFields: string[];
  plannedProductDiffs: PlannedDiff[];
}

export default function PublicacoesPage() {
  const { hasPermission } = useCurrentRole();
  const canSimulate = hasPermission('push:simulate');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [runningSim, setRunningSim] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [push, setPush] = useState<PushAttemptsPayload | null>(null);

  const runDryRunSimulation = async () => {
    setRunningSim(true);
    setSimError(null);
    try {
      setSimResult(await apiFetch<SimulationResult>('/api/dashboard/simulate-sync', { method: 'POST' }));
    } catch (err) {
      setSimError(
        err instanceof ApiError && err.status === 403
          ? 'Seu papel não pode executar a simulação.'
          : 'Não foi possível executar a simulação.'
      );
    } finally {
      setRunningSim(false);
    }
  };

  useEffect(() => {
    void runDryRunSimulation();
    void apiFetch<PushAttemptsPayload>('/api/dashboard/push-attempts').then(setPush).catch(() => setPush(null));
  }, []);

  const simulateOne = async (productId: string) => {
    setNotice(null);
    try {
      const channel = MERCADO_LIVRE_ACTIVE ? 'mercadolivre' : 'nuvemshop';
      await apiFetch(`/api/catalog/${productId}/simulate?channel=${channel}`, { method: 'POST' });
      setNotice('Simulação deste produto concluída. Nenhuma escrita saiu para a loja.');
    } catch {
      setNotice('Não foi possível simular o envio deste produto.');
    }
  };

  const summary = simResult?.summary;
  const totalLabel = summary?.totalProductsAnalyzed.toLocaleString('pt-BR') ?? '…';
  const funnel = [
    { label: 'Total no catálogo', value: summary?.totalProductsAnalyzed, className: 'border-border-color bg-bg-surface', valueClass: 'text-text-primary' },
    { label: 'Em análise / aguardando', value: summary?.awaitingContentOrCategory, className: 'border-sky-500/40 bg-sky-500/10', valueClass: 'text-sky-800 dark:text-sky-100' },
    { label: 'Prontos para envio (Shadow)', value: summary?.aptToPublishContent, className: 'border-emerald-500/40 bg-emerald-500/10', valueClass: 'text-emerald-800 dark:text-emerald-100' },
    { label: 'Bloqueados por regra', value: summary?.blockedByFiscalRule, className: 'border-rose-500/40 bg-rose-500/10', valueClass: 'text-rose-800 dark:text-rose-100', tip: 'Produtos bloqueados não serão enviados. Corrija as pendências na aba Fiscal.' },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-50">
        <Shield className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Modo Shadow ativo: o HUB está calculando o que seria enviado, mas não fará escrita real na Nuvemshop. Preço e estoque estão sendo gerenciados pela integração nativa do Bling e não serão enviados.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setShowTechnical((current) => !current)}>
            {showTechnical ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
          </button>
        </p>
      </div>
      {showTechnical && (
        <ul className="mt-2 list-disc rounded-xl border border-border-color bg-bg-surface px-8 py-3 text-xs text-text-muted">
          {(simResult?.protectedBlingFields ?? ['Preço, estoque, SKU e dados fiscais do Bling']).map((field) => <li key={field}>{field}</li>)}
        </ul>
      )}

      <header className="mt-6 flex flex-col justify-between gap-4 border-b border-border-color pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Pipeline de distribuição</h1>
          <p className="mt-1 text-sm text-text-muted">O que está pronto, o que espera enriquecimento e o que a regra fiscal segura.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button
            type="button"
            onClick={() => void runDryRunSimulation()}
            disabled={runningSim || !canSimulate}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {runningSim ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {runningSim ? `Simulando ${totalLabel} produtos...` : 'Re-executar simulação'}
          </button>
          {simResult && (
            <p className="text-[11px] text-text-muted">
              Última simulação: {new Date(simResult.simulatedAt).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
      </header>

      {simError && <p role="alert" className="mt-4 text-sm text-rose-600">{simError}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-text-muted">{notice}</p>}
      {summary && summary.excludedEmptySku > 0 && (
        <p className="mt-4 text-sm text-text-muted">{summary.excludedEmptySku.toLocaleString('pt-BR')} produtos sem SKU ficaram fora do envio.</p>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {funnel.map((card) => (
          <article key={card.label} className={`rounded-xl border p-4 ${card.className}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`text-2xl font-bold tabular-nums ${card.valueClass}`}>{(card.value ?? 0).toLocaleString('pt-BR')}</p>
              {card.tip && (
                <span title={card.tip} className="text-rose-700 dark:text-rose-200">
                  <HelpCircle className="h-4 w-4" aria-label={card.tip} />
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-text-muted">{card.label}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="px-4 py-3 text-left text-xs text-text-muted">Amostra dos produtos analisados nesta simulação.</caption>
          <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
            <tr className="h-10">
              <th className="px-4 font-semibold">Produto / SKU</th>
              <th className="px-3 font-semibold">Status</th>
              <th className="px-4 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(simResult?.plannedProductDiffs ?? []).map((diff) => {
              const tone = classifyPublication(diff.stockPriceAction, diff.contentAction);
              return (
                <tr key={diff.erpId} className="border-b border-border-color">
                  <td className="px-4 py-3">
                    <p className="max-w-xs truncate font-medium text-text-primary" title={diff.name}>{diff.name}</p>
                    <p className="font-mono text-[11px] text-text-muted">{diff.sku || 'Sem SKU'}</p>
                  </td>
                  <td className="px-3 py-3"><StatusBadge tone={tone} /></td>
                  <td className="px-4 py-3 text-right">
                    {tone === 'ready' && canSimulate && (
                      <button type="button" onClick={() => void simulateOne(diff.productId)} className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">
                        <Play className="h-3.5 w-3.5" />
                        Simular envio
                      </button>
                    )}
                    {tone === 'fiscal' && (
                      <Link href={`/fiscal?aba=${fiscalQueue(diff.contentAction)}&q=${encodeURIComponent(diff.sku)}`} className="text-xs font-semibold underline">
                        Corrigir no HUB
                      </Link>
                    )}
                    {tone !== 'ready' && tone !== 'fiscal' && <SovereigntyLock />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {push && push.attempts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-text-primary">Tentativas já registradas</h2>
          <ul className="mt-3 space-y-2">
            {push.attempts.map((attempt) => (
              <li key={attempt.id} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-xs">
                <p className="font-medium text-text-primary">{attempt.productName} · {attempt.sku}</p>
                <p className="mt-1 text-text-muted">{attempt.state} · {attempt.channel} · {new Date(attempt.createdAt).toLocaleString('pt-BR')}</p>
                {attempt.failureReason && <p className="mt-1 text-text-muted">{attempt.failureReason}</p>}
                {(attempt.state === 'Falhou' || attempt.state === 'Concluído parcialmente') && (
                  <button type="button" disabled={!push.replayEnabled} title={push.replayDisabledReason} className="mt-2 inline-flex items-center gap-1 text-text-muted disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reprocessar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
