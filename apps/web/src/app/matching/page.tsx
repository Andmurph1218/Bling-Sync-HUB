'use client';

import React, { useState, useCallback } from 'react';
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

const INITIAL_MATCHING_ROWS: MatchingComparisonItem[] = [
  // Caso 1: Match com score 95 (SKU e Nome batendo — 2 sinais fortes concordantes)
  {
    id: 'mq-1',
    blingId: '16723377536',
    blingSku: 'Mercurio 400w e40',
    blingName: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    blingEan: '7891234567895',
    blingPrice: 'R$ 89,90',
    blingStatus: 'Ativo',
    channelId: 'MLB3948172610',
    platform: 'Mercado Livre',
    channelTitle: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    channelSku: 'Mercurio 400w e40',
    channelEan: '7891234567895',
    channelPrice: 'R$ 89,90',
    channelStatus: 'Ativo',
    pireScore: 95,
    strongSignals: ['sku_exact', 'name_jw: 96'],
    status: 'Sugestão',
  },
  // Caso 2: Match onde o SKU é idêntico, mas o Nome é completamente divergente (anúncio reutilizado)
  {
    id: 'mq-2',
    blingId: '16722020114',
    blingSku: '13621',
    blingName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un.',
    blingEan: '7898912345601',
    blingPrice: 'R$ 142,00',
    blingStatus: 'Ativo',
    channelId: 'NS-314517886',
    platform: 'Nuvemshop',
    channelTitle: 'Disjuntor Bipolar DIN 40A Curva C (Anúncio Reutilizado)',
    channelSku: '13621',
    channelEan: '7890009998887',
    channelPrice: 'R$ 39,90',
    channelStatus: 'Ativo',
    pireScore: 78,
    strongSignals: ['sku_exact', 'title_divergent_warning'],
    status: 'Sugestão',
  },
  // Caso 3: Match em quarentena com EAN conflitante (mais de um dono no Bling)
  {
    id: 'mq-3',
    blingId: '16719381290',
    blingSku: 'CONT-AUX-2NA2NF',
    blingName: 'CONTATOR AUXILIAR 2NA+2NF 220V',
    blingEan: '7896543210988',
    blingPrice: 'R$ 64,50',
    blingStatus: 'Ativo',
    channelId: 'MLB4019283711',
    platform: 'Mercado Livre',
    channelTitle: 'Contator Auxiliar 2NA+2NF Bobina 220V Industrial',
    channelSku: 'CONT-AUX-ML',
    channelEan: '7896543210988',
    channelPrice: 'R$ 68,00',
    channelStatus: 'Ativo',
    pireScore: 42,
    strongSignals: ['ean_shared_conflict', 'name_jw: 92'],
    status: 'Quarentena',
    quarantineReason:
      'EAN 7896543210988 compartilhado entre dois master_products distintos no Bling (bloqueado até desempate humano).',
  },
  // Caso 4: Sugestão por alta similaridade de nome (sinal único <= 80)
  {
    id: 'mq-4',
    blingId: '16722891360',
    blingSku: 'Infra Ray 220V 250W',
    blingName: 'Lâmpada Infravermelha 220V Aquecimento Secagem 250W',
    blingEan: '7894445556661',
    blingPrice: 'R$ 54,90',
    blingStatus: 'Ativo',
    channelId: 'NS-314532102',
    platform: 'Nuvemshop',
    channelTitle: 'Lâmpada Infravermelha 250W 220V Secagem Industrial',
    channelSku: 'INFRA-250-220',
    channelEan: '7894445556661',
    channelPrice: 'R$ 54,90',
    channelStatus: 'Ativo',
    pireScore: 80,
    strongSignals: ['name_jw: 92'],
    status: 'Sugestão',
  },
  // Caso 5: Família User Product em quarentena no ML
  {
    id: 'mq-5',
    blingId: '16723148832',
    blingSku: 'Infra Ray 220V 250W - Kit 5',
    blingName: 'Kit 5 un. Lâmpada Infravermelha 220V Aquecimento Secagem 250W',
    blingEan: '7894445557774',
    blingPrice: 'R$ 249,00',
    blingStatus: 'Ativo',
    channelId: 'MLBU-FAM-882910',
    platform: 'Mercado Livre',
    channelTitle: 'Kit Lâmpada Infravermelha 250W (Família User Product)',
    channelSku: 'KIT5-INFRA-220',
    channelEan: 'Não informado',
    channelPrice: 'R$ 259,00',
    channelStatus: 'Ativo',
    pireScore: 45,
    strongSignals: ['family_multi_parent_conflict'],
    status: 'Quarentena',
    quarantineReason:
      'Itens da mesma family_id apontam para 2 produtos pais diferentes no Bling; o hub nunca parte a família.',
  },
];

export default function MatchingPage() {
  const [rows, setRows] = useState<MatchingComparisonItem[]>(INITIAL_MATCHING_ROWS);
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

  const handleConfirmSingle = (row: MatchingComparisonItem) => {
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, resolution: 'confirmed' } : r))
    );
    setSelectedIds((prev) => prev.filter((id) => id !== row.id));
    pushToast(
      'success',
      'Vínculo confirmado com sucesso! Push de conteúdo será agendado.',
      `${row.blingSku} ↔ ${row.channelId} (${row.platform})`
    );
  };

  const handleRejectSingle = (row: MatchingComparisonItem, reason?: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? { ...r, resolution: 'rejected', rejectionReason: reason }
          : r
      )
    );
    setSelectedIds((prev) => prev.filter((id) => id !== row.id));
    pushToast(
      'warning',
      'Par rejeitado. O produto não voltará a ser sugerido para este anúncio.',
      reason
        ? `Motivo gravado em match_rejections: ${reason}`
        : `Par (${row.blingSku}, ${row.channelId}) gravado em match_rejections.`
    );
  };

  const handleBulkConfirm = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.includes(r.id) ? { ...r, resolution: 'confirmed' } : r
      )
    );
    setSelectedIds([]);
    pushToast(
      'success',
      'Vínculo confirmado com sucesso! Push de conteúdo será agendado.',
      `${count} item(ns) confirmados em lote e vinculados em platform_links.`
    );
  };

  const handleBulkReject = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.includes(r.id) ? { ...r, resolution: 'rejected' } : r
      )
    );
    setSelectedIds([]);
    pushToast(
      'warning',
      'Par rejeitado. O produto não voltará a ser sugerido para este anúncio.',
      `${count} par(es) gravados permanentemente em match_rejections.`
    );
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectableRows = rows.filter((r) => !r.resolution);
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
            14 Sugestões
          </span>
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 font-medium text-rose-300">
            2 em Quarentena
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
                        disabled={Boolean(row.resolution)}
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
                            onClick={() => handleConfirmSingle(row)}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Confirmar Vínculo
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectSingle(row)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25"
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
