'use client';

import React, { useEffect, useState } from 'react';
import {
  Send,
  Play,
  ShieldCheck,
  Lock,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../utils/api-client';

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

interface SimulationResult {
  simulatedAt: string;
  externalWritesPerformed: number;
  summary: {
    totalProductsAnalyzed: number;
    aptToPublishContent: number;
    blockedByFiscalRule: number;
    awaitingContentOrCategory: number;
    ignoredStockPriceByNativeOwner: number;
  };
  syncOwners: Array<{ platform: string; stock_price: string; content: string }>;
  protectedBlingFields: string[];
  plannedProductDiffs: Array<{
    blingId: string;
    sku: string;
    name: string;
    stockPriceAction: string;
    contentAction: string;
  }>;
}

export default function PublicacoesPage() {
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [runningSim, setRunningSim] = useState<boolean>(false);
  const [push, setPush] = useState<PushAttemptsPayload | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const runDryRunSimulation = async () => {
    setRunningSim(true);
    setSimError(null);
    try {
      setSimResult(await apiFetch<SimulationResult>('/api/dashboard/simulate-sync', { method: 'POST' }));
    } catch (err) {
      setSimError(
        err instanceof ApiError && err.status === 403
          ? 'Seu papel não pode executar a simulação (restrita a Operador e Administrador).'
          : 'Não foi possível executar a simulação na API local.'
      );
    } finally {
      setRunningSim(false);
    }
  };

  useEffect(() => {
    void runDryRunSimulation();
    void (async () => {
      try {
        setPush(await apiFetch<PushAttemptsPayload>('/api/dashboard/push-attempts'));
      } catch {
        setPushError('Não foi possível carregar o histórico de publicações.');
      }
    })();
  }, []);

  const s = simResult?.summary;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Send className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Simulador de Sincronização &amp; Histórico de Publicações
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Simule o impacto sobre os produtos reais do banco antes de qualquer escrita nos canais e acompanhe cada tentativa por passo.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runDryRunSimulation()}
          disabled={runningSim}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Play className="h-4 w-4" />
          <span>{runningSim ? 'Calculando simulação...' : 'Recalcular simulação (sem escrita externa)'}</span>
        </button>
      </header>

      {/* 5.3 Simulador de Sincronização */}
      <section className="mt-6 rounded-xl border border-emerald-500/30 bg-zinc-900/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-white">Resultado da simulação (estado conhecido neste instante)</h2>
          {simResult && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold text-emerald-300">
              Escritas externas executadas: {simResult.externalWritesPerformed} · {new Date(simResult.simulatedAt).toLocaleTimeString('pt-BR')}
            </span>
          )}
        </div>

        {simError && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{simError}</div>
        )}
        {!simResult && !simError && <p className="mt-4 text-sm text-zinc-400" role="status">Calculando...</p>}

        {s && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-xs text-zinc-400">Produtos analisados</span>
                <p className="mt-1 text-2xl font-bold text-white">{s.totalProductsAnalyzed}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                <span className="text-xs text-emerald-300">Aptos para atualizar conteúdo</span>
                <p className="mt-1 text-2xl font-bold text-emerald-400">{s.aptToPublishContent}</p>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                <span className="text-xs text-rose-300">Bloqueados por regra fiscal</span>
                <p className="mt-1 text-2xl font-bold text-rose-400">{s.blockedByFiscalRule}</p>
                <span className="text-[11px] text-zinc-400">EAN ausente/inválido ou NCM com risco</span>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <span className="text-xs text-amber-300">Estoque/preço ignorados (integração nativa)</span>
                <p className="mt-1 text-2xl font-bold text-amber-400">{s.ignoredStockPriceByNativeOwner}</p>
                <span className="text-[11px] text-zinc-400">
                  Responsável: {simResult?.syncOwners.map((o) => `${o.platform}=${o.stock_price}`).join(' · ')}
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-4 text-xs lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Campos protegidos que permanecerão inalterados no Bling</span>
                </div>
                <ul className="mt-1.5 list-inside list-disc text-zinc-300">
                  {simResult?.protectedBlingFields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                  <Lock className="h-4 w-4" />
                  <span>Proteção contra conflito com integração nativa e Full</span>
                </div>
                <p className="mt-1.5 text-zinc-300">
                  Enquanto o responsável por estoque e preço for <code className="text-zinc-200">bling_native</code>, o HUB não escreve estoque nem preço. Estoque Full (<code className="text-zinc-200">meli_facility</code>) nunca recebe escrita de quantidade.
                </p>
              </div>
            </div>

            {simResult && simResult.plannedProductDiffs.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Diferenças planejadas por produto</caption>
                  <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-400">
                    <tr>
                      <th scope="col" className="py-2 pr-3">SKU / Produto</th>
                      <th scope="col" className="py-2 px-3">Estoque / Preço</th>
                      <th scope="col" className="py-2 pl-3">Conteúdo / Medidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {simResult.plannedProductDiffs.map((diff) => (
                      <tr key={diff.blingId}>
                        <td className="py-2.5 pr-3">
                          <span className="font-mono font-semibold text-emerald-400">{diff.sku}</span>
                          <div className="text-zinc-300">{diff.name}</div>
                        </td>
                        <td className="py-2.5 px-3 text-amber-300">{diff.stockPriceAction}</td>
                        <td className="py-2.5 pl-3 text-zinc-200">{diff.contentAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* 5.6 Histórico real de tentativas */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-base font-bold text-white">Histórico de tentativas de publicação por passo</h2>
        <p className="mt-1 text-xs text-zinc-400">
          O HUB nunca repete cegamente uma operação após timeout: verifica o estado remoto e reexecuta apenas o passo que falhou.
        </p>

        {push && !push.replayEnabled && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>{push.replayDisabledReason}</span>
          </div>
        )}
        {pushError && (
          <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{pushError}</div>
        )}
        {push && push.attempts.length === 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>Nenhuma tentativa de publicação registrada até agora (o HUB opera em modo shadow).</span>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {push?.attempts.map((att) => (
            <div key={att.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-emerald-400">#{att.id.slice(0, 8)}</span>
                    <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-medium text-white">
                      {att.channel} · {att.operationType}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold ${
                        att.state === 'Concluído'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : att.state === 'Falhou' || att.state === 'Bloqueado por regra de negócio'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      {att.state === 'Concluído' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {att.state}
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Clock className="h-3 w-3" /> {new Date(att.createdAt).toLocaleString('pt-BR')}
                      {att.durationMs !== null ? ` (${att.durationMs} ms)` : ''} · {att.attempts} tentativa(s)
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {att.productName} <span className="font-mono text-xs text-zinc-400">(SKU: {att.sku})</span>
                  </p>
                  {att.completedSteps.length > 0 && (
                    <p className="text-xs text-emerald-300">
                      Passos confirmados (não serão repetidos): <strong>{att.completedSteps.join(' → ')}</strong>
                    </p>
                  )}
                  {att.skippedSteps.length > 0 && (
                    <p className="text-xs text-zinc-400">Passos ignorados: {att.skippedSteps.join(', ')}</p>
                  )}
                  {att.failureReason && (
                    <p className="text-xs text-amber-200">
                      {att.failedStep ? `Passo ${att.failedStep}: ` : ''}{att.failureReason}
                    </p>
                  )}
                </div>

                {(att.state === 'Falhou' || att.state === 'Concluído parcialmente') && (
                  <button
                    type="button"
                    disabled={!push?.replayEnabled}
                    title={push?.replayDisabledReason}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reconciliar e reprocessar {att.failedStep ? `passo ${att.failedStep}` : ''}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
