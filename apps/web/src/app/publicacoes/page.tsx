'use client';

import React, { useState } from 'react';
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

type ExecutionStateLabel =
  | 'Na fila'
  | 'Em processamento'
  | 'Aguardando aprovação'
  | 'Concluído'
  | 'Concluído parcialmente'
  | 'Falhou'
  | 'Bloqueado por regra de negócio'
  | 'Cancelado';

interface SafePushAttempt {
  id: string;
  sku: string;
  productName: string;
  channel: 'Mercado Livre' | 'Nuvemshop';
  operationType: 'STOCK_PRICE' | 'CONTENT' | 'CREATE';
  state: ExecutionStateLabel;
  timestamp: string;
  durationMs: number;
  completedSteps: string[];
  pendingOrFailedStep?: string;
  failureReasonPlain?: string;
}

const INITIAL_ATTEMPTS: SafePushAttempt[] = [
  {
    id: 'job-901',
    sku: '13621',
    productName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un.',
    channel: 'Nuvemshop',
    operationType: 'CONTENT',
    state: 'Concluído',
    timestamp: 'Hoje, 16:10',
    durationMs: 420,
    completedSteps: ['product (título/descrição canal)', 'measures (peso/dimensões)', 'images'],
  },
  {
    id: 'job-902',
    sku: 'BOT-34-209R',
    productName: 'BOTOEIRA 34-209R CAIXA ALTA- 9 FUROS (3X3) 22 MM',
    channel: 'Mercado Livre',
    operationType: 'CONTENT',
    state: 'Concluído parcialmente',
    timestamp: 'Hoje, 15:48',
    durationMs: 890,
    completedSteps: ['description'],
    pendingOrFailedStep: 'measures',
    failureReasonPlain:
      'Categoria do anúncio ainda não aceita envio de dimensões via API. Passo de descrição já concluído não será repetido no reprocessamento.',
  },
  {
    id: 'job-903',
    sku: 'Sem SKU (#16719381290)',
    productName: 'CONTATOR AUXILIAR 2NA+2NF',
    channel: 'Mercado Livre',
    operationType: 'CREATE',
    state: 'Bloqueado por regra de negócio',
    timestamp: 'Hoje, 15:30',
    durationMs: 12,
    completedSteps: [],
    pendingOrFailedStep: 'create_listing',
    failureReasonPlain:
      'Bloqueado preventivamente: variante sem EAN válido no Bling. Aprovar EAN na Central de Pendências antes de criar anúncio.',
  },
  {
    id: 'job-904',
    sku: 'Mercurio 400w e40',
    productName: 'Lâmpada Vapor Mercúrio 400w Hpl E40',
    channel: 'Mercado Livre',
    operationType: 'STOCK_PRICE',
    state: 'Aguardando aprovação',
    timestamp: 'Hoje, 15:12',
    durationMs: 5,
    completedSteps: [],
    failureReasonPlain:
      'Ignorado com segurança: responsabilidade de estoque e preço está configurada como integração nativa do Bling (bling_native).',
  },
];

export default function PublicacoesPage() {
  const [simulated, setSimulated] = useState<boolean>(true);
  const [attempts, setAttempts] = useState<SafePushAttempt[]>(INITIAL_ATTEMPTS);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  const handleSafeReprocess = (id: string) => {
    setReconcilingId(id);
    setTimeout(() => {
      setAttempts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                state: 'Concluído',
                completedSteps: [...a.completedSteps, a.pendingOrFailedStep ?? 'measures'],
                pendingOrFailedStep: undefined,
                failureReasonPlain:
                  'Reconciliado com verificação prévia do estado remoto (sem duplicar passos já concluídos).',
              }
            : a
        )
      );
      setReconcilingId(null);
    }, 600);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Send className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Simulador de Sincronização &amp; Reprocessamento Seguro
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Simule o impacto antes de escrever nos canais e reprocesse falhas parciais consultando o estado remoto (sem repetir passos já concluídos).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSimulated(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Play className="h-4 w-4" />
          <span>Executar Simulação (Dry-Run sem escrita externa)</span>
        </button>
      </header>

      {/* 5.3 Simulador de Sincronização */}
      {simulated && (
        <section className="mt-6 rounded-xl border border-emerald-500/30 bg-zinc-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white">
              Resultado da Simulação Prévia (Estado conhecido neste instante)
            </h2>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold text-emerald-300">
              Nenhuma chamada PUT/POST externa foi disparada
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <span className="text-xs text-zinc-400">Produtos analisados</span>
              <p className="mt-1 text-2xl font-bold text-white">15 SKUs</p>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <span className="text-xs text-emerald-300">Aptos para atualizar conteúdo</span>
              <p className="mt-1 text-2xl font-bold text-emerald-400">1 SKU</p>
              <span className="text-[11px] text-zinc-400">Isolador Epóxi 13621</span>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
              <span className="text-xs text-rose-300">Bloqueados por regra fiscal</span>
              <p className="mt-1 text-2xl font-bold text-rose-400">6 SKUs</p>
              <span className="text-[11px] text-zinc-400">EAN ausente ou NCM pendente</span>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <span className="text-xs text-amber-300">Ignorados por integração nativa</span>
              <p className="mt-1 text-2xl font-bold text-amber-400">15 SKUs (Estoque/Preço)</p>
              <span className="text-[11px] text-zinc-400">Dono atual: bling_native</span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2 text-xs">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                <span>Campos protegidos que permanecerão inalterados no Bling</span>
              </div>
              <p className="mt-1.5 text-zinc-300">
                Preço de cadastro, preço de loja, custo, estoque físico/virtual, composição de kit, SKU, NCM, CEST, origem fiscal, nome mestre e descrição mestre do Bling.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <Lock className="h-4 w-4" />
                <span>Proteção contra conflito com Integração Nativa e Full</span>
              </div>
              <p className="mt-1.5 text-zinc-300">
                Como <code className="text-zinc-200">stock_price = bling_native</code>, o HUB não escreverá estoque nem preço. Anúncios Full (<code className="text-zinc-200">meli_facility</code>) também ficam sempre isentos de escrita de quantidade.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 5.6 Fila de Tentativas e Reprocessamento Seguro */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-base font-bold text-white">
          Histórico de Tentativas e Reprocessamento Seguro por Passo
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          O HUB nunca repete cegamente uma operação após timeout: verifica o estado remoto e reexecuta apenas o passo que falhou.
        </p>

        <div className="mt-4 space-y-3">
          {attempts.map((att) => (
            <div
              key={att.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4"
            >
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-emerald-400">
                      #{att.id}
                    </span>
                    <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-medium text-white">
                      {att.channel} · {att.operationType}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold ${
                        att.state === 'Concluído'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : att.state === 'Bloqueado por regra de negócio'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      {att.state === 'Concluído' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {att.state}
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Clock className="h-3 w-3" /> {att.timestamp} ({att.durationMs} ms)
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-white">
                    {att.productName}{' '}
                    <span className="font-mono text-xs text-zinc-400">
                      (SKU: {att.sku})
                    </span>
                  </p>

                  {att.completedSteps.length > 0 && (
                    <p className="text-xs text-emerald-300">
                      Passos já confirmados (não serão repetidos):{' '}
                      <strong>{att.completedSteps.join(' → ')}</strong>
                    </p>
                  )}

                  {att.failureReasonPlain && (
                    <p className="text-xs text-zinc-300">
                      {att.failureReasonPlain}
                    </p>
                  )}
                </div>

                {att.state === 'Concluído parcialmente' && (
                  <button
                    type="button"
                    disabled={reconcilingId === att.id}
                    onClick={() => handleSafeReprocess(att.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
                  >
                    <RotateCcw
                      className={`h-3.5 w-3.5 ${
                        reconcilingId === att.id ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {reconcilingId === att.id
                        ? 'Verificando estado remoto...'
                        : `Reconciliar e reprocessar passo (${att.pendingOrFailedStep})`}
                    </span>
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
