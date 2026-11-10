'use client';

import React, { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { formatNcm, NcmHistoryRow, NcmItem, tipiLookupUrl } from './types';

function DiffCode({ value }: { value: string | null }) {
  const digits = (value ?? '').replace(/\D/g, '').padEnd(8, ' ').slice(0, 8);
  return <span className="font-mono text-lg tracking-wide">{digits.trim() ? formatNcm(digits.trim()) : '—'}</span>;
}

export function NcmDetailsDrawer({
  item,
  history,
  canReview,
  blockedOwnVote,
  onClose,
  onApprove,
  onReject,
}: {
  item: NcmItem;
  history: NcmHistoryRow[];
  canReview: boolean;
  blockedOwnVote: boolean;
  onClose: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const currentDigits = (item.currentNcm ?? '').replace(/\D/g, '');
  const proposedDigits = item.proposedNcm.replace(/\D/g, '');
  const changed = currentDigits !== proposedDigits;

  const submit = (decision: 'approve' | 'reject') => {
    if (note.trim().length < 3) {
      setWarning('A aprovação exige a citação da consulta à TIPI.');
      return;
    }
    if (decision === 'approve') onApprove(note.trim());
    else onReject(note.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <aside role="dialog" aria-label="Detalhe da sugestão de NCM" className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border-color bg-bg-base text-text-primary shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-color px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{item.productName || 'Produto'}</p>
            <p className="font-mono text-xs text-text-muted">{item.sku || 'Sem SKU'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-text-muted"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-auto p-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border-color bg-bg-surface p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">NCM atual (ERP)</p>
              <DiffCode value={item.currentNcm} />
            </div>
            <div className={`rounded-xl border p-3 ${changed ? 'border-amber-500/50 bg-amber-500/10' : 'border-border-color bg-bg-surface'}`}>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">NCM sugerido</p>
              <p className="inline-flex items-center gap-2">
                <DiffCode value={item.proposedNcm} />
                <a href={tipiLookupUrl(item.proposedNcm)} target="_blank" rel="noreferrer" className="text-text-muted" aria-label="Consultar na TIPI">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </p>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Impacto da mudança</h3>
            <p className="mt-1 text-sm text-text-muted">
              {changed
                ? 'O código deixa de ser o do ERP. IPI, PIS e COFINS dependem dessa classificação e precisam ser conferidos na TIPI. O HUB não calcula a alíquota.'
                : 'O código sugerido é igual ao do ERP. A confirmação só registra a revisão.'}
            </p>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Histórico do produto</h3>
            {history.length === 0 && <p className="mt-1 text-sm text-text-muted">Nenhuma alteração de NCM registrada para este SKU.</p>}
            <ul className="mt-2 space-y-2">
              {history.map((row) => (
                <li key={row.id} className="rounded-lg border border-border-color px-3 py-2 text-xs">
                  <p className="text-text-muted">{new Date(row.createdAt).toLocaleString('pt-BR')}</p>
                  <p className="mt-1 font-mono">{formatNcm(row.previous_ncm)} → {formatNcm(row.new_ncm)} · {row.decision === 'rejected' ? 'Rejeitado' : row.decision === 'dual_approved' ? 'Aprovado' : row.decision}</p>
                </li>
              ))}
            </ul>
          </section>
          {canReview && (
            <section>
              <label htmlFor="tipi-note" className="text-sm font-semibold">Justificativa / nota de consulta à TIPI</label>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">A aprovação exige a citação da consulta à TIPI.</p>
              <textarea
                id="tipi-note"
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-2 w-full rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm"
              />
              {warning && <p className="mt-2 text-xs text-rose-600" role="alert">{warning}</p>}
              {blockedOwnVote && <p className="mt-2 text-xs text-text-muted">Você já fez a 1ª confirmação. Outro revisor precisa concluir.</p>}
            </section>
          )}
        </div>
        {canReview && (
          <footer className="flex justify-end gap-2 border-t border-border-color px-5 py-3">
            <button type="button" onClick={() => submit('reject')} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white">Rejeitar</button>
            <button type="button" disabled={blockedOwnVote} onClick={() => submit('approve')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              Confirmar Aprovação
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
