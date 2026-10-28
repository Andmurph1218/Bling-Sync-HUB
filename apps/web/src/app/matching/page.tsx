'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Check,
  X,
  ShieldAlert,
  CheckCircle2,
  Ban,
  ExternalLink,
  Eye,
  Layers,
} from 'lucide-react';
import { TechTooltip } from '../../components/tech-tooltip';
import {
  MatchDetailsDrawer,
  MatchingComparisonItem,
} from '../../components/match-details-drawer';
import { Toaster, ToastMessage } from '../../components/toaster';
import {
  buildBlingProductUrl,
  buildChannelAnnouncementUrl,
  translateMatchingSignal,
} from '../../utils/matching-signals';
import { apiFetch, ApiError } from '../../utils/api-client';

interface QueueApiItem {
  queueId: string;
  platform: 'mercadolivre' | 'nuvemshop';
  platformProductId: string;
  mlModel: 'legacy_variations' | 'user_product' | null;
  familyId: string | null;
  familyName: string | null;
  itemStatus: string;
  bestScore: number | null;
  channel: {
    title: string;
    sku: string | null;
    ean: string | null;
    price: string | null;
    status: string | null;
    url: string | null;
  };
  candidate: {
    masterProductId: string;
    blingId: string | null;
    blingSku: string;
    name: string | null;
    ean: string | null;
    price: string | null;
    status: string | null;
    strongSignals: string[];
    auxiliarySignals: string[];
  } | null;
}

const money = (v: string | null) => (v ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '—');

function toComparisonItem(q: QueueApiItem): MatchingComparisonItem {
  const quarantine = q.itemStatus === 'quarantine';
  return {
    id: q.queueId,
    blingId: q.candidate?.blingId ?? '',
    blingSku: q.candidate ? q.candidate.blingSku || '(Sem SKU)' : '(sem candidato)',
    blingName: q.candidate?.name ?? 'Nenhum produto do Bling sugerido',
    blingEan: q.candidate?.ean ?? 'Ausente',
    blingPrice: money(q.candidate?.price ?? null),
    blingStatus: q.candidate?.status === 'active' ? 'Ativo' : q.candidate?.status ?? '—',
    channelId: q.platformProductId,
    platform: q.platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop',
    channelTitle: q.channel.title,
    channelSku: q.channel.sku ?? 'Não informado',
    channelEan: q.channel.ean ?? 'Não informado',
    channelPrice: money(q.channel.price),
    channelStatus: q.channel.status ?? '—',
    pireScore: q.bestScore ?? 0,
    strongSignals: [...(q.candidate?.strongSignals ?? []), ...(q.candidate?.auxiliarySignals ?? [])],
    status: quarantine ? 'Quarentena' : 'Sugestão',
    quarantineReason: quarantine
      ? 'Conflito de identidade (EAN compartilhado ou família ligada a mais de um produto do Bling). Exige decisão humana.'
      : undefined,
    masterProductId: q.candidate?.masterProductId ?? null,
    platformKey: q.platform,
    platformProductId: q.platformProductId,
    mlModel: q.mlModel,
    familyId: q.familyId,
    familyName: q.familyName,
    channelUrl: q.channel.url,
  };
}

export default function MatchingPage() {
  const [rows, setRows] = useState<MatchingComparisonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeDrawerItemId, setActiveDrawerItemId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback(
    (variant: 'success' | 'warning', title: string, description?: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, variant, title, description }]);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch<{ items: QueueApiItem[] }>('/api/matching/queue');
      setRows(json.items.map(toComparisonItem));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? 'Seu papel não tem acesso à fila de correspondências (restrita a Operador e Administrador).'
          : 'Não foi possível carregar a fila de correspondências da API local.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const resolve = async (
    row: MatchingComparisonItem,
    action: 'confirm' | 'reject_candidate',
    reason?: string
  ): Promise<boolean> => {
    if (!row.masterProductId || !row.platformKey || !row.platformProductId) return false;
    try {
      await apiFetch('/api/matching/resolve', {
        method: 'POST',
        json: {
          platform: row.platformKey,
          platformProductId: row.platformProductId,
          action,
          masterProductId: row.masterProductId,
          reason,
          ...(row.mlModel ? { mlModel: row.mlModel } : {}),
          ...(row.familyId ? { familyId: row.familyId } : {}),
          ...(row.familyName ? { familyName: row.familyName } : {}),
        },
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, resolution: action === 'confirm' ? 'confirmed' : 'rejected', rejectionReason: reason }
            : r
        )
      );
      setSelectedIds((prev) => prev.filter((id) => id !== row.id));
      return true;
    } catch (err) {
      pushToast(
        'warning',
        'Não foi possível registrar a decisão.',
        err instanceof Error ? err.message : row.channelId
      );
      return false;
    }
  };

  const handleConfirmSingle = async (row: MatchingComparisonItem) => {
    if (await resolve(row, 'confirm')) {
      pushToast(
        'success',
        'Vínculo confirmado e gravado em platform_links.',
        `${row.blingSku} ↔ ${row.channelId} (${row.platform}). Nenhuma escrita foi feita no canal.`
      );
    }
  };

  const handleRejectSingle = async (row: MatchingComparisonItem, reason?: string) => {
    if (await resolve(row, 'reject_candidate', reason)) {
      pushToast(
        'warning',
        'Par rejeitado. O produto não voltará a ser sugerido para este anúncio.',
        reason
          ? `Motivo gravado em match_rejections: ${reason}`
          : `Par (${row.blingSku}, ${row.channelId}) gravado em match_rejections.`
      );
    }
  };

  const runBulk = async (action: 'confirm' | 'reject_candidate') => {
    const targets = rows.filter((r) => selectedIds.includes(r.id) && !r.resolution);
    setBusy(true);
    let ok = 0;
    for (const row of targets) {
      if (await resolve(row, action, action === 'reject_candidate' ? 'Rejeição em lote' : undefined)) ok += 1;
    }
    setBusy(false);
    setSelectedIds([]);
    pushToast(
      action === 'confirm' ? 'success' : 'warning',
      action === 'confirm' ? `${ok} vínculo(s) confirmado(s).` : `${ok} par(es) rejeitado(s) permanentemente.`,
      ok < targets.length ? `${targets.length - ok} item(ns) sem candidato ou com erro foram ignorados.` : undefined
    );
  };

  const handleBulkConfirm = () => void runBulk('confirm');
  const handleBulkReject = () => void runBulk('reject_candidate');

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectableRows = rows.filter((r) => !r.resolution && r.masterProductId);
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selectedIds.includes(r.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableRows.map((r) => r.id));
    }
  };

  const activeDrawerItem =
    rows.find((r) => r.id === activeDrawerItemId) ?? null;
  const suggestionCount = rows.filter((r) => !r.resolution && r.status === 'Sugestão').length;
  const quarantineCount = rows.filter((r) => !r.resolution && r.status === 'Quarentena').length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Fila de Matching Explicável (<TechTooltip term="PIRE" /> /{' '}
            <TechTooltip term="VIR" />)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Clique em qualquer linha para abrir a comparação lado a lado. Recusas gravam par permanente em{' '}
            <TechTooltip term="match_rejections" />.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-medium text-amber-300">
            {suggestionCount} Sugestões
          </span>
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 font-medium text-rose-300">
            {quarantineCount} em Quarentena
          </span>
        </div>
      </header>

      {/* Barra de Ações em Massa (Bulk Actions) */}
      {selectedIds.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-zinc-900/95 px-5 py-3 shadow-lg">
          <div className="flex items-center gap-2.5 text-xs">
            <Layers className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-white">
              {selectedIds.length} item(ns) selecionado(s)
            </span>
            <span className="text-zinc-400">
              · Aplique uma decisão em lote na fila do PIRE
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBulkConfirm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <Check className="h-3.5 w-3.5" />
              Confirmar Selecionados
            </button>
            <button
              type="button"
              onClick={handleBulkReject}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/15 px-3.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25"
            >
              <X className="h-3.5 w-3.5" />
              Rejeitar Selecionados
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {loadError}
        </div>
      )}
      {loading && rows.length === 0 && (
        <p className="mt-6 text-sm text-zinc-400" role="status">Carregando fila de correspondências...</p>
      )}
      {!loading && !loadError && rows.length === 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span>Nenhum anúncio aguardando decisão de vínculo.</span>
        </div>
      )}

      {/* DataTable Explicável */}
      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="w-10 px-4 py-3.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Selecionar todos da fila"
                    className="h-4 w-4 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                  />
                </th>
                <th className="px-4 py-3.5">Produto Bling (SKU / Nome)</th>
                <th className="px-4 py-3.5">Anúncio no Canal</th>
                <th className="px-4 py-3.5">
                  Score <TechTooltip term="PIRE" />
                </th>
                <th className="px-4 py-3.5">Sinais Fortes (Explicação)</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.map((row) => {
                const isQuarantine = row.status === 'Quarentena';
                const isSelected = selectedIds.includes(row.id);
                const blingUrl = buildBlingProductUrl(row.blingId);
                const channelUrl = buildChannelAnnouncementUrl(
                  row.platform,
                  row.channelId
                );

                return (
                  <tr
                    key={row.id}
                    onClick={() => setActiveDrawerItemId(row.id)}
                    className={`cursor-pointer transition ${
                      isQuarantine
                        ? 'bg-rose-950/20 hover:bg-rose-950/35'
                        : isSelected
                        ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                        : 'hover:bg-zinc-900/90'
                    }`}
                  >
                    {/* Checkbox */}
                    <td
                      className="px-4 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        disabled={Boolean(row.resolution) || !row.masterProductId || busy}
                        checked={isSelected}
                        onChange={() => toggleSelectRow(row.id)}
                        aria-label={`Selecionar ${row.blingSku}`}
                        className="h-4 w-4 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>

                    {/* Produto Bling + Deep Link */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-emerald-400">
                          {row.blingSku}
                        </span>
                        <a
                          href={blingUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Abrir cadastro do produto no Bling"
                          className="inline-flex items-center text-zinc-400 hover:text-emerald-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-200">
                        {row.blingName}
                      </div>
                    </td>

                    {/* Anúncio no Canal + Deep Link */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-medium text-white">
                          {row.channelId}
                        </span>
                        <a
                          href={channelUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Abrir anúncio em ${row.platform}`}
                          className="inline-flex items-center text-zinc-400 hover:text-sky-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <span className="mt-0.5 inline-block rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {row.platform}
                      </span>
                    </td>

                    {/* Score PIRE */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold ${
                          row.pireScore >= 90
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : row.pireScore >= 75
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {row.pireScore} / 100
                      </span>
                    </td>

                    {/* Sinais Fortes Traduzidos */}
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {row.strongSignals.map((sig) => {
                          const tr = translateMatchingSignal(sig);
                          const badgeStyle =
                            tr.tone === 'positive'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : tr.tone === 'conflict'
                              ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                              : 'border-amber-500/40 bg-amber-500/15 text-amber-200';
                          const dotStyle =
                            tr.tone === 'positive'
                              ? 'bg-emerald-400'
                              : tr.tone === 'conflict'
                              ? 'bg-rose-400'
                              : 'bg-amber-400';

                          return (
                            <span
                              key={sig}
                              title={`Código técnico: ${tr.raw}`}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${badgeStyle}`}
                            >
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${dotStyle}`}
                              />
                              {tr.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      {row.status === 'Sugestão' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                          Sugestão
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Quarentena
                          </span>
                          {row.quarantineReason && (
                            <p className="mt-1 max-w-xs text-[11px] text-rose-200/80">
                              {row.quarantineReason}
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Ações na Linha */}
                    <td
                      className="px-4 py-4 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.resolution === 'confirmed' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          Vínculo Confirmado
                        </span>
                      ) : row.resolution === 'rejected' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                          <Ban className="h-4 w-4" />
                          Gravado em match_rejections
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveDrawerItemId(row.id)}
                            title="Comparar lado a lado"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Comparar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleConfirmSingle(row)}
                            disabled={!row.masterProductId || busy}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Confirmar Vínculo
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRejectSingle(row)}
                            disabled={!row.masterProductId || busy}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                            Rejeitar Par
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

      {/* Drawer Lateral de Comparação Lado a Lado */}
      <MatchDetailsDrawer
        item={activeDrawerItem}
        onClose={() => setActiveDrawerItemId(null)}
        onConfirm={handleConfirmSingle}
        onReject={handleRejectSingle}
      />

      {/* Sistema de Toasts */}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
