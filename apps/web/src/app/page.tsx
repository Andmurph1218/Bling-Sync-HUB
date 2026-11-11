'use client';

import React, { useEffect, useState } from 'react';
import { Toaster, ToastMessage } from '../components/toaster';
import Link from 'next/link';
import {
  Activity,
  FileText,
  Info,
  RefreshCw,
  Shield,
  Unlink,
} from 'lucide-react';
import {
  fetchOperationalState,
  OperationalStatePayload,
} from '../utils/operational-state';
import { EmptySkuNotice } from '../components/empty-sku-notice';
import { apiFetch } from '../utils/api-client';
import { useCurrentRole } from '../components/app-shell';
import { KpiCard } from '../components/home/kpi-card';
import { ActionCenterItem } from '../components/home/action-center-item';
import { OnboardingFunnel } from '../components/home/onboarding-funnel';

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

function formatActivityResult(status: string, reason: string | null): string {
  const normalized = status.toLowerCase();
  if (normalized === 'processed' || normalized === 'processado') return 'Sincronizado com sucesso';
  if (normalized === 'failed' || normalized === 'error' || normalized === 'erro') return 'Falha na sincronização';
  const detail = (reason ?? '').toLowerCase();
  if (detail.includes('idêntico_content') || detail.includes('identico_content') || detail.includes('identical')) {
    return 'Ignorado (sem alteração real)';
  }
  if (normalized === 'ignored') return 'Ignorado (sem alteração real)';
  return status;
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return 'sem registro';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} minuto${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `há ${days} dia${days === 1 ? '' : 's'}`;
}

export default function HomePage() {
  const { hasRole } = useCurrentRole();
  const [state, setState] = useState<OperationalStatePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);
  const [catalogHome, setCatalogHome] = useState<CatalogHome | null>(null);
  const [catalogHomeError, setCatalogHomeError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ status: 'idle' | 'processing' | 'completed' | 'failed'; total: number; processed: number } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [syncStarting, setSyncStarting] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

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

  const startEnrichment = async () => {
    setEnriching(true);
    try {
      await apiFetch('/api/admin/enrich-catalog', { method: 'POST' });
      const id = `toast-${Date.now()}`;
      setToasts((current) => [
        ...current,
        { id, variant: 'success', title: 'Enriquecimento iniciado em background' },
      ]);
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
  const linked = catalogHome?.linkedNuvemshop ?? 0;
  const coverage = products === 0 ? 0 : Math.round((linked / products) * 100);
  const queued = catalogHome?.cards.publicationsToday.queued ?? 0;
  const syncState = syncStatus?.status ?? 'idle';
  const syncRunning = syncState === 'processing' || syncStarting;
  const syncProcessed = syncStatus?.processed ?? 0;
  const syncTotal = syncStatus?.total ?? 0;
  const syncPercent = syncTotal > 0 ? Math.min(100, Math.round((syncProcessed / syncTotal) * 100)) : null;
  const syncSentence = syncTotal > 0
    ? `Sincronizando ${formatCount(syncProcessed)} de ${formatCount(syncTotal)}`
    : `Sincronizando ${formatCount(syncProcessed)} produtos`;
  const lastTouch = catalogHome?.lastBlingSync ?? catalogHome?.sync?.finishedAt ?? catalogHome?.lastSyncOk ?? null;
  const awaitingNcm = catalogHome?.fiscal?.awaitingNcm ?? state?.kpis.actionPendings.breakdown.ncmPendingFirst ?? 0;
  const awaitingEan = catalogHome?.fiscal?.awaitingEan ?? state?.kpis.actionPendings.breakdown.eanPending ?? 0;
  const fiscalConflicts = catalogHome?.fiscal?.conflicts ?? state?.kpis.actionPendings.breakdown.eanDuplicates ?? 0;
  const fiscalProducts = awaitingNcm + awaitingEan;
  const averageScore = catalogHome?.readiness?.averageScore ?? 0;
  const readyToPublish = catalogHome?.readiness?.readyToPublish ?? catalogHome?.cards.ready.value ?? 0;

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

      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">Visão Geral</h1>
            {hasRole('admin') && (
              <button
                type="button"
                onClick={() => void startSync()}
                disabled={syncRunning}
                aria-busy={syncRunning}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncRunning ? 'Sincronizando...' : 'Sincronizar ERP'}
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-text-muted">O que precisa de ação agora, lido do banco.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowTechDetails((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-xs font-medium text-text-muted"
          >
            <Info className="h-3.5 w-3.5" />
            <span>{showTechDetails ? 'Ocultar siglas' : 'Ver siglas'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary"
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
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-color border-l-4 border-l-rose-500 bg-bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <EmptySkuNotice />
            <span>{formatCount(state.emptySkuCount)} produto(s) sem SKU. Eles não entram na lista de envio.</span>
          </div>
          <Link href="/catalogo" className="text-xs font-semibold text-text-primary underline">Ver no catálogo</Link>
        </section>
      )}

      <section className="mt-6">
        <Link
          href="/problemas?filtro=duplicidades"
          className={`mb-4 block rounded-xl border px-4 py-4 ${
            duplicateCount > 0
              ? 'border-amber-500/50 bg-amber-500/15 text-amber-950 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-50'
              : 'border-border-color bg-bg-surface text-text-primary'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide">Duplicidades detectadas</p>
          <p className="mt-1 text-2xl font-bold">{formatCount(duplicateCount)}</p>
          <p className="mt-1 text-sm">
            {duplicateCount > 0
              ? 'SKU repetido no ERP ou anúncio que já existe no canal. Abra para resolver.'
              : 'Nenhuma colisão aberta no catálogo.'}
          </p>
        </Link>
        {catalogHomeError && <p className="mb-3 text-sm text-rose-700 dark:text-rose-200" role="alert">{catalogHomeError}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cobertura do catálogo"
            value={`${formatCount(products)} produtos`}
            hint={`${formatCount(linked)} vinculados à Nuvemshop`}
            href="/catalogo"
            accent="sky"
            progress={coverage}
          />
          <KpiCard
            label="Saúde da fila de sync"
            value={syncRunning ? (syncPercent === null ? 'Em andamento' : `${syncPercent}%`) : syncState === 'completed' ? 'Concluída' : syncState === 'failed' ? 'Falhou' : 'Parado'}
            hint={syncRunning ? syncSentence : `Última atualização: ${relativeTime(lastTouch)}`}
            href="/problemas"
            accent={syncRunning ? 'neutral' : syncState === 'failed' ? 'rose' : 'neutral'}
            pulse={syncRunning ? 'live' : syncState === 'idle' || syncState === 'failed' ? 'stopped' : null}
            progress={syncRunning ? syncPercent : null}
          >
            {syncRunning && (
              <p className="mt-3 text-xs text-text-primary" role="status">{syncSentence}</p>
            )}
            {!syncRunning && syncState !== 'completed' && (
              <p className="mt-3 text-xs text-text-muted">
                Nenhuma sincronização em andamento. Clique em Sincronizar para iniciar.
              </p>
            )}
            {hasRole('admin') && (
              <button
                type="button"
                onClick={() => void startSync()}
                disabled={syncRunning}
                aria-busy={syncRunning}
                className="mt-3 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncRunning ? 'Sincronizando...' : 'Sincronizar agora'}
              </button>
            )}
            {hasRole('admin') && (
              <button
                type="button"
                onClick={() => void startReconcile()}
                disabled={reconciling}
                className="mt-2 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reconciling ? 'Buscando vínculos...' : 'Sincronizar Vínculos (Reconciliação)'}
              </button>
            )}
            {hasRole('admin') && (
              <button
                type="button"
                onClick={() => void startEnrichment()}
                disabled={enriching}
                aria-busy={enriching}
                className="mt-2 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enriching ? 'Enriquecendo...' : 'Enriquecer Catálogo (ERP)'}
              </button>
            )}
          </KpiCard>
          <KpiCard
            label="Pendências fiscais"
            value={`${formatCount(fiscalProducts)} produtos`}
            hint={`${formatCount(awaitingNcm)} aguardando NCM | ${formatCount(awaitingEan)} aguardando EAN`}
            href="/fiscal"
            accent={fiscalConflicts > 0 ? 'rose' : fiscalProducts > 0 ? 'amber' : 'neutral'}
          />
          <KpiCard
            label="Ações hoje"
            value={`${formatCount(catalogHome?.cards.publicationsToday.sent ?? 0)} envios`}
            hint={`${formatCount(catalogHome?.cards.publicationsToday.failed ?? 0)} erros | ${formatCount(queued)} na fila`}
            href="/publicacoes"
            accent="amber"
          />
        </div>
        {syncNotice && <p className="mt-2 text-xs text-text-muted" role="status">{syncNotice}</p>}
      </section>

      {state && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-text-primary">O que precisa da sua atenção agora</h2>
              <p className="text-xs text-text-muted">Abra os detalhes só quando precisar do motivo e do impacto.</p>
            </div>
            <Link href="/pendencias" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">
              Resolver pendências
            </Link>
          </div>
          <ul className="mt-4 overflow-hidden rounded-xl border border-border-color bg-bg-surface">
            <ActionCenterItem
              icon={<Unlink className="h-4 w-4" />}
              tone="amber"
              title="Vínculos pendentes"
              count={state.kpis.actionPendings.breakdown.matchingSuggestions}
              href="/vinculos"
              reason="Só um sinal forte coincidiu. O HUB exige dois sinais concordantes para vincular sozinho."
              impact="Sem o vínculo, o HUB não envia melhoria de conteúdo para esses anúncios."
              tech={showTechDetails ? 'PIRE / matching_queue' : undefined}
            />
            <ActionCenterItem
              icon={<Shield className="h-4 w-4" />}
              tone={fiscalConflicts > 0 ? 'rose' : 'amber'}
              title="Bloqueio fiscal"
              count={fiscalProducts}
              href="/fiscal"
              reason="Produtos do Bling estão sem EAN válido ou aguardam a segunda aprovação de NCM."
              impact="Criação e atualização de conteúdo ficam bloqueadas. Estoque e pausa seguem livres."
              tech={showTechDetails ? 'GVE (EAN) + NVE (NCM)' : undefined}
            />
            <ActionCenterItem
              icon={<FileText className="h-4 w-4" />}
              tone="orange"
              title="Conteúdo incompleto"
              count={state.contentIncompleteCount}
              href="/completude"
              reason="Falta categoria, imagem de capa, descrição ou atributo exigido pela Nuvemshop."
              impact="O produto não fica apto para envio até a prontidão do canal fechar."
              tech={showTechDetails ? 'CRE' : undefined}
            />
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-text-primary">Ciclo do catálogo</h2>
        <p className="mt-1 text-xs text-text-muted">Do ERP até a Nuvemshop. A publicação fica bloqueada no modo simulação.</p>
        <div className="mt-4">
          <OnboardingFunnel
            steps={[
              {
                title: 'Importar ERP',
                detail: products > 0 ? `${formatCount(products)} produtos lidos do Bling` : 'Nenhum produto importado',
                percent: products > 0 ? 100 : 0,
                state: products > 0 ? 'done' : 'active',
              },
              {
                title: 'Enriquecer dados',
                detail: readyToPublish === 1
                  ? '1 produto atingiu o mínimo para publicação'
                  : `${formatCount(readyToPublish)} produtos atingiram o mínimo para publicação`,
                metric: `Score médio: ${averageScore}/100`,
                subtext: readyToPublish === 1
                  ? '1 produto atingiu o mínimo para publicação'
                  : `${formatCount(readyToPublish)} produtos atingiram o mínimo para publicação`,
                percent: averageScore,
                state: averageScore >= 100 ? 'done' : 'active',
              },
              {
                title: 'Publicar na Nuvemshop',
                detail: 'Aguardando aprovação de conteúdo',
                subtext: 'Aguardando aprovação de conteúdo',
                percent: shadow ? 0 : coverage,
                state: shadow ? 'blocked' : coverage >= 100 ? 'done' : 'active',
              },
            ]}
          />
        </div>
      </section>

      {state && (
        <section className="mt-8 rounded-xl border border-border-color bg-bg-surface p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-text-muted" />
              <h2 className="text-base font-bold text-text-primary">Atividade recente</h2>
            </div>
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
                    <td className="py-2.5 px-4 font-mono text-text-muted">{wh.event_type}</td>
                    <td className="py-2.5 px-4 font-mono text-text-primary">{wh.resource_id}</td>
                    <td className="py-2.5 px-4 text-text-muted">
                      {formatActivityResult(wh.status, wh.ignore_reason)}
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
