'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Lock, RefreshCw, Shield, X } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { FiscalEmptyState } from '../../components/fiscal/fiscal-empty-state';

type Queue = 'ean' | 'ncm' | 'conflitos';

interface FiscalItem {
  id: string;
  queue: Queue;
  sku: string;
  name: string;
  proposed: string;
  origin: string;
  status: string;
  firstReviewerId: string | null;
  firstReviewerEmail: string | null;
  gs1Valid: boolean | null;
}

interface FiscalHub {
  counts: Record<Queue, number>;
  today: { approved: number; rejected: number; awaitingSecond: number };
  items: FiscalItem[];
}

const TABS: Array<{ id: Queue; label: string }> = [
  { id: 'ean', label: 'EAN Pendentes' },
  { id: 'ncm', label: 'NCM Dupla Aprovação' },
  { id: 'conflitos', label: 'Conflitos de Variante' },
];

function statusLabel(item: FiscalItem): string {
  if (item.queue === 'conflitos') return 'Conflito entre variantes';
  if (item.status === 'pending_second') {
    return `Aguardando 2ª aprovação (1º: ${item.firstReviewerEmail || 'outro revisor'})`;
  }
  if (item.queue === 'ncm') return 'Aguardando 1ª aprovação';
  return item.gs1Valid === false ? 'EAN com dígito GS1 inválido' : 'Aguardando validação';
}

export default function FiscalHubPage() {
  const { currentUser, hasPermission } = useCurrentRole();
  const [tab, setTab] = useState<Queue>('ean');
  const canReview = tab === 'ncm'
    ? hasPermission('fiscal:approve_ncm')
    : tab === 'ean'
      ? hasPermission('fiscal:approve_ean')
      : hasPermission('fiscal:approve_ean') || hasPermission('fiscal:approve_ncm');
  const [query, setQuery] = useState('');
  const [hub, setHub] = useState<FiscalHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setHub(await apiFetch<FiscalHub>('/api/fiscal/hub'));
      setError(null);
    } catch {
      setError('Não foi possível ler o centro fiscal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const aba = params.get('aba');
    if (aba === 'ean' || aba === 'ncm' || aba === 'conflitos') setTab(aba);
    setQuery(params.get('q') ?? '');
    void load();
  }, []);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (hub?.items ?? []).filter((item) => {
      if (item.queue !== tab) return false;
      if (!term) return true;
      return [item.sku, item.name, item.proposed].some((value) => value.toLowerCase().includes(term));
    });
  }, [hub, tab, query]);

  const count = hub?.counts[tab] ?? 0;
  const queueHasItems = (hub?.counts.ean ?? 0) + (hub?.counts.ncm ?? 0) + (hub?.counts.conflitos ?? 0) > 0;

  const decide = async (item: FiscalItem, decision: 'approve' | 'reject') => {
    if (!canReview) return;
    setNotice(null);
    if (item.queue === 'ean' && decision === 'approve' && item.gs1Valid === false) {
      setNotice('Este EAN não passa na validação do dígito GS1.');
      return;
    }
    let note = '';
    if (item.queue === 'ncm' && decision === 'approve') {
      note = window.prompt('Nota de consulta à TIPI (obrigatória):') ?? '';
      if (note.trim().length < 3) {
        setNotice('A aprovação de NCM exige a nota da TIPI.');
        return;
      }
    }
    if (decision === 'reject' && item.queue === 'ean') {
      const reason = window.prompt('Motivo da rejeição:');
      if (reason === null) return;
      note = reason;
    }
    setBusyId(item.id);
    try {
      if (item.queue === 'ean') {
        await apiFetch(`/api/fiscal/ean/${item.id}/review`, { method: 'POST', json: { decision, reason: note || undefined } });
      } else if (decision === 'approve') {
        await apiFetch(`/api/fiscal/ncm/${item.id}/confirm`, { method: 'POST', json: { note } });
      } else {
        await apiFetch(`/api/fiscal/ncm/${item.id}/reject`, { method: 'POST' });
      }
      setNotice(decision === 'approve' ? 'Decisão registrada.' : 'Item rejeitado.');
      await load();
    } catch {
      setNotice('Não foi possível registrar a decisão. Se for NCM, o segundo voto precisa ser de outro revisor.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Centro de Compliance Fiscal</h1>
          <p className="mt-1 text-sm text-text-muted">
            {MERCADO_LIVRE_ACTIVE
              ? 'EAN, NCM e conflitos de variante dos canais conectados.'
              : 'Mercado Livre desconectado. A fila mostra a Nuvemshop.'}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border-color px-3 py-2 text-xs font-semibold">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {!canReview && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Modo somente leitura. Administrador e Revisor Fiscal aprovam. Seu papel ({currentUser.roleLabel}) só consulta.
        </p>
      )}
      {queueHasItems && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm text-text-primary">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Regra Fiscal: Sugestões de NCM exigem duas aprovações de usuários distintos. Sugestões de EAN exigem validação de dígito GS1.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-200" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-text-muted" role="status">{notice}</p>}

      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map((item) => {
          const value = hub?.counts[item.id] ?? 0;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                active ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-border-color text-text-muted'
              }`}
            >
              {item.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${value > 0 ? 'bg-rose-600 text-white' : 'bg-bg-base text-text-muted'}`}>
                {value.toLocaleString('pt-BR')}
              </span>
            </button>
          );
        })}
      </div>

      {query && (
        <p className="mt-3 text-xs text-text-muted">
          Filtro vindo de Problemas: <span className="font-semibold text-text-primary">{query}</span>
          <button type="button" className="ml-2 underline" onClick={() => setQuery('')}>Limpar</button>
        </p>
      )}

      {!loading && count === 0 && !query && hub && (
        <FiscalEmptyState
          approvedToday={hub.today.approved}
          rejectedToday={hub.today.rejected}
          awaitingSecond={hub.today.awaitingSecond}
          subtitle={
            tab === 'conflitos'
              ? 'Nenhum conflito de NCM entre variantes no momento.'
              : tab === 'ncm'
                ? 'Nenhum NCM pendente da dupla aprovação para a Nuvemshop no momento.'
                : undefined
          }
        />
      )}

      {!loading && (count > 0 || query) && rows.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">Nenhum item desta aba corresponde ao filtro.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
              <tr className="h-10">
                <th className="px-4 font-semibold">Produto / SKU</th>
                <th className="px-3 font-semibold">Dado sugerido</th>
                <th className="px-3 font-semibold">Origem</th>
                <th className="px-3 font-semibold">Status da aprovação</th>
                <th className="px-4 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const ownFirstVote = item.status === 'pending_second' && item.firstReviewerId === currentUser.id;
                const conflict = item.queue === 'conflitos';
                const blocked = !canReview || ownFirstVote || conflict || busyId === item.id;
                return (
                  <tr key={`${item.queue}:${item.id}`} className="border-b border-border-color">
                    <td className="px-4 py-3">
                      <p className="max-w-xs truncate font-medium text-text-primary" title={item.name}>{item.name}</p>
                      <p className="font-mono text-[11px] text-text-muted">{item.sku}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{item.proposed}</td>
                    <td className="px-3 py-3 text-xs text-text-muted">{item.origin}</td>
                    <td className="px-3 py-3 text-xs text-text-primary">{statusLabel(item)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {ownFirstVote && <span className="self-center text-[11px] text-text-muted">Aguardando outro aprovador</span>}
                        {!conflict && (
                          <>
                            <button
                              type="button"
                              disabled={blocked || (item.queue === 'ean' && item.gs1Valid === false)}
                              title={item.gs1Valid === false ? 'O dígito GS1 não confere.' : undefined}
                              onClick={() => void decide(item, 'approve')}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Aprovar
                            </button>
                            <button
                              type="button"
                              disabled={blocked}
                              onClick={() => void decide(item, 'reject')}
                              className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" />
                              Rejeitar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
