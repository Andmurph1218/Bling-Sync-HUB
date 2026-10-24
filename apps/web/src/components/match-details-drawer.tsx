'use client';

import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Check,
  Ban,
  ExternalLink,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  buildBlingProductUrl,
  buildChannelAnnouncementUrl,
  translateMatchingSignal,
} from '../utils/matching-signals';
import { TechTooltip } from './tech-tooltip';

export interface MatchingComparisonItem {
  id: string;
  blingId: string;
  blingSku: string;
  blingName: string;
  blingEan: string;
  blingPrice: string;
  blingStatus: string;
  channelId: string;
  platform: 'Mercado Livre' | 'Nuvemshop';
  channelTitle: string;
  channelSku: string;
  channelEan: string;
  channelPrice: string;
  channelStatus: string;
  pireScore: number;
  strongSignals: string[];
  status: 'Sugestão' | 'Quarentena';
  quarantineReason?: string;
  resolution?: 'confirmed' | 'rejected';
  rejectionReason?: string;
}

const REJECTION_REASONS = [
  'Produto físico diferente (anúncio reutilizado no canal)',
  'Voltagem / cor / dimensão incompatível com o SKU do Bling',
  'EAN pertence a outro fabricante ou kit com quantidade distinta',
  'Erro de cadastro no marketplace (duplicado a encerrar)',
];

interface MatchDetailsDrawerProps {
  item: MatchingComparisonItem | null;
  onClose: () => void;
  onConfirm: (item: MatchingComparisonItem) => void;
  onReject: (item: MatchingComparisonItem, reason: string) => void;
}

function normalizeCompare(val: string): string {
  return val.trim().toLowerCase();
}

export function MatchDetailsDrawer({
  item,
  onClose,
  onConfirm,
  onReject,
}: MatchDetailsDrawerProps) {
  const [rejectPopoverOpen, setRejectPopoverOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState(REJECTION_REASONS[0]!);

  if (!item) return null;

  const titleDiff =
    normalizeCompare(item.blingName) !== normalizeCompare(item.channelTitle);
  const skuDiff =
    normalizeCompare(item.blingSku) !== normalizeCompare(item.channelSku);
  const eanDiff =
    normalizeCompare(item.blingEan) !== normalizeCompare(item.channelEan);
  const priceDiff =
    normalizeCompare(item.blingPrice) !== normalizeCompare(item.channelPrice);
  const statusDiff =
    normalizeCompare(item.blingStatus) !== normalizeCompare(item.channelStatus);

  const blingUrl = buildBlingProductUrl(item.blingId);
  const channelUrl = buildChannelAnnouncementUrl(item.platform, item.channelId);

  const handleConfirmClick = () => {
    onConfirm(item);
    setRejectPopoverOpen(false);
    onClose();
  };

  const handleConfirmReject = () => {
    onReject(item, selectedReason);
    setRejectPopoverOpen(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sheet Lateral (shadcn/ui Sheet style) */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Resolução de Identidade: PIRE / VIR"
        className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
      >
        {/* Cabeçalho do Sheet */}
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-bold text-white">
                Resolução de Identidade: <TechTooltip term="PIRE" /> /{' '}
                <TechTooltip term="VIR" />
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-bold ${
                  item.pireScore >= 90
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : item.pireScore >= 75
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                }`}
              >
                <Sparkles className="h-3 w-3" />
                Score {item.pireScore} / 100
              </span>
              {item.status === 'Quarentena' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                  <ShieldAlert className="h-3 w-3" />
                  Quarentena
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Compare os campos entre o Bling (soberano) e o anúncio em{' '}
              <strong className="text-zinc-200">{item.platform}</strong> antes de decidir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-zinc-700 hover:text-white"
            aria-label="Fechar painel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Corpo Rolável */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Guia de Decisão (Hub Orientando) */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="text-xs leading-relaxed text-amber-100/90">
                <p className="font-semibold text-amber-300">
                  Guia de Decisão — O Hub Orientando
                </p>
                <p className="mt-1">
                  Para confirmar o vínculo, verifique se as características físicas (cor, tamanho, voltagem) e o EAN correspondem ao mesmo produto. Se o SKU bate, mas o nome é completamente diferente, verifique se o anúncio não foi reutilizado para outro produto.
                </p>
              </div>
            </div>
          </div>

          {/* Sinais Detectados pelo PIRE */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Por que o Hub sugeriu este par?
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.strongSignals.map((sig) => {
                const tr = translateMatchingSignal(sig);
                const badgeClass =
                  tr.tone === 'positive'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : tr.tone === 'conflict'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
                const dotClass =
                  tr.tone === 'positive'
                    ? 'bg-emerald-400'
                    : tr.tone === 'conflict'
                    ? 'bg-rose-400'
                    : 'bg-amber-400';
                return (
                  <span
                    key={sig}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${badgeClass}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                    {tr.label}
                  </span>
                );
              })}
            </div>
            {item.quarantineReason && (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <strong>Motivo da Quarentena:</strong> {item.quarantineReason}
              </p>
            )}
          </div>

          {/* Comparação Lado a Lado (Grid 2 Colunas) */}
          <div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Coluna 1 · Fonte Soberana
                  </span>
                  <span className="text-sm font-bold text-white">
                    Bling ERP v3 (#{item.blingId})
                  </span>
                </div>
                <a
                  href={blingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-zinc-900/80 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-zinc-900"
                >
                  <span>Abrir</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Coluna 2 · Marketplace ({item.platform})
                  </span>
                  <span className="text-sm font-bold text-white">
                    Anúncio {item.channelId}
                  </span>
                </div>
                <a
                  href={channelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  <span>Abrir</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <div className="space-y-2.5">
              {/* Campo: Título */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border p-3 ${
                    titleDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    Título (Bling)
                  </span>
                  <p className="mt-1 text-xs font-medium text-white">
                    {item.blingName}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    titleDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-zinc-400">
                      Título ({item.platform})
                    </span>
                    {titleDiff && (
                      <span className="text-[10px] font-semibold text-amber-300">
                        Divergente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs font-medium text-white">
                    {item.channelTitle}
                  </p>
                </div>
              </div>

              {/* Campo: SKU */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border p-3 ${
                    skuDiff
                      ? 'border-rose-500/30 bg-rose-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    SKU (Bling)
                  </span>
                  <p className="mt-1 font-mono text-xs font-semibold text-emerald-400">
                    {item.blingSku}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    skuDiff
                      ? 'border-rose-500/30 bg-rose-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-zinc-400">
                      SKU Enviado ({item.platform})
                    </span>
                    {skuDiff && (
                      <span className="text-[10px] font-semibold text-rose-300">
                        Divergente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs font-semibold text-white">
                    {item.channelSku}
                  </p>
                </div>
              </div>

              {/* Campo: EAN */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border p-3 ${
                    eanDiff
                      ? 'border-rose-500/30 bg-rose-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    EAN / GTIN (Bling)
                  </span>
                  <p className="mt-1 font-mono text-xs text-zinc-200">
                    {item.blingEan}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    eanDiff
                      ? 'border-rose-500/30 bg-rose-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-zinc-400">
                      EAN / GTIN ({item.platform})
                    </span>
                    {eanDiff && (
                      <span className="text-[10px] font-semibold text-rose-300">
                        Divergente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-200">
                    {item.channelEan}
                  </p>
                </div>
              </div>

              {/* Campo: Preço */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border p-3 ${
                    priceDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    Preço Loja (Bling)
                  </span>
                  <p className="mt-1 font-mono text-xs font-semibold text-white">
                    {item.blingPrice}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    priceDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-zinc-400">
                      Preço ({item.platform})
                    </span>
                    {priceDiff && (
                      <span className="text-[10px] font-semibold text-amber-300">
                        Divergente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs font-semibold text-white">
                    {item.channelPrice}
                  </p>
                </div>
              </div>

              {/* Campo: Status */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`rounded-lg border p-3 ${
                    statusDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    Status (Bling)
                  </span>
                  <p className="mt-1 text-xs font-medium text-emerald-400">
                    {item.blingStatus}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    statusDiff
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase text-zinc-400">
                    Status ({item.platform})
                  </span>
                  <p className="mt-1 text-xs font-medium text-zinc-200">
                    {item.channelStatus}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé com Ações e Popover de Rejeição */}
        <footer className="relative border-t border-zinc-800 bg-zinc-900/80 px-6 py-4">
          {rejectPopoverOpen && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-zinc-950 p-4 shadow-xl">
              <p className="text-xs font-semibold text-rose-300">
                Informe o motivo da rejeição permanente (<TechTooltip term="match_rejections" />):
              </p>
              <div className="mt-2.5 space-y-1.5">
                {REJECTION_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    <input
                      type="radio"
                      name="reject-reason"
                      checked={selectedReason === reason}
                      onChange={() => setSelectedReason(reason)}
                      className="accent-rose-500"
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectPopoverOpen(false)}
                  className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReject}
                  className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Gravar em match_rejections
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRejectPopoverOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-transparent px-4 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/15"
            >
              <Ban className="h-4 w-4" />
              Rejeitar Par
            </button>

            <button
              type="button"
              onClick={handleConfirmClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              <Check className="h-4 w-4" />
              Confirmar Vínculo
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
