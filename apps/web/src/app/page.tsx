'use client';

import React, { useEffect, useState } from 'react';
import { Toaster, ToastMessage } from '../components/toaster';
import Link from 'next/link';
import { Activity, Boxes, Gauge, Link2, ListChecks, RefreshCw, Share2, Shield, Sparkles } from 'lucide-react';
import {
  fetchOperationalState,
  OperationalStatePayload,
} from '../utils/operational-state';
import { EmptySkuNotice } from '../components/empty-sku-notice';
import { apiFetch } from '../utils/api-client';
import { useCurrentRole } from '../components/app-shell';
import { CatalogCycle } from '../components/home/onboarding-funnel';
import { BrandLogo } from '../components/brand-logo';
import { Button } from '../components/ui/button';
import { MetricValue } from '../components/ui/metric-value';
import {
  ActionTopic,
  ActionTopicList,
  activityView,
  CockpitCard,
  CoverageFunnel,
  formatCount,
  FunnelStage,
  healthToneOf,
  resultBadge,
  TONE_BAR,
  TONE_TEXT,
} from '../components/home/cockpit';

/** Botão de ação rápida: ícone + verbo, com dica do que a ação faz. */
function QuickAction({
  icon,
  label,
  hint,
  busy,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  busy: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      title={hint}
      variant={primary ? 'primary' : 'secondary'}
      className="rounded-full"
    >
      {icon}
      {label}
    </Button>
  );
}

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
  totalVariants?: number;
  activeChannels?: Array<{
    id: string;
    name: string;
    enabled: boolean;
    connected: boolean;
    statusLabel: string;
    linkedCount: number;
  }>;
  gaps: { missingSku: number; missingCategory: number; missingCover: number; missingNcm?: number };
  lastSyncOk: string | null;
  lastSyncError: string | null;
  lastBlingSync?: string | null;
  linkedNuvemshop?: number;
  linkedMercadoLivre?: number;
  fiscal?: { awaitingNcm: number; awaitingEan: number; conflicts: number };
  readiness?: { averageScore: number; readyToPublish: number };
  livePublishing?: boolean;
  sync?: {
    status: 'idle' | 'running' | 'done' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
    seen: number;
    upserted: number;
  };
  channels: Array<{ provider: string; expires_at: string; has_refresh: boolean }>;
}

export default function HomePage() {
  const { hasRole } = useCurrentRole();
  const [state, setState] = useState<OperationalStatePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [catalogHome, setCatalogHome] = useState<CatalogHome | null>(null);
  const [catalogHomeError, setCatalogHomeError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    status: 'idle' | 'processing' | 'completed' | 'failed';
    total: number;
    processed: number;
    page?: number;
    lastCompletedPage?: number;
    errorMessage?: string | null;
  } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [syncStarting, setSyncStarting] = useState(false);
  const [enrichmentLive, setEnrichmentLive] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

  const pullSyncStatus = async () => {
    try {
      const next = await apiFetch<{
        status: 'idle' | 'processing' | 'completed' | 'failed';
        total: number;
        processed: number;
        page?: number;
        lastCompletedPage?: number;
        errorMessage?: string | null;
      }>('/api/admin/sync-status');
      setSyncStatus(next);
    } catch {
      // Operador sem a rota de admin continua vendo o card parado.
    }
    try {
      const duplicates = await apiFetch<{ total: number }>('/api/duplicates');
      setDuplicateCount(duplicates.total);
    } catch {
      setDuplicateCount(0);
    }
  };

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
    void pullSyncStatus();
    setForbidden(new URLSearchParams(window.location.search).get('erro') === '403');
    const timer = window.setInterval(() => void pullSyncStatus(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const startEnrichment = async () => {
    setEnriching(true);
    try {
      await apiFetch('/api/admin/enrich-catalog', { method: 'POST' });
      const id = `toast-${Date.now()}`;
      setToasts((current) => [
        ...current,
        { id, variant: 'success', title: 'Enriquecimento iniciado em background' },
      ]);
      setEnrichmentLive(true);
    } catch {
      const id = `toast-${Date.now()}`;
      setToasts((current) => [
        ...current,
        { id, variant: 'warning', title: 'Não foi possível iniciar o enriquecimento' },
      ]);
    } finally {
      setEnriching(false);
    }
  };

  const startReconcile = async () => {
    setSyncNotice(null);
    setReconciling(true);
    try {
      await apiFetch('/api/admin/reconcile-now', { method: 'POST' });
      setSyncNotice('Reconciliação iniciada. O HUB busca o anúncio pelo SKU e grava o vínculo.');
    } catch {
      setSyncNotice('Não foi possível iniciar a reconciliação.');
    } finally {
      setReconciling(false);
    }
  };

  const startSync = async () => {
    setSyncNotice(null);
    setSyncStarting(true);
    try {
      await apiFetch('/api/admin/sync-full', { method: 'POST' });
      setSyncNotice('Sincronização do ERP iniciada. A tela continua livre.');
      await pullSyncStatus();
    } catch {
      setSyncNotice('Não foi possível iniciar a sincronização.');
    } finally {
      setSyncStarting(false);
    }
  };

  const shadow = catalogHome?.livePublishing !== true;
  const products = catalogHome?.cards.products.value ?? state?.kpis.monitoredProducts.value ?? 0;
  const totalVariants = catalogHome?.totalVariants ?? 0;
  const readyToPublish = catalogHome?.readiness?.readyToPublish ?? catalogHome?.cards.ready.value ?? 0;
  const averageScore = catalogHome?.readiness?.averageScore ?? catalogHome?.completenessPct ?? 0;
  const awaitingNcm = catalogHome?.fiscal?.awaitingNcm ?? state?.kpis.actionPendings.breakdown.ncmPendingFirst ?? 0;
  const incomplete = catalogHome?.cards.incomplete.value ?? state?.contentIncompleteCount ?? 0;
  const nuvemshopPublished = catalogHome?.linkedNuvemshop ?? 0;
  const mercadoLivrePublished = catalogHome?.linkedMercadoLivre ?? 0;
  const nuvemshopTokenConnected = Boolean(
    catalogHome?.activeChannels?.find((ch) => ch.id === 'nuvemshop')?.connected ??
      catalogHome?.channels?.some((ch) => ch.provider === 'nuvemshop') ??
      state?.channels.oauth.some((ch) => ch.provider === 'nuvemshop')
  );
  const channelEntries = catalogHome?.activeChannels ?? [
    {
      id: 'nuvemshop',
      name: 'Nuvemshop',
      enabled: true,
      connected: nuvemshopTokenConnected,
      statusLabel: nuvemshopTokenConnected ? 'Conectado' : 'Desconectado',
      linkedCount: nuvemshopPublished,
    },
    {
      id: 'mercadolivre',
      name: 'Mercado Livre',
      enabled: false,
      connected: false,
      statusLabel: 'Pausado',
      linkedCount: mercadoLivrePublished,
    },
  ];
  const syncState = syncStatus?.status ?? 'idle';
  const syncRunning = syncState === 'processing' || syncStarting;

  const missingSku = catalogHome?.gaps.missingSku ?? state?.emptySkuCount ?? 0;
  const missingCover = catalogHome?.gaps.missingCover ?? 0;
  const missingCategory = catalogHome?.gaps.missingCategory ?? 0;
  const withSku = Math.max(0, products - missingSku);
  const withCover = Math.max(0, products - missingCover);
  const withCategory = Math.max(0, products - missingCategory);

  const missingNcm = catalogHome?.gaps.missingNcm ?? awaitingNcm;
  const readyCatalog = catalogHome?.cards.ready.value ?? readyToPublish;
  const withNcm = Math.max(0, products - missingNcm);
  const healthTone = healthToneOf(averageScore);

  const actionTopics: ActionTopic[] = [
    { key: 'duplicate', label: 'Duplicidades', count: duplicateCount, href: '/problemas?filtro=duplicidades', severity: 'block' },
    { key: 'sku', label: 'Sem SKU', count: missingSku, href: '/catalogo?pendencia=sku', severity: 'block' },
    { key: 'ncm', label: 'Sem NCM válido', count: missingNcm, href: '/catalogo?pendencia=ncm', severity: 'block' },
    { key: 'incomplete', label: 'Incompletos', count: incomplete, href: '/completude', severity: 'warn' },
  ];

  const funnelStages: FunnelStage[] = [
    { key: 'sku', label: 'Com SKU válido', value: withSku, href: '/catalogo?pendencia=sku', missingLabel: 'sem SKU' },
    { key: 'cover', label: 'Com imagem de capa', value: withCover, href: '/catalogo?pendencia=cover', missingLabel: 'sem capa' },
    { key: 'ncm', label: 'Com NCM válido', value: withNcm, href: '/catalogo?pendencia=ncm', missingLabel: 'sem NCM válido' },
    { key: 'category', label: 'Com categoria mapeada', value: withCategory, href: '/catalogo?pendencia=hub_category', missingLabel: 'sem categoria' },
    { key: 'ready', label: 'Prontos para publicar', value: readyCatalog, href: '/catalogo?status=ready', final: true },
  ];

  const failedToday = catalogHome?.cards.publicationsToday.failed ?? 0;
  const nuvemshopHealthy = nuvemshopTokenConnected && failedToday === 0;
  const nuvemshopHealthNote = !nuvemshopTokenConnected
    ? 'Token da loja não conectado'
    : failedToday > 0
      ? `${formatCount(failedToday)} envio${failedToday > 1 ? 's' : ''} com erro hoje`
      : 'Conectada, sem erros de envio hoje';

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {forbidden && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-800 dark:text-rose-100">
          Acesso negado (403). A loja de integrações é exclusiva do administrador.
        </p>
      )}

      <header className="flex flex-col justify-between gap-4 pb-6 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">
            Visão Geral
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            JH Sync Hub · {shadow ? 'Modo Simulação (Shadow) ativo — nenhuma escrita externa' : 'Sincronização operacional ativa'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {shadow && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-700/30 bg-sky-200/70 px-3.5 py-1.5 text-xs font-semibold text-sky-950 dark:border-[#d97324]/45 dark:bg-[#d97324]/[0.12] dark:text-[#f59f4c]">
              <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Shadow Ativo</span>
            </div>
          )}

          {hasRole('admin') && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ações rápidas">
              <QuickAction
                icon={<RefreshCw className={`h-3.5 w-3.5 ${syncRunning ? 'animate-spin' : ''}`} aria-hidden />}
                label={syncRunning ? 'Sincronizando...' : 'Sincronizar Bling'}
                hint="Lê cadastro, preço e estoque ativos do Bling"
                busy={syncRunning}
                primary
                onClick={() => void startSync()}
              />
              <QuickAction
                icon={<Sparkles className={`h-3.5 w-3.5 ${enriching ? 'animate-pulse' : ''}`} aria-hidden />}
                label={enriching ? 'Enriquecendo...' : 'Enriquecer Catálogo'}
                hint="Copia imagens e NCM do ERP para o HUB"
                busy={enriching}
                onClick={() => void startEnrichment()}
              />
              <QuickAction
                icon={<Link2 className={`h-3.5 w-3.5 ${reconciling ? 'animate-pulse' : ''}`} aria-hidden />}
                label={reconciling ? 'Reconciliando...' : 'Reconciliar Vínculos'}
                hint="Encontra o anúncio pelo SKU e grava o vínculo"
                busy={reconciling}
                onClick={() => void startReconcile()}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadState()}
            aria-label="Recarregar os números da tela"
            title="Recarregar os números da tela"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-color bg-bg-surface text-text-muted transition hover:text-text-primary active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </header>

      {!state && (
        <p className="mb-5 text-sm text-text-muted" role="status">
          {loading ? 'Lendo o catálogo...' : loadError}
        </p>
      )}

      {state && state.emptySkuCount > 0 && (
        <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-color bg-bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <EmptySkuNotice />
            <span>{formatCount(state.emptySkuCount)} produto(s) sem SKU. Eles não entram na lista de envio.</span>
          </div>
          <Link href="/catalogo" className="text-xs font-semibold text-text-primary underline">Ver no catálogo</Link>
        </section>
      )}

      {syncState === 'processing' && (
        <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-600/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-950 dark:border-[#d97324]/35 dark:bg-[#d97324]/10 dark:text-[#f7f3ed]" role="status">
          <span>
            Sincronizando produtos ativos do Bling — página {formatCount(syncStatus?.page ?? 1)} ({formatCount(syncStatus?.processed ?? 0)} produtos pai verificados).
          </span>
        </section>
      )}

      {syncState === 'failed' && (
        <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100" role="alert">
          <span>
            A sincronização do Bling parou na página {formatCount(syncStatus?.page ?? 1)} ({formatCount(syncStatus?.lastCompletedPage ?? 0)} páginas concluídas).
            {syncStatus?.errorMessage ? ` Motivo: ${syncStatus.errorMessage}` : ''}
          </span>
          {hasRole('admin') && (
            <button
              type="button"
              onClick={() => void startSync()}
              disabled={syncStarting}
              className="rounded-full bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Retomar sincronização
            </button>
          )}
        </section>
      )}

      <section>
        {catalogHomeError && <p className="mb-3 text-sm text-rose-700 dark:text-rose-200" role="alert">{catalogHomeError}</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CockpitCard
            label="Ações necessárias"
            icon={<ListChecks className="h-3.5 w-3.5 text-accent-copper" aria-hidden />}
            aside={
              <span className="text-[11px] font-semibold tabular-nums text-text-muted">
                {formatCount(actionTopics.reduce((sum, topic) => sum + topic.count, 0))}
              </span>
            }
          >
            <ActionTopicList topics={actionTopics} />
          </CockpitCard>

          <CockpitCard
            label="Total no catálogo"
            icon={<Boxes className="h-3.5 w-3.5 text-sky-700 dark:text-[#6db2f2]" aria-hidden />}
          >
            <Link href="/catalogo" className="group rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60">
              <p className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
                <MetricValue value={products} ready={!loading && Boolean(catalogHome || state)} />
              </p>
              <p className="mt-2 text-xs text-text-muted">produtos ativos</p>
            </Link>
            <div className="mt-auto border-t border-border-color/60 pt-3 dark:border-white/[0.07]">
              <p className="text-xs text-text-muted">
                <span className="font-semibold tabular-nums text-text-primary">{formatCount(totalVariants)}</span> variações (SKUs)
              </p>
            </div>
          </CockpitCard>

          <CockpitCard
            label="Saúde e completude"
            icon={<Gauge className={`h-3.5 w-3.5 ${TONE_TEXT[healthTone]}`} aria-hidden />}
            aside={<span className="text-[11px] text-text-muted">meta 80%</span>}
          >
            <Link href="/completude" className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60">
              <p className={`text-[32px] font-bold leading-none tracking-tight tabular-nums ${TONE_TEXT[healthTone]}`}>
                <MetricValue value={averageScore} ready={!loading && Boolean(catalogHome)} suffix="%" />
              </p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-bg-base dark:bg-white/[0.07]"
                role="meter"
                aria-valuenow={averageScore}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Saúde média do catálogo"
              >
                <div
                  className={`ui-progress h-full w-full rounded-full ${TONE_BAR[healthTone]}`}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, averageScore / 100))})` }}
                />
              </div>
            </Link>
            <Link
              href="/catalogo?status=ready"
              className="mt-auto pt-3 text-xs font-semibold text-emerald-700 hover:underline dark:text-[#52dc86]"
            >
              {formatCount(readyCatalog)} produtos prontos para venda
            </Link>
          </CockpitCard>

          <CockpitCard
            label="Nuvemshop"
            icon={<Share2 className="h-3.5 w-3.5 text-accent-copper" aria-hidden />}
            aside={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  nuvemshopHealthy
                    ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-[#3ecf74]/30 dark:bg-[#3ecf74]/12 dark:text-[#66e094]'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                }`}
                title={nuvemshopHealthNote}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${nuvemshopHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
                {nuvemshopHealthy ? 'Saudável' : 'Atenção'}
              </span>
            }
          >
            <Link href="/canais" className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60">
              <p className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
                <MetricValue value={nuvemshopPublished} ready={!loading && Boolean(catalogHome)} />
              </p>
              <p className="mt-2 text-xs text-text-muted">anúncios vinculados</p>
            </Link>
            <p className="mt-auto border-t border-border-color/60 pt-3 text-xs text-text-muted dark:border-white/[0.07]">
              {nuvemshopHealthNote}
            </p>
          </CockpitCard>
        </div>

        {syncNotice && <p className="mt-3 text-xs text-text-muted" role="status">{syncNotice}</p>}
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border-color bg-bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-text-primary">Cobertura do catálogo</h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Cada etapa contra o total. A barra vermelha é onde o catálogo mais perde produtos.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <CoverageFunnel total={products} stages={funnelStages} />
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border-color bg-bg-surface p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold tracking-tight text-text-primary">Canais ativos &amp; ciclo operacional</h2>
                <p className="mt-0.5 text-xs text-text-muted">Estado das conexões OAuth, vínculos por canal e etapas do HUB</p>
              </div>
              <Link href="/canais" className="text-xs font-semibold text-text-muted underline hover:text-text-primary">
                Gerenciar
              </Link>
            </div>

            <ul className="mt-5 space-y-2.5">
              {channelEntries.map((ch) => (
                <li
                  key={ch.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-color/60 bg-bg-base/50 px-3.5 py-2.5 dark:border-white/[0.07] dark:bg-black/25"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <BrandLogo id={ch.id as 'nuvemshop' | 'mercadolivre'} name={ch.name} size={22} />
                    <span className="truncate text-sm font-medium text-text-primary">{ch.name}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        ch.connected
                          ? 'border-emerald-600/30 bg-emerald-500/15 text-emerald-800 dark:border-[#3ecf74]/35 dark:bg-[#3ecf74]/12 dark:text-[#66e094]'
                          : 'border-border-color bg-bg-base text-text-muted dark:border-white/10 dark:bg-white/[0.04]'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${ch.connected ? 'bg-emerald-600 dark:bg-[#3ecf74]' : 'bg-text-muted'}`} aria-hidden="true" />
                      {ch.statusLabel}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold tabular-nums text-text-primary">
                      {formatCount(ch.linkedCount)}
                    </span>
                    <span className="ml-1.5 text-[11px] text-text-muted">vinculados</span>
                  </div>
                </li>
              ))}
            </ul>

            {nuvemshopTokenConnected && nuvemshopPublished === 0 && hasRole('admin') && (
              <button
                type="button"
                disabled={reconciling}
                onClick={() => void startReconcile()}
                className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {reconciling ? 'Buscando vínculos na Nuvemshop...' : 'Vincular anúncios da Nuvemshop'}
              </button>
            )}
          </div>

          <div className="mt-6 border-t border-border-color/60 pt-5 dark:border-white/[0.08]">
            <CatalogCycle
              imported={products > 0}
              enriching={enrichmentLive || enriching}
              shadow={shadow}
              canContinue={hasRole('admin')}
              continuing={enriching}
              onContinue={() => void startEnrichment()}
            />
          </div>
        </div>
      </section>

      {state && (
        <section className="mt-6 rounded-2xl border border-border-color bg-bg-surface p-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent-copper" aria-hidden="true" />
              <h2 className="text-base font-bold tracking-tight text-text-primary">Atividade recente</h2>
            </div>
            <Link href="/auditoria" className="text-xs text-text-muted underline hover:text-text-primary">Ver auditoria</Link>
          </div>
          <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Tabela de atividade recente">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border-color/70 text-xs text-text-muted dark:border-white/10">
                <tr>
                  <th className="pb-2.5 pr-4 font-medium">Origem</th>
                  <th className="pb-2.5 px-4 font-medium">Evento</th>
                  <th className="pb-2.5 px-4 font-medium">Recurso</th>
                  <th className="pb-2.5 px-4 font-medium">Resultado</th>
                  <th className="pb-2.5 pl-4 text-right font-medium">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-color/60 dark:divide-white/[0.06]">
                {state.recentWebhooks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-sm text-text-muted">
                      Nenhuma sincronização em andamento. Clique em Sincronização para iniciar.
                    </td>
                  </tr>
                )}
                {state.recentWebhooks.map((wh) => {
                  const badge = resultBadge(wh.status, wh.ignore_reason);
                  const view = activityView(wh.event_type, badge.failed);
                  const EventIcon = view.icon;
                  const BadgeIcon = badge.icon;
                  return (
                  <tr key={wh.id}>
                    <td className="py-2.5 pr-4 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{wh.source}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center gap-2 text-text-primary">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border-color/70 bg-bg-base dark:border-white/[0.08] dark:bg-white/[0.04]">
                          <EventIcon className={`h-3.5 w-3.5 ${view.iconClass}`} aria-hidden />
                        </span>
                        {view.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-text-primary">{wh.resource_id}</td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                        <BadgeIcon className="h-3 w-3" aria-hidden />
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2.5 pl-4 text-right tabular-nums text-text-muted">
                      {wh.processed_at ? new Date(wh.processed_at).toLocaleString('pt-BR') : 'Na fila'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Toaster toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </main>
  );
}
