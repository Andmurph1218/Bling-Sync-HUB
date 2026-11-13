'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Toaster, ToastMessage } from '../components/toaster';
import Link from 'next/link';
import {
  Boxes,
  Check,
  ChevronDown,
  RefreshCw,
  Share2,
  Shield,
  Star,
  Users,
} from 'lucide-react';
import {
  fetchOperationalState,
  OperationalStatePayload,
} from '../utils/operational-state';
import { EmptySkuNotice } from '../components/empty-sku-notice';
import { apiFetch } from '../utils/api-client';
import { useCurrentRole } from '../components/app-shell';
import { CatalogCycle } from '../components/home/onboarding-funnel';
import { BrandLogo } from '../components/brand-logo';

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
  gaps: { missingSku: number; missingCategory: number; missingCover: number };
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

function formatCount(value: number): string {
  return value.toLocaleString('pt-BR');
}

const EVENT_LABEL: Record<string, string> = {
  'product.created': 'Produto Criado',
  'product.updated': 'Produto Atualizado',
  'product.deleted': 'Produto Removido',
  'stock.created': 'Estoque Atualizado',
  'stock.updated': 'Estoque Atualizado',
  'product/created': 'Produto Criado',
  'product/updated': 'Produto Atualizado',
  'product/deleted': 'Produto Removido',
};

function formatEvent(eventType: string): string {
  return EVENT_LABEL[eventType] ?? EVENT_LABEL[eventType.toLowerCase()] ?? eventType.replace(/[._]/g, ' ');
}

function activityBadge(status: string, reason: string | null): { label: string; className: string } {
  const normalized = status.toLowerCase();
  const detail = (reason ?? '').toLowerCase();
  const ignored = normalized === 'ignored'
    || detail.includes('identical')
    || detail.includes('identico')
    || detail.includes('idêntico');
  if (ignored) {
    return {
      label: 'Atualização Ignorada (sem alteração)',
      className: 'border-border-color bg-bg-base text-text-muted dark:border-white/10 dark:bg-white/[0.04]',
    };
  }
  if (normalized === 'processed' || normalized === 'processado' || normalized === 'completed') {
    return {
      label: 'Sucesso',
      className: 'border-emerald-600/30 bg-emerald-500/15 text-emerald-800 dark:border-[#3ecf74]/30 dark:bg-[#3ecf74]/12 dark:text-[#66e094]',
    };
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'erro') {
    return {
      label: 'Falha',
      className: 'border-rose-600/30 bg-rose-500/15 text-rose-800 dark:text-rose-200',
    };
  }
  return { label: status, className: 'border-border-color bg-bg-base text-text-muted' };
}

function healthTone(score: number): { bar: string; meta: string } {
  if (score > 80) {
    return {
      bar: 'bg-emerald-600 dark:bg-[#3ecf74]',
      meta: 'text-emerald-800 dark:text-[#52dc86]',
    };
  }
  if (score > 50) {
    return {
      bar: 'bg-amber-500 dark:bg-[#f09a42]',
      meta: 'text-amber-800 dark:text-[#f2a65a]',
    };
  }
  return {
    bar: 'bg-rose-600 dark:bg-[#d97324]',
    meta: 'text-rose-800 dark:text-[#f2a65a]',
  };
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
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const syncMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!syncMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!syncMenuRef.current?.contains(event.target as Node)) setSyncMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSyncMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [syncMenuOpen]);

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
      setSyncMenuOpen(false);
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
      setSyncMenuOpen(false);
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
      setSyncMenuOpen(false);
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
  const tone = healthTone(averageScore);
  const awaitingNcm = catalogHome?.fiscal?.awaitingNcm ?? state?.kpis.actionPendings.breakdown.ncmPendingFirst ?? 0;
  const awaitingEan = catalogHome?.fiscal?.awaitingEan ?? state?.kpis.actionPendings.breakdown.eanPending ?? 0;
  const fiscalConflicts = catalogHome?.fiscal?.conflicts ?? state?.kpis.actionPendings.breakdown.eanDuplicates ?? 0;
  const fiscalProducts = awaitingNcm + awaitingEan;
  const incomplete = catalogHome?.cards.incomplete.value ?? state?.contentIncompleteCount ?? 0;
  const pendingActions = fiscalProducts + fiscalConflicts + incomplete + duplicateCount;
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
  const syncBusy = syncRunning || reconciling || enriching;

  const missingSku = catalogHome?.gaps.missingSku ?? state?.emptySkuCount ?? 0;
  const missingCover = catalogHome?.gaps.missingCover ?? 0;
  const missingCategory = catalogHome?.gaps.missingCategory ?? 0;
  const withSku = Math.max(0, products - missingSku);
  const withCover = Math.max(0, products - missingCover);
  const withCategory = Math.max(0, products - missingCategory);
  const ncmValid = Math.max(0, products - awaitingNcm - fiscalConflicts);

  const stageBars = [
    { label: 'Catálogo', value: products, highlight: false },
    { label: 'Com SKU', value: withSku, highlight: false },
    { label: 'Com Capa', value: withCover, highlight: false },
    { label: 'Nuvemshop', value: nuvemshopPublished, highlight: true },
    { label: 'NCM OK', value: ncmValid, highlight: false },
    { label: 'Categoria', value: withCategory, highlight: false },
    { label: 'Prontos', value: readyToPublish, highlight: false },
  ];
  const maxStageValue = Math.max(1, ...stageBars.map((b) => b.value));

  return (
    <main className="mx-auto max-w-6xl px-6 py-7">
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
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-700/30 bg-sky-200/70 px-3.5 py-1.5 text-xs font-semibold text-sky-950 dark:border-[#d97324]/45 dark:bg-[#d97324]/12 dark:text-[#f59f4c]">
              <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Shadow Ativo</span>
            </div>
          )}

          {hasRole('admin') && (
            <div className="relative" ref={syncMenuRef}>
              <button
                type="button"
                aria-expanded={syncMenuOpen}
                aria-haspopup="menu"
                aria-busy={syncBusy}
                onClick={() => setSyncMenuOpen((open) => !open)}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
              >
                Sincronização
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${syncMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {syncMenuOpen && (
                <div role="menu" className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-border-color bg-bg-surface p-2 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.65)]">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={syncRunning}
                    onClick={() => void startSync()}
                    className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-bg-base dark:hover:bg-white/[0.05] disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-text-primary">{syncRunning ? 'Sincronizando o ERP...' : 'Sync Completo ERP (Bling)'}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">Lê preço, estoque e cadastro ativo do Bling.</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={reconciling}
                    onClick={() => void startReconcile()}
                    className="mt-1 block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-bg-base dark:hover:bg-white/[0.05] disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-text-primary">{reconciling ? 'Buscando vínculos...' : 'Reconciliação de Vínculos (Marketplaces)'}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">Encontra o anúncio pelo SKU e grava o vínculo.</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={enriching}
                    onClick={() => void startEnrichment()}
                    className="mt-1 block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-bg-base dark:hover:bg-white/[0.05] disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-text-primary">{enriching ? 'Enriquecendo...' : 'Enriquecimento em Massa (Imagens/NCM)'}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">Copia imagem e NCM do ERP para o HUB.</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadState()}
            className="craft-pill inline-flex items-center gap-1.5 rounded-full border border-border-color bg-bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
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
          <Link
            href="/problemas"
            className="group rounded-2xl border border-border-color bg-bg-surface p-5 transition hover:border-border-color/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-[#d97324]/35 dark:bg-[#d97324]/12 dark:text-[#f29a4b]">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-xs font-medium text-text-muted">
                {duplicateCount > 0 ? `${formatCount(duplicateCount)} duplicidades` : 'Resolver pendências'}
              </span>
            </div>
            <p className="mt-5 text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
              {formatCount(pendingActions)}
            </p>
            <p className="mt-2 text-xs text-text-muted">Ações necessárias (fiscais e cadastro)</p>
          </Link>

          <Link
            href="/catalogo"
            className="group rounded-2xl border border-border-color bg-bg-surface p-5 transition hover:border-border-color/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-600/30 bg-sky-500/10 text-sky-800 dark:border-[#5ea4e6]/30 dark:bg-[#5ea4e6]/12 dark:text-[#6db2f2]">
                <Boxes className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-xs font-medium text-emerald-800 dark:text-[#52dc86]">
                +{formatCount(readyToPublish)} prontos p/ venda
              </span>
            </div>
            <p className="mt-5 text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
              {formatCount(products)}
            </p>
            <p className="mt-2 text-xs text-text-muted">
              {totalVariants > products
                ? `Total no catálogo (${formatCount(totalVariants)} SKUs c/ variações)`
                : 'Total de produtos no catálogo'}
            </p>
          </Link>

          <Link
            href="/completude"
            className="group rounded-2xl border border-border-color bg-bg-surface p-5 transition hover:border-border-color/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:border-[#3ecf74]/30 dark:bg-[#3ecf74]/12 dark:text-[#4dd882]">
                <Star className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className={`text-xs font-medium ${tone.meta}`}>
                Meta operacional 80%
              </span>
            </div>
            <p className="mt-5 text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
              {averageScore}%
            </p>
            <p className="mt-2 text-xs text-text-muted">Saúde e completude do catálogo</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-base dark:bg-white/[0.07]" role="meter" aria-valuenow={averageScore} aria-valuemin={0} aria-valuemax={100} aria-label="Média de completude">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(4, Math.min(100, averageScore))}%` }} />
            </div>
          </Link>

          <div className="rounded-2xl border border-border-color bg-bg-surface p-5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-[#d97324]/35 dark:bg-[#d97324]/12 dark:text-[#f29a4b]">
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className={`text-xs font-medium ${nuvemshopTokenConnected ? 'text-emerald-800 dark:text-[#52dc86]' : 'text-text-muted'}`}>
                {nuvemshopTokenConnected ? 'Nuvemshop conectada' : 'Sem canal ativo'}
              </span>
            </div>
            <p className="mt-5 text-[32px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
              {formatCount(nuvemshopPublished)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-text-muted">Anúncios vinculados</p>
              <Link href="/canais" className="text-xs font-semibold text-text-primary underline">
                Canais
              </Link>
            </div>
          </div>
        </div>

        {syncNotice && <p className="mt-3 text-xs text-text-muted" role="status">{syncNotice}</p>}
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border-color bg-bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-text-primary">Cobertura por etapa do catálogo</h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {formatCount(products)} produtos monitorados · destaque em vínculos Nuvemshop ({formatCount(nuvemshopPublished)})
              </p>
            </div>
          </div>

          <div className="mt-6 grid h-44 grid-cols-7 items-end gap-2.5 border-b border-dashed border-border-color/50 pb-2 pt-4 dark:border-white/10">
            {stageBars.map((bar) => {
              const heightPct = Math.max(10, Math.round((bar.value / maxStageValue) * 100));
              return (
                <div key={bar.label} className="flex h-full flex-col items-center justify-end gap-2">
                  <span className="text-[10px] font-semibold tabular-nums text-text-muted">
                    {formatCount(bar.value)}
                  </span>
                  <div
                    className={`w-full max-w-[44px] rounded-t-xl transition-all ${
                      bar.highlight
                        ? 'bg-emerald-700 dark:bg-[#d97324] shadow-[0_6px_18px_-6px_rgba(217,115,36,0.65)]'
                        : 'bg-emerald-900/20 dark:bg-[#f5dbb6]'
                    }`}
                    style={{ height: `${heightPct}%` }}
                    title={`${bar.label}: ${formatCount(bar.value)}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 grid grid-cols-7 gap-2 text-center">
            {stageBars.map((bar) => (
              <span key={bar.label} className="truncate text-[11px] font-medium text-text-muted">
                {bar.label}
              </span>
            ))}
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
              <Users className="h-4 w-4 text-text-muted dark:text-[#f29a4b]" aria-hidden="true" />
              <h2 className="text-base font-bold tracking-tight text-text-primary">Atividade recente</h2>
            </div>
            <Link href="/auditoria" className="text-xs text-text-muted underline hover:text-text-primary">Ver auditoria</Link>
          </div>
          <div className="mt-4 overflow-x-auto">
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
                {state.recentWebhooks.map((wh) => (
                  <tr key={wh.id}>
                    <td className="py-2.5 pr-4 font-semibold uppercase text-text-primary">{wh.source}</td>
                    <td className="py-2.5 px-4 text-text-primary">{formatEvent(wh.event_type)}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-text-primary">{wh.resource_id}</td>
                    <td className="py-2.5 px-4">
                      {(() => {
                        const badge = activityBadge(wh.status, wh.ignore_reason);
                        return (
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 pl-4 text-right tabular-nums text-text-muted">
                      {wh.processed_at ? new Date(wh.processed_at).toLocaleString('pt-BR') : 'Na fila'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Toaster toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </main>
  );
}
