'use client';

import React from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { formatNcm, NcmItem, originLabel, tipiLookupUrl } from './types';

export function NcmApprovalTable({
  items,
  selected,
  canReview,
  currentUserId,
  onToggle,
  onToggleAll,
  onOpen,
  onApprove,
  onReject,
}: {
  items: NcmItem[];
  selected: Set<string>;
  canReview: boolean;
  currentUserId: string;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: NcmItem) => void;
  onApprove: (item: NcmItem) => void;
  onReject: (item: NcmItem) => void;
}) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  return (
    <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
          <tr className="h-10">
            <th className="px-3">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Selecionar pendências" disabled={!canReview} />
            </th>
            <th className="px-2 font-semibold">Produto / SKU</th>
            <th className="px-2 font-semibold">NCM sugerido</th>
            <th className="px-2 font-semibold">NCM atual (ERP)</th>
            <th className="px-2 font-semibold">Origem</th>
            <th className="px-2 font-semibold">Status da aprovação</th>
            <th className="px-3 text-right font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const ownVote = item.firstReviewer?.id === currentUserId;
            return (
              <tr key={item.id} className="cursor-pointer border-b border-border-color hover:bg-bg-base/70" onClick={() => onOpen(item)}>
                <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={!canReview || ownVote}
                    onChange={() => onToggle(item.id)}
                    aria-label={`Selecionar ${item.sku ?? item.id}`}
                  />
                </td>
                <td className="px-2 py-3">
                  <p className="max-w-xs truncate font-medium text-text-primary" title={item.productName ?? ''}>{item.productName || 'Sem nome'}</p>
                  <p className="font-mono text-[11px] text-text-muted">{item.sku || 'Sem SKU'}</p>
                </td>
                <td className="px-2 py-3 font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {formatNcm(item.proposedNcm)}
                    <a
                      href={tipiLookupUrl(item.proposedNcm)}
                      target="_blank"
                      rel="noreferrer"
                      title="Consultar na TIPI"
                      aria-label="Consultar na TIPI"
                      onClick={(event) => event.stopPropagation()}
                      className="text-text-muted hover:text-text-primary"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </span>
                </td>
                <td className="px-2 py-3 font-mono text-xs text-text-muted">{formatNcm(item.currentNcm)}</td>
                <td className="px-2 py-3 text-xs">{originLabel(item.sourcePlatform)}</td>
                <td className="px-2 py-3 text-xs">
                  {item.status === 'pending_second' ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-200">
                      Aguardando 2ª ({item.firstReviewer?.email || item.firstReviewer?.name || '1º revisor'})
                    </span>
                  ) : (
                    <span className="rounded-full bg-orange-500/15 px-2 py-0.5 font-semibold text-orange-700 dark:text-orange-200">Aguardando 1ª</span>
                  )}
                  {ownVote && <p className="mt-1 text-[11px] text-text-muted">Você já aprovou. Aguardando outro aprovador.</p>}
                </td>
                <td className="px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                  {canReview && (
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        disabled={ownVote}
                        onClick={() => onApprove(item)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" /> Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(item)}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white"
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
  );
}
