'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, AlertCircle, CheckCircle2, ShieldAlert, Lock, RefreshCw } from 'lucide-react';
import { TechTooltip } from '../../../components/tech-tooltip';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch, ApiError } from '../../../utils/api-client';

interface Reviewer {
  id: string;
  name: string;
  email: string;
}

interface NcmItem {
  id: string;
  blingId: string | null;
  sku: string | null;
  productName: string | null;
  currentNcm: string | null;
  proposedNcm: string;
  sourcePlatform: string;
  status: 'pending_first' | 'pending_second' | 'approved' | 'rejected' | 'expired' | string;
  firstReviewer: Reviewer | null;
  secondReviewer: Reviewer | null;
  tipiNote: string | null;
}

const formatNcm = (v: string | null) =>
  v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}` : v ?? '—';

export default function FiscalNcmPage() {
  const { currentUser, hasRole } = useCurrentRole();
  const [items, setItems] = useState<NcmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const canReview = hasRole('fiscal_approver');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch<{ items: NcmItem[] }>('/api/fiscal/ncm/suggestions');
      setItems(json.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? 'Seu papel não tem acesso à fila fiscal de NCM.'
          : 'Não foi possível carregar as sugestões de NCM da API local.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirm = async (item: NcmItem) => {
    const note = (notes[item.id] ?? '').trim();
    if (note.length < 3) {
      setFeedback({ tone: 'error', text: 'Informe a nota de consulta à TIPI antes de confirmar.' });
      return;
    }
    setBusyId(item.id);
    try {
      await apiFetch(`/api/fiscal/ncm/${item.id}/confirm`, { method: 'POST', json: { note } });
      setFeedback({
        tone: 'ok',
        text:
          item.status === 'pending_first'
            ? `1ª confirmação de ${formatNcm(item.proposedNcm)} registrada por ${currentUser.name}. Aguardando um segundo aprovador distinto.`
            : `2ª confirmação concluída: NCM ${formatNcm(item.proposedNcm)} gravado no produto e registrado em ncm_audit_log.`,
      });
      setNotes((prev) => ({ ...prev, [item.id]: '' }));
      await load();
    } catch (err) {
      setFeedback({
        tone: 'error',
        text:
          err instanceof ApiError && err.status === 409
            ? 'Você já fez a 1ª confirmação desta sugestão. A 2ª confirmação precisa ser feita por outro Revisor Fiscal.'
            : `Falha ao confirmar: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const statusBadge = (status: NcmItem['status']) => {
    switch (status) {
      case 'pending_first':
        return <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">Aguardando 1ª aprovação</span>;
      case 'pending_second':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
            <ShieldAlert className="h-3 w-3" /> Aguardando 2ª aprovação
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Aprovado (TIPI)
          </span>
        );
      default:
        return <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300">{status}</span>;
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Dupla Confirmação de NCM (<TechTooltip term="NVE" />)</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Cada NCM sugerido exige duas confirmações por Revisores Fiscais distintos, cada uma com nota obrigatória de consulta à TIPI. Enquanto isso, a publicação de conteúdo fica bloqueada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {!canReview && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <Lock className="h-4 w-4 text-amber-400" />
          <span>
            Seu papel atual (<strong>{currentUser.roleLabel}</strong>) tem acesso somente leitura. Apenas Revisores Fiscais confirmam NCM.
          </span>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`mt-6 flex items-center justify-between rounded-lg border px-4 py-3 text-xs ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="hover:text-white">Fechar</button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{loadError}</div>
      )}
      {loading && items.length === 0 && <p className="mt-6 text-sm text-zinc-400" role="status">Carregando sugestões de NCM...</p>}
      {!loading && !loadError && items.length === 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span>Nenhuma sugestão de NCM aguardando confirmação.</span>
        </div>
      )}

      {items.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Sugestões de NCM e estado da dupla confirmação</caption>
              <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3.5">SKU / Produto</th>
                  <th scope="col" className="px-4 py-3.5">NCM atual → proposto</th>
                  <th scope="col" className="px-4 py-3.5">Origem</th>
                  <th scope="col" className="px-4 py-3.5">1ª confirmação</th>
                  <th scope="col" className="px-4 py-3.5">2ª confirmação</th>
                  <th scope="col" className="px-4 py-3.5">Status</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {items.map((item) => {
                  const pending = item.status === 'pending_first' || item.status === 'pending_second';
                  const isOwnFirstReview = item.firstReviewer?.id === currentUser.id;
                  return (
                    <tr key={item.id} className="align-top hover:bg-zinc-900/80">
                      <td className="px-4 py-4">
                        <div className="font-mono text-xs font-semibold text-emerald-400">{item.sku || '(Sem SKU)'}</div>
                        {item.blingId ? (
                          <Link href={`/catalogo/${item.blingId}`} className="mt-0.5 block text-xs text-zinc-300 hover:underline">
                            {item.productName ?? `Produto #${item.blingId}`}
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs">
                        <span className="text-zinc-400">{formatNcm(item.currentNcm)}</span>
                        <span className="mx-1 text-zinc-500">→</span>
                        <span className="font-bold text-white">{formatNcm(item.proposedNcm)}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                          {item.sourcePlatform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs">
                        {item.firstReviewer ? (
                          <span className="text-emerald-300">{item.firstReviewer.name}</span>
                        ) : (
                          <span className="text-zinc-500">Pendente</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs">
                        {item.secondReviewer ? (
                          <span className="text-emerald-300">{item.secondReviewer.name}</span>
                        ) : item.status === 'pending_second' ? (
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <span>Aguardando um segundo aprovador distinto</span>
                          </div>
                        ) : (
                          <span className="text-zinc-500">Bloqueado até a 1ª revisão</span>
                        )}
                      </td>
                      <td className="px-4 py-4">{statusBadge(item.status)}</td>
                      <td className="px-4 py-4 text-right">
                        {pending && canReview ? (
                          isOwnFirstReview ? (
                            <span className="text-xs text-amber-300">Você já fez a 1ª confirmação</span>
                          ) : (
                            <div className="flex flex-col items-end gap-2">
                              <label htmlFor={`tipi-${item.id}`} className="sr-only">Nota de consulta à TIPI</label>
                              <textarea
                                id={`tipi-${item.id}`}
                                rows={2}
                                placeholder="Nota de consulta à TIPI (obrigatória)"
                                value={notes[item.id] ?? ''}
                                onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-56 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => void handleConfirm(item)}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {item.status === 'pending_first' ? 'Confirmar 1ª etapa' : 'Confirmar 2ª etapa'}
                              </button>
                            </div>
                          )
                        ) : item.status === 'approved' ? (
                          <span className="text-xs font-semibold text-emerald-400">Auditado em ncm_audit_log</span>
                        ) : (
                          <span className="text-xs text-zinc-500">Somente leitura</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
