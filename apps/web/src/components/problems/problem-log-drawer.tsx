'use client';

import React, { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { ProblemGroup, ProblemItem } from './types';
import { Overlay, useOverlayState } from '../ui/overlay';

interface ProblemLog {
  groupKey: string;
  item: ProblemItem;
  technical: Record<string, unknown>;
}

export function ProblemLogDrawer({
  itemId,
  group,
  onClose: onDismiss,
}: {
  itemId: string | null;
  group: ProblemGroup | null;
  onClose: () => void;
}) {
  const { open, onClose, onAfterClose } = useOverlayState(onDismiss);
  const [log, setLog] = useState<ProblemLog | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLog(null);
    setError(false);
    if (!itemId) return;
    void apiFetch<ProblemLog>(`/api/problems/items/${encodeURIComponent(itemId)}/log`)
      .then(setLog)
      .catch(() => setError(true));
  }, [itemId]);

  const payload = itemId ? log?.technical ?? null : group;
  const title = itemId ? log?.item.name ?? 'Log técnico' : group?.groupMessage ?? 'Grupo de erros';
  const json = payload ? JSON.stringify(payload, null, 2) : '';

  return (
    <Overlay open={open} onClose={onClose} onAfterClose={onAfterClose} label="Log técnico do erro" kind="drawer">
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border-color px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Log técnico</p>
            <h2 className="mt-0.5 truncate text-base font-semibold" title={title}>{title}</h2>
            {log && (
              <p className="mt-0.5 font-mono text-xs text-text-muted">
                {log.item.sku} · {log.item.message}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-bg-surface" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5">
          {error && <p className="text-sm text-rose-600 dark:text-rose-300" role="alert">Não foi possível ler o log deste item.</p>}
          {itemId && !log && !error && <p className="text-sm text-text-muted">Carregando log...</p>}
          {!itemId && group && (
            <p className="mb-3 text-xs text-text-muted">
              Resumo do grupo. Expanda a linha na tabela e abra um SKU para ver o payload individual.
            </p>
          )}
          {payload && (
            <pre className="overflow-auto rounded-lg border border-border-color bg-bg-surface p-4 font-mono text-[11px] leading-relaxed text-text-primary">
              {json}
            </pre>
          )}
        </div>
        {payload && (
          <footer className="border-t border-border-color px-5 py-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border-color px-3 py-1.5 text-xs font-medium hover:bg-bg-surface"
              onClick={() => {
                void navigator.clipboard.writeText(json).then(() => setCopied(true));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copiado' : 'Copiar JSON'}
            </button>
          </footer>
        )}
      </div>
    </Overlay>
  );
}
