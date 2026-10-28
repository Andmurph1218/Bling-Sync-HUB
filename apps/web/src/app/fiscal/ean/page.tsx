'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Lock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { TechTooltip } from '../../../components/tech-tooltip';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch, ApiError } from '../../../utils/api-client';

interface EanItem {
  id: string;
  blingId: string | null;
  productName: string | null;
  variantSku: string | null;
  currentEan: string | null;
  eanStatus: string | null;
  proposedEan: string;
  sourcePlatform: string;
  expiresAt: string;
  gs1: {
    valid: boolean;
    isPlaceholder: boolean;
    contextType: string | null;
    reason: string | null;
  };
  decision?: 'approved' | 'rejected';
}

const CONTEXT_LABELS: Record<string, string> = {
  gs1_brasil: 'GS1 Brasil (789/790)',
  isbn_issn: 'ISBN/ISSN (977–979)',
  internal_range: 'Faixa interna (200–299)',
  gs1_international: 'GS1 internacional',
};

const REASON_LABELS: Record<string, string> = {
  empty: 'Código vazio',
  non_numeric: 'Contém caracteres não numéricos',
  invalid_length: 'Tamanho inválido (aceito: 8, 12, 13 ou 14 dígitos)',
  placeholder_repeated: 'Placeholder: dígitos repetidos',
  placeholder_sequence: 'Placeholder: sequência numérica',
  invalid_check_digit: 'Dígito verificador GS1 incorreto',
};

function gs1Badge(item: EanItem): { label: string; className: string; detail: string } {
  if (item.gs1.valid) {
    return {
      label: 'Válido',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      detail: `${CONTEXT_LABELS[item.gs1.contextType ?? ''] ?? 'GS1'} · Mod-10 OK`,
    };
  }
  if (item.gs1.isPlaceholder) {
    return {
      label: 'Placeholder',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      detail: REASON_LABELS[item.gs1.reason ?? ''] ?? 'Código genérico rejeitado',
    };
  }
  return {
    label: 'Inválido',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    detail: REASON_LABELS[item.gs1.reason ?? ''] ?? 'Falha na validação GS1',
  };
}

export default function FiscalEanPage() {
  const { currentUser, hasRole } = useCurrentRole();
  const [items, setItems] = useState<EanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canReviewFiscal = hasRole('fiscal_approver');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch<{ items: EanItem[] }>('/api/fiscal/ean/pending');
      setItems(json.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? 'Seu papel não tem acesso à fila fiscal de EAN.'
          : 'Não foi possível carregar a fila de EAN da API local.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDecision = async (item: EanItem, decision: 'approve' | 'reject') => {
    if (!canReviewFiscal) return;
    let reason: string | undefined;
    if (decision === 'reject') {
      reason = window.prompt('Motivo da rejeição (registrado no histórico fiscal):') ?? undefined;
      if (reason === undefined) return;
    }
    setBusyId(item.id);
    try {
      await apiFetch(`/api/fiscal/ean/${item.id}/review`, {
        method: 'POST',
        json: { decision, reason },
      });
      setItems((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, decision: decision === 'approve' ? 'approved' : 'rejected' } : r))
      );
      setFeedback({
        tone: 'ok',
        text:
          decision === 'approve'
            ? `EAN ${item.proposedEan} aprovado por ${currentUser.name} e gravado na variante ${item.variantSku ?? ''} (histórico em ean_validation_history).`
            : `EAN ${item.proposedEan} rejeitado por ${currentUser.name}; cadastro do Bling preservado.`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        text:
          err instanceof ApiError && err.status === 409
            ? 'Esta proposta já foi decidida por outro revisor. Atualize a fila.'
            : `Falha ao registrar a decisão: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Fila Fiscal de EAN / GTIN (<TechTooltip term="GVE" />)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            EAN vindo dos marketplaces permanece como sugestão até aprovação humana. O HUB nunca preenche o Bling automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
            Aprovação exige papel Revisor Fiscal
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </header>

      {!canReviewFiscal && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <Lock className="h-4 w-4 text-amber-400" />
          <span>
            Seu papel atual (<strong>{currentUser.roleLabel}</strong>) tem acesso somente leitura. Apenas usuários com papel{' '}
            <strong>Revisor Fiscal</strong> podem aprovar ou rejeitar EAN.
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
          <button type="button" onClick={() => setFeedback(null)} className="hover:text-white">
            Fechar
          </button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {loadError}
        </div>
      )}
      {loading && items.length === 0 && (
        <p className="mt-6 text-sm text-zinc-400" role="status">Carregando propostas de EAN...</p>
      )}
      {!loading && !loadError && items.length === 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span>
            Nenhuma proposta de EAN externo aguardando revisão. Variantes sem EAN no Bling aparecem na{' '}
            <Link href="/pendencias" className="underline">Central de Pendências</Link>.
          </span>
        </div>
      )}

      {items.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Propostas de EAN aguardando revisão fiscal</caption>
              <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3.5">SKU / Produto</th>
                  <th scope="col" className="px-4 py-3.5">EAN atual (Bling)</th>
                  <th scope="col" className="px-4 py-3.5">EAN proposto</th>
                  <th scope="col" className="px-4 py-3.5">Validação GS1</th>
                  <th scope="col" className="px-4 py-3.5">Origem</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {items.map((item) => {
                  const badge = gs1Badge(item);
                  return (
                    <tr key={item.id} className="hover:bg-zinc-900/80">
                      <td className="px-4 py-4">
                        <div className="font-mono text-xs font-semibold text-emerald-400">{item.variantSku || '(Sem SKU)'}</div>
                        {item.blingId ? (
                          <Link href={`/catalogo/${item.blingId}`} className="mt-0.5 block text-xs text-zinc-200 hover:underline">
                            {item.productName ?? `Produto #${item.blingId}`}
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-400">Produto não localizado</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-zinc-300">{item.currentEan || 'Ausente'}</td>
                      <td className="px-4 py-4 font-mono text-xs font-bold text-white">{item.proposedEan}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                        <div className="mt-1 text-[11px] text-zinc-400">{badge.detail}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                          {item.sourcePlatform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {item.decision === 'approved' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" /> Aprovado
                          </span>
                        ) : item.decision === 'rejected' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                            <XCircle className="h-4 w-4" /> Rejeitado
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!canReviewFiscal || !item.gs1.valid || busyId === item.id}
                              title={!item.gs1.valid ? 'Apenas EAN com validação GS1 válida pode ser aprovado' : undefined}
                              onClick={() => void handleDecision(item, 'approve')}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check className="h-3.5 w-3.5" /> Aprovar
                            </button>
                            <button
                              type="button"
                              disabled={!canReviewFiscal || busyId === item.id}
                              onClick={() => void handleDecision(item, 'reject')}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" /> Rejeitar
                            </button>
                          </div>
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
