'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCurrentRole } from '../../../components/app-shell';
import { ApiError, apiFetch } from '../../../utils/api-client';
import { NcmApprovalTable } from '../../../components/fiscal/ncm/ncm-approval-table';
import { NcmAuditHistory } from '../../../components/fiscal/ncm/ncm-audit-history';
import { NcmDetailsDrawer } from '../../../components/fiscal/ncm/ncm-details-drawer';
import { formatNcm, NcmHistoryRow, NcmItem, NcmMetrics } from '../../../components/fiscal/ncm/types';

type Tab = 'pendencias' | 'historico';

const EMPTY_METRICS: NcmMetrics = { pendingFirst: 0, pendingSecond: 0, approved30d: 0, rejected30d: 0 };

export default function FiscalNcmPage() {
  const { currentUser, hasPermission } = useCurrentRole();
  const canReview = hasPermission('fiscal:approve_ncm');
  const [tab, setTab] = useState<Tab>('pendencias');
  const [items, setItems] = useState<NcmItem[]>([]);
  const [history, setHistory] = useState<NcmHistoryRow[]>([]);
  const [metrics, setMetrics] = useState<NcmMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openItem, setOpenItem] = useState<NcmItem | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch<{ items: NcmItem[]; history?: NcmHistoryRow[]; metrics?: NcmMetrics }>('/api/fiscal/ncm/suggestions');
      setItems(json.items);
      setHistory(json.history ?? []);
      setMetrics(json.metrics ?? EMPTY_METRICS);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 403 ? 'Seu papel não tem acesso à fila fiscal de NCM.' : 'Não foi possível carregar as sugestões de NCM.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const pending = items.filter((item) => item.status === 'pending_first' || item.status === 'pending_second');
  const cards = [
    { label: 'Pendentes de 1ª aprovação', value: metrics.pendingFirst, className: 'text-orange-700 dark:text-orange-300' },
    { label: 'Aguardando 2ª aprovação', value: metrics.pendingSecond, className: 'text-amber-700 dark:text-amber-200' },
    { label: 'Aprovados (30d)', value: metrics.approved30d, className: 'text-emerald-700 dark:text-emerald-300' },
    { label: 'Rejeitados (30d)', value: metrics.rejected30d, className: 'text-rose-700 dark:text-rose-300' },
  ];

  const decide = async (item: NcmItem, decision: 'approve' | 'reject', note: string) => {
    if (decision === 'approve' && item.firstReviewer?.id === currentUser.id) {
      setFeedback({ tone: 'error', text: 'Você já fez a 1ª confirmação. A 2ª precisa ser de outro revisor.' });
      return;
    }
    try {
      if (decision === 'approve') {
        await apiFetch(`/api/fiscal/ncm/${item.id}/confirm`, { method: 'POST', json: { note } });
      } else {
        await apiFetch(`/api/fiscal/ncm/${item.id}/reject`, { method: 'POST', json: { note } });
      }
      setFeedback({
        tone: 'ok',
        text: decision === 'reject'
          ? `Sugestão ${formatNcm(item.proposedNcm)} rejeitada.`
          : item.status === 'pending_first'
            ? `1ª confirmação registrada por ${currentUser.name}. Falta outro revisor.`
            : `2ª confirmação concluída. NCM ${formatNcm(item.proposedNcm)} gravado.`,
      });
      setOpenItem(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      await load();
    } catch (err) {
      setFeedback({
        tone: 'error',
        text: err instanceof ApiError && err.status === 409
          ? 'Você já aprovou este item. Outro revisor precisa concluir.'
          : 'Não foi possível registrar a decisão.',
      });
    }
  };

  const approveSelected = async () => {
    if (bulkNote.trim().length < 3) {
      setFeedback({ tone: 'error', text: 'A aprovação em lote exige a nota da consulta à TIPI.' });
      return;
    }
    const chosen = pending.filter((item) => selected.has(item.id));
    const blocked = chosen.filter((item) => item.firstReviewer?.id === currentUser.id);
    const allowed = chosen.filter((item) => item.firstReviewer?.id !== currentUser.id);
    for (const item of allowed) {
      try {
        await apiFetch(`/api/fiscal/ncm/${item.id}/confirm`, { method: 'POST', json: { note: bulkNote.trim() } });
      } catch (err) {
        setFeedback({
          tone: 'error',
          text: err instanceof ApiError && err.status === 409
            ? `${item.sku || 'Item'} já foi aprovado por você.`
            : 'A aprovação em lote parou numa sugestão que não pôde ser confirmada.',
        });
        await load();
        return;
      }
    }
    setBulkNote('');
    setSelected(new Set());
    setFeedback({
      tone: blocked.length > 0 ? 'error' : 'ok',
      text: blocked.length > 0
        ? `${allowed.length} confirmada(s). ${blocked.length} ficaram de fora porque você já deu o primeiro voto.`
        : `${allowed.length} sugestão(ões) confirmada(s).`,
    });
    await load();
  };

  const productHistory = useMemo(
    () => (openItem ? history.filter((row) => row.master_product_id === openItem.productId) : []),
    [history, openItem]
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 pb-28">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Centro de Compliance Fiscal</h1>
          <p className="mt-1 text-sm text-text-muted">Cada NCM exige dois revisores diferentes e a nota da consulta à TIPI.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3">
            <p className={`text-2xl font-bold tabular-nums ${card.className}`}>{card.value.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-xs text-text-muted">{card.label}</p>
          </div>
        ))}
      </div>

      {!canReview && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
          <Lock className="h-4 w-4" />
          Modo somente leitura. Aprovar NCM exige a permissão correspondente. Seu papel ({currentUser.roleLabel}) só consulta.
        </p>
      )}
      {feedback && (
        <p role="status" className={`mt-4 text-sm ${feedback.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600'}`}>{feedback.text}</p>
      )}
      {loadError && <p role="alert" className="mt-4 text-sm text-rose-600">{loadError}</p>}

      <div className="mt-5 flex gap-1 border-b border-border-color" role="tablist">
        {([['pendencias', 'Pendências'], ['historico', 'Histórico']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-emerald-600 font-semibold text-text-primary' : 'border-transparent text-text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pendencias' && !loading && pending.length === 0 && !loadError && (
        <div className="mx-auto mt-8 flex max-w-lg flex-col items-center rounded-xl border border-border-color bg-bg-surface px-6 py-10 text-center">
          <ShieldCheck className="h-14 w-14 text-emerald-600 dark:text-emerald-400" />
          <h2 className="mt-4 text-xl font-semibold">Tudo em conformidade!</h2>
          <p className="mt-2 text-sm text-text-muted">Nenhuma sugestão de NCM aguardando revisão.</p>
          <button type="button" onClick={() => setTab('historico')} className="mt-5 rounded-lg border border-border-color px-3 py-2 text-xs font-semibold">
            Ver Histórico de Auditoria
          </button>
        </div>
      )}

      {tab === 'pendencias' && pending.length > 0 && (
        <div className="mt-4">
          <NcmApprovalTable
            items={pending}
            selected={selected}
            canReview={canReview}
            currentUserId={currentUser.id}
            onToggle={(id) => setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onToggleAll={() => setSelected(pending.every((item) => selected.has(item.id)) ? new Set() : new Set(pending.filter((item) => item.firstReviewer?.id !== currentUser.id).map((item) => item.id)))}
            onOpen={setOpenItem}
            onApprove={setOpenItem}
            onReject={setOpenItem}
          />
        </div>
      )}

      {tab === 'historico' && <div className="mt-4"><NcmAuditHistory rows={history} /></div>}

      {selected.size > 0 && canReview && tab === 'pendencias' && (
        <div className="fixed bottom-6 left-1/2 z-40 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border-color bg-bg-base px-4 py-2 text-xs shadow-2xl">
          <span className="font-semibold">{selected.size} selecionada(s)</span>
          <input
            value={bulkNote}
            onChange={(event) => setBulkNote(event.target.value)}
            placeholder="Nota da TIPI para o lote"
            className="min-w-48 flex-1 rounded-full border border-border-color bg-bg-surface px-3 py-1"
          />
          <button type="button" onClick={() => void approveSelected()} className="rounded-full bg-emerald-700 px-3 py-1 font-semibold text-white">Aprovar selecionados</button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-text-muted underline">Limpar</button>
        </div>
      )}

      {openItem && (
        <NcmDetailsDrawer
          item={openItem}
          history={productHistory}
          canReview={canReview}
          blockedOwnVote={openItem.firstReviewer?.id === currentUser.id}
          onClose={() => setOpenItem(null)}
          onApprove={(note) => void decide(openItem, 'approve', note)}
          onReject={(note) => void decide(openItem, 'reject', note)}
        />
      )}
    </main>
  );
}
