'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
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
  OperationalStatePayload,
} from '../utils/operational-state';
import { EmptySkuNotice } from '../components/empty-sku-notice';
import { apiFetch } from '../utils/api-client';

interface CatalogHome {
  cards: {
    products: { value: number; href: string };
    ready: { value: number; href: string };
    incomplete: { value: number; href: string };
    unlinked: { value: number; href: string };
    syncProblems: { value: number; href: string };
    publicationsToday: { value: number; sent: number; failed: number; queued: number; href: string };
  };
  completenessPct: number;
  gaps: { missingSku: number; missingCategory: number; missingCover: number };
  lastSyncOk: string | null;
  lastSyncError: string | null;
  channels: Array<{ provider: string; expires_at: string; has_refresh: boolean }>;
}

export default function HomePage() {
  const [state, setState] = useState<OperationalStatePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);
  const [catalogHome, setCatalogHome] = useState<CatalogHome | null>(null);
  const [catalogHomeError, setCatalogHomeError] = useState<string | null>(null);

  const loadState = async () => {
    setLoading(true);
    try {
      const [operational, home] = await Promise.allSettled([
        fetchOperationalState(),
        apiFetch<CatalogHome>('/api/catalog/home'),
      ]);
      if (operational.status === 'fulfilled') {
        setState(operational.value);
        setLoadError(null);
      } else {
        setState(null);
        setLoadError('Não foi possível ler o banco. Nenhum número de exemplo é exibido.');
      }
      if (home.status === 'fulfilled') {
        setCatalogHome(home.value);
        setCatalogHomeError(null);
      } else {
        setCatalogHome(null);
        setCatalogHomeError('Não foi possível ler os cards do catálogo.');
      }
    } catch {
      setState(null);
      setLoadError('Não foi possível ler o banco. Nenhum número de exemplo é exibido.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Início</h1>
        <p className="mt-4 text-sm text-zinc-300" role="status">
          {loading ? 'Lendo o catálogo...' : loadError}
        </p>
        {!loading && (
          <button
            type="button"
            onClick={() => void loadState()}
            className="mt-4 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200"
          >
            Tentar de novo
          </button>
        )}
      </main>
    );
  }

  const { kpis, channels, recentWebhooks } = state;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Cabeçalho + Hierarquia 1: Estado Operacional */}
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Início</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Dados lidos do banco
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

      {state.emptySkuCount > 0 && (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-rose-100">
            <EmptySkuNotice />
            <span>
              {state.emptySkuCount} produto(s) sem SKU. Eles não entram na lista de envio até o SKU ser preenchido no Bling.
            </span>
          </div>
          <Link href="/catalogo" className="text-xs font-semibold text-rose-100 underline">
            Ver no catálogo
          </Link>
        </section>
      )}

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

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Catálogo</h2>
        {catalogHomeError && <p className="mt-3 text-sm text-rose-200" role="alert">{catalogHomeError}</p>}
        {catalogHome && (
          <>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Produtos no catálogo', catalogHome.cards.products.value, catalogHome.cards.products.href],
                ['Prontos para publicar', catalogHome.cards.ready.value, catalogHome.cards.ready.href],
                ['Incompletos', catalogHome.cards.incomplete.value, catalogHome.cards.incomplete.href],
                ['Sem vínculo', catalogHome.cards.unlinked.value, catalogHome.cards.unlinked.href],
                ['Problemas de sync', catalogHome.cards.syncProblems.value, catalogHome.cards.syncProblems.href],
                ['Publicações hoje', catalogHome.cards.publicationsToday.value, catalogHome.cards.publicationsToday.href],
              ].map(([label, value, href]) => (
                <Link key={String(href)} href={String(href)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-zinc-600">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
                  <p className="mt-2 text-3xl font-bold text-white">{value}</p>
                  {label === 'Publicações hoje' && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {catalogHome.cards.publicationsToday.sent} enviadas · {catalogHome.cards.publicationsToday.failed} falhas · {catalogHome.cards.publicationsToday.queued} na fila
                    </p>
                  )}
                </Link>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-300">
              <p className="font-semibold text-white">Turbine seu catálogo · {catalogHome.completenessPct}% prontos</p>
              <p className="mt-1">Última sync ok: {catalogHome.lastSyncOk ? new Date(catalogHome.lastSyncOk).toLocaleString('pt-BR') : 'nenhuma'} · última com erro: {catalogHome.lastSyncError ? new Date(catalogHome.lastSyncError).toLocaleString('pt-BR') : 'nenhuma'}</p>
              <p className="mt-1">Canais com token: {catalogHome.channels.length}. Renovação automática só quando o canal devolveu credencial de renovação.</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <Link href="/catalogo" className="underline">{catalogHome.gaps.missingSku} sem SKU</Link>
                <Link href="/completude" className="underline">{catalogHome.gaps.missingCategory} sem categoria</Link>
                <Link href="/completude" className="underline">{catalogHome.gaps.missingCover} sem imagem</Link>
              </div>
            </div>
          </>
        )}
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
              href="/vinculos"
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
                  {state.contentIncompleteCount} produtos com conteúdo incompleto
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
              {recentWebhooks.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-sm text-zinc-400">
                    Nenhum evento recente no banco.
                  </td>
                </tr>
              )}
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
