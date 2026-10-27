'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Boxes,
  CheckCircle2,
  ClipboardList,
  AlertOctagon,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Activity,
  Info,
  Lock,
} from 'lucide-react';
import {
  fetchOperationalState,
  FALLBACK_OPERATIONAL_STATE,
  OperationalStatePayload,
} from '../utils/operational-state';

export default function HomePage() {
  const [state, setState] = useState<OperationalStatePayload>(
    FALLBACK_OPERATIONAL_STATE
  );
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);

  const loadState = async () => {
    setLoading(true);
    const result = await fetchOperationalState();
    setState(result.data);
    setLiveFromDb(result.liveFromDatabase);
    setLoading(false);
  };

  useEffect(() => {
    void loadState();
  }, []);

  const { kpis, channels, recentWebhooks } = state;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Cabeçalho + Hierarquia 1: Estado Operacional */}
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Centro de Controle Operacional
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                liveFromDb
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  liveFromDb ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {liveFromDb
                ? 'Dados confirmados do PostgreSQL 16'
                : 'Modo demonstração (API local indisponível)'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            O Bling manda. Os marketplaces enriquecem. O HUB valida, coordena e registra.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowTechDetails((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white"
          >
            <Info className="h-3.5 w-3.5 text-zinc-400" />
            <span>{showTechDetails ? 'Ocultar siglas e fontes' : 'Ver fontes e siglas técnicas'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar estado</span>
          </button>
        </div>
      </header>

      {/* Faixa 1 — Estado Operacional e Responsabilidade por Canal */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                1. Estado Operacional: {channels.oauth.length}/3 canais conectados · Modo Simulação (Shadow) ativo
              </h2>
              <p className="text-xs text-zinc-400">
                Estoque e preço permanecem sob responsabilidade da <strong>integração nativa do Bling</strong> (<code className="text-zinc-300">bling_native</code>). O HUB não sobrescreve estoque nem preço de anúncios já publicados.
              </p>
            </div>
          </div>
          <Link
            href="/canais"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <span>Ver regras por canal</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* Hierarquia 2: Impacto no Negócio — 4 Indicadores Principais Clicáveis */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            2. Impacto no Negócio (Clique para abrir a listagem filtrada)
          </h2>
          <span className="text-xs text-zinc-500">
            Calculado em: {new Date(state.calculatedAt).toLocaleTimeString('pt-BR')}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* KPI 1: Produtos Monitorados */}
          <Link
            href={kpis.monitoredProducts.targetHref}
            className="group flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-zinc-600"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Produtos Monitorados
              </span>
              <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-400">
                <Boxes className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">
                  {kpis.monitoredProducts.value}
                </span>
                <span className="text-xs text-zinc-400">
                  ({kpis.monitoredProducts.variantsCount} variações ativas)
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                {kpis.monitoredProducts.definition}
              </p>
              {showTechDetails && (
                <p className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400">
                  Fonte: {kpis.monitoredProducts.source}
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-400 group-hover:underline">
                Abrir catálogo <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>

          {/* KPI 2: Prontos para Publicar */}
          <Link
            href={kpis.readyToPublish.targetHref}
            className="group flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-emerald-500/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Prontos para Publicar
              </span>
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-emerald-400">
                  {kpis.readyToPublish.value}
                </span>
                <span className="text-xs text-zinc-400">
                  de {kpis.readyToPublish.totalEvaluated} avaliados
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                {kpis.readyToPublish.definition}
              </p>
              {showTechDetails && (
                <p className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400">
                  Fonte: {kpis.readyToPublish.source} (Motor CRE)
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 group-hover:underline">
                Ver produtos aptos <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>

          {/* KPI 3: Pendências de Ação */}
          <Link
            href={kpis.actionPendings.targetHref}
            className="group flex flex-col justify-between rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5 transition hover:border-amber-500/60"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Pendências de Ação
              </span>
              <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-400">
                <ClipboardList className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-amber-400">
                  {kpis.actionPendings.value}
                </span>
                <span className="text-xs text-amber-300/90">
                  ({kpis.actionPendings.breakdown.fiscalBlocks} bloqueios fiscais)
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                {kpis.actionPendings.definition}
              </p>
              {showTechDetails && (
                <p className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400">
                  Fonte: {kpis.actionPendings.source}
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-300 group-hover:underline">
                Abrir Central de Pendências <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>

          {/* KPI 4: Falhas de Sincronização */}
          <Link
            href={kpis.syncFailures.targetHref}
            className="group flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-rose-500/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Falhas de Sincronização
              </span>
              <span className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400">
                <AlertOctagon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">
                  {kpis.syncFailures.value}
                </span>
                <span className="text-xs text-zinc-400">
                  operações com falha
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                {kpis.syncFailures.definition}
              </p>
              {showTechDetails && (
                <p className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400">
                  Fonte: {kpis.syncFailures.source} (Motor APE)
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-zinc-300 group-hover:underline">
                Ver fila de publicações <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* Hierarquia 3: Ação Prioritária (Indicador -> Problema -> Impacto -> Ação -> Resultado) */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              3. O Que Precisa da Sua Atenção Agora
            </h2>
            <p className="text-xs text-zinc-400">
              Cada item conecta claramente o problema detectado, o impacto na operação e a ação recomendada (sem exigir conhecimento de siglas).
            </p>
          </div>
          <Link
            href="/pendencias"
            className="text-xs font-semibold text-emerald-400 hover:underline"
          >
            Ver fila única completa &rarr;
          </Link>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* Prioridade 1: Correspondência de Anúncios */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-300">
                  {kpis.actionPendings.breakdown.matchingSuggestions} anúncios aguardando vínculo
                </span>
                <span className="text-xs text-zinc-400">Responsável: Operador</span>
              </div>
              <h3 className="mt-3 text-base font-bold text-white">
                Anúncios do Mercado Livre e Nuvemshop sem vínculo confirmado com o Bling
              </h3>
              <ul className="mt-3 space-y-1.5 text-xs text-zinc-300">
                <li>
                  <strong className="text-zinc-400">Motivo:</strong> Apenas 1 sinal forte coincidiu (ex: nome parecido ou SKU parcial); para vincular sozinho o HUB exige 2 sinais concordantes.
                </li>
                <li>
                  <strong className="text-zinc-400">Impacto:</strong> Enquanto o vínculo não for confirmado, o HUB não envia melhorias de conteúdo para esses anúncios.
                </li>
                {showTechDetails && (
                  <li className="font-mono text-[11px] text-zinc-400">
                    Motor: PIRE / VIR · Tabela: matching_queue
                  </li>
                )}
              </ul>
            </div>
            <Link
              href="/matching"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <span>Comparar candidatos e confirmar vínculo</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Prioridade 2: Bloqueio Fiscal (EAN / NCM) */}
          <div className="flex flex-col justify-between rounded-xl border border-rose-500/30 bg-zinc-900/50 p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                  <Lock className="h-3 w-3" />
                  {kpis.actionPendings.breakdown.fiscalBlocks} produtos com bloqueio fiscal
                </span>
                <span className="text-xs text-zinc-400">Responsável: Fiscal</span>
              </div>
              <h3 className="mt-3 text-base font-bold text-white">
                Código de barras (EAN) ou NCM ausente/divergente bloqueando publicação de conteúdo
              </h3>
              <ul className="mt-3 space-y-1.5 text-xs text-zinc-300">
                <li>
                  <strong className="text-zinc-400">Motivo:</strong> Produtos importados do Bling estão sem EAN válido de 13 dígitos ou aguardam dupla confirmação de NCM.
                </li>
                <li>
                  <strong className="text-zinc-400">Impacto:</strong> Criação de novos anúncios e atualização de conteúdo ficam bloqueadas (estoque e pausa continuam livres).
                </li>
                {showTechDetails && (
                  <li className="font-mono text-[11px] text-zinc-400">
                    Motores: GVE (EAN) + NVE (NCM)
                  </li>
                )}
              </ul>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link
                href="/fiscal/ean"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-xs font-semibold text-white hover:bg-zinc-700"
              >
                <span>Revisar EANs</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/fiscal/ncm"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
              >
                <span>Aprovar NCM (2x)</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Prioridade 3: Qualidade de Conteúdo e Simulação antes de publicar */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  14 produtos com conteúdo incompleto
                </span>
                <span className="text-xs text-zinc-400">Responsável: Operador</span>
              </div>
              <h3 className="mt-3 text-base font-bold text-white">
                Descrições curtas, SEO da Nuvemshop ou categoria do Mercado Livre pendentes
              </h3>
              <ul className="mt-3 space-y-1.5 text-xs text-zinc-300">
                <li>
                  <strong className="text-zinc-400">Motivo:</strong> Faltam tags/meta description para Nuvemshop ou ficha técnica/fotos elegíveis (&ge; 500x500) no Mercado Livre.
                </li>
                <li>
                  <strong className="text-zinc-400">Impacto:</strong> Reduz conversão nos canais e impede publicação de novos anúncios até atingir a nota mínima.
                </li>
                {showTechDetails && (
                  <li className="font-mono text-[11px] text-zinc-400">
                    Motores: CQS + IQRE + CRE
                  </li>
                )}
              </ul>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link
                href="/catalogo"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-xs font-semibold text-white hover:bg-zinc-700"
              >
                <span>Abrir Ficha</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/publicacoes"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
              >
                <span>Simular Publicação</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Hierarquia 4: Execução e Atividade Operacional Recente */}
      <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              4. Atividade Operacional Recente (Webhooks e Execuções)
            </h2>
          </div>
          <Link
            href="/auditoria"
            className="text-xs font-medium text-zinc-400 hover:text-white"
          >
            Ver histórico completo de auditoria &rarr;
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="pb-2.5 pr-4">Origem</th>
                <th className="pb-2.5 px-4">Evento Recebido</th>
                <th className="pb-2.5 px-4">Recurso (ID)</th>
                <th className="pb-2.5 px-4">Resultado Operacional</th>
                <th className="pb-2.5 pl-4 text-right">Processado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {recentWebhooks.map((wh) => (
                <tr key={wh.id} className="hover:bg-zinc-900/70">
                  <td className="py-2.5 pr-4 font-semibold uppercase text-zinc-200">
                    {wh.source}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-zinc-300">
                    {wh.event_type}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-emerald-400">
                    {wh.resource_id}
                  </td>
                  <td className="py-2.5 px-4">
                    {wh.status === 'processed' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        Processado com idempotência
                      </span>
                    ) : wh.status === 'ignored' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        Descartado ({wh.ignore_reason ?? 'eco/duplicado'})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                        Na fila ({wh.status})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pl-4 text-right text-zinc-400">
                    {wh.processed_at
                      ? new Date(wh.processed_at).toLocaleString('pt-BR')
                      : 'Aguardando worker'}
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
