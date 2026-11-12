'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Toaster, ToastMessage } from '../components/toaster';
import Link from 'next/link';
import { ChevronDown, RefreshCw, Shield } from 'lucide-react';
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
      className: 'border-border-color bg-bg-base text-text-muted',
    };
  }
  if (normalized === 'processed' || normalized === 'processado' || normalized === 'completed') {
    return {
      label: 'Sucesso',
      className: 'border-emerald-600/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
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

function healthTone(score: number): { bar: string; text: string } {
  if (score > 80) return { bar: 'bg-emerald-600', text: 'text-emerald-800 dark:text-emerald-200' };
  if (score > 50) return { bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-200' };
  return { bar: 'bg-rose-600', text: 'text-rose-800 dark:text-rose-200' };
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
  const [syncStatus, setSyncStatus] = useState<{ status: 'idle' | 'processing' | 'completed' | 'failed'; total: number; processed: number } | null>(null);
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
      const next = await apiFetch<{ status: 'idle' | 'processing' | 'completed' | 'failed'; total: number; processed: number }>(
        '/api/admin/sync-status'
      );
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
  const syncState = syncStatus?.status ?? 'idle';
  const syncRunning = syncState === 'processing' || syncStarting;
  const syncBusy = syncRunning || reconciling || enriching;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {shadow && (
        <div className="sticky top-16 z-40 -mx-6 mb-6 flex items-start gap-2 border-b border-sky-800/30 bg-sky-200 px-6 py-2.5 text-sm font-medium text-sky-950 shadow-sm dark:border-sky-300/30 dark:bg-sky-900 dark:text-sky-50">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>Modo Simulação (Shadow) Ativo: O HUB está validando os dados, mas nenhuma alteração está sendo enviada aos marketplaces.</p>
        </div>
      )}

      {forbidden && (
        <p role="alert" className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-100">
          Acesso negado (403). A loja de integrações é exclusiva do administrador.
        </p>
      )}

      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Visão Geral</h1>
          <p className="mt-1 max-w-xl text-sm text-text-muted">Quantos produtos estão prontos, o que ainda trava a venda e o estado dos canais.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {hasRole('admin') && (
            <div className="relative" ref={syncMenuRef}>
              <button
                type="button"
                aria-expanded={syncMenuOpen}
                aria-haspopup="menu"
                aria-busy={syncBusy}
                onClick={() => setSyncMenuOpen((open) => !open)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              >
                Sincronização
                <ChevronDown className={`h-4 w-4 transition ${syncMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {syncMenuOpen && (
                <div role="menu" className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border-color bg-bg-surface p-2 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.45)]">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={syncRunning}
                    onClick={() => void startSync()}
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-bg-base disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-text-primary">{syncRunning ? 'Sincronizando o ERP...' : 'Sync Completo ERP (Bling)'}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">Lê preço, estoque e cadastro do Bling.</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={reconciling}
                    onClick={() => void startReconcile()}
                    className="mt-1 block w-full rounded-lg px-3 py-2 text-left hover:bg-bg-base disabled:opacity-60"
                  >
                    <span className="block text-sm font-semibold text-text-primary">{reconciling ? 'Buscando vínculos...' : 'Reconciliação de Vínculos (Marketplaces)'}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">Encontra o anúncio pelo SKU e grava o vínculo.</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={enriching}
                    onClick={() => void startEnrichment()}
                    className="mt-1 block w-full rounded-lg px-3 py-2 text-left hover:bg-bg-base disabled:opacity-60"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {!state && (
        <p className="mt-6 text-sm text-text-muted" role="status">
          {loading ? 'Lendo o catálogo...' : loadError}
        </p>
      )}

      {state && state.emptySkuCount > 0 && (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-color bg-bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <EmptySkuNotice />
            <span>{formatCount(state.emptySkuCount)} produto(s) sem SKU. Eles não entram na lista de envio.</span>
          </div>
          <Link href="/catalogo" className="text-xs font-semibold text-text-primary underline">Ver no catálogo</Link>
        </section>
      )}

      <section className="mt-6">
        {catalogHomeError && <p className="mb-3 text-sm text-rose-700 dark:text-rose-200" role="alert">{catalogHomeError}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/catalogo" className="rounded-xl border border-border-color bg-bg-surface p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            <p className="text-sm font-semibold text-text-primary">Total no Catálogo</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-text-primary">{formatCount(products)}</p>
            <p className="mt-1 text-xs text-text-muted">{formatCount(readyToPublish)} produtos prontos para venda</p>
          </Link>
          <div className="rounded-xl border border-border-color bg-bg-surface p-4">
            <p className="text-sm font-semibold text-text-primary">Saúde do Catálogo</p>
            <p className={`mt-3 text-3xl font-bold tracking-tight ${tone.text}`}>{averageScore}% Completo</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-base" role="meter" aria-valuenow={averageScore} aria-valuemin={0} aria-valuemax={100} aria-label="Média de completude">
              <div className={`h-full ${tone.bar}`} style={{ width: `${Math.max(0, Math.min(100, averageScore))}%` }} />
            </div>
          </div>
          <div className="rounded-xl border border-border-color bg-bg-surface p-4">
            <p className="text-sm font-semibold text-text-primary">Ações Necessárias</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-text-primary">{formatCount(pendingActions)}</p>
            <p className="mt-1 text-xs text-text-muted">Fiscais, incompletos e duplicidades</p>
            <Link href="/problemas" className="mt-3 inline-flex rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
              Resolver Pendências
            </Link>
          </div>
          <div className="rounded-xl border border-border-color bg-bg-surface p-4">
            <p className="text-sm font-semibold text-text-primary">Canais Ativos</p>
            <ul className="mt-3 space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-text-primary">
                  <BrandLogo id="nuvemshop" name="Nuvemshop" size={22} />
                  Nuvemshop
                </span>
                <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCount(nuvemshopPublished)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-text-primary">
                  <BrandLogo id="mercadolivre" name="Mercado Livre" size={22} />
                  Mercado Livre
                </span>
                <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCount(mercadoLivrePublished)}</span>
              </li>
            </ul>
          </div>
        </div>
        {syncNotice && <p className="mt-3 text-xs text-text-muted" role="status">{syncNotice}</p>}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-text-primary">Ciclo do catálogo</h2>
        <div className="mt-4 rounded-xl border border-border-color bg-bg-surface p-5">
          <CatalogCycle
            imported={products > 0}
            enriching={enrichmentLive || enriching}
            shadow={shadow}
            canContinue={hasRole('admin')}
            continuing={enriching}
            onContinue={() => void startEnrichment()}
          />
        </div>
      </section>

      {state && (
        <section className="mt-8 rounded-xl border border-border-color bg-bg-surface p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <h2 className="text-base font-bold text-text-primary">Atividade recente</h2>
            <Link href="/auditoria" className="text-xs text-text-muted underline">Ver auditoria</Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border-color text-xs text-text-muted">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Origem</th>
                  <th className="pb-2 px-4 font-medium">Evento</th>
                  <th className="pb-2 px-4 font-medium">Recurso</th>
                  <th className="pb-2 px-4 font-medium">Resultado</th>
                  <th className="pb-2 pl-4 text-right font-medium">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-color/70">
                {state.recentWebhooks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-sm text-text-muted">
                      Nenhuma sincronização em andamento. Clique em Sincronizar para iniciar.
                    </td>
                  </tr>
                )}
                {state.recentWebhooks.map((wh) => (
                  <tr key={wh.id}>
                    <td className="py-2.5 pr-4 font-semibold uppercase text-text-primary">{wh.source}</td>
                    <td className="py-2.5 px-4 text-text-primary">{formatEvent(wh.event_type)}</td>
                    <td className="py-2.5 px-4 font-mono text-text-primary">{wh.resource_id}</td>
                    <td className="py-2.5 px-4">
                      {(() => {
                        const badge = activityBadge(wh.status, wh.ignore_reason);
                        return (
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 pl-4 text-right text-text-muted">
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
