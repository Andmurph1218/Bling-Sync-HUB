'use client';

import React, { useState } from 'react';
import { ExternalLink, Link2Off, Unlink } from 'lucide-react';

export interface CatalogLink {
  id: string;
  platform: string;
  externalId: string;
  method: string;
  status: 'active' | 'orphan' | 'divergent';
  createdAt: string | null;
  sku: string;
  name: string;
  blingId: string;
}

const METHOD: Record<string, string> = {
  manual: 'Manual',
  sku: 'SKU exato',
  ean: 'EAN',
  auto_multi_signal: 'Automático',
  combo_key: 'Combinação',
  default_simple: 'Padrão',
};

const STATUS = {
  active: { label: 'Ativo', className: 'bg-emerald-600 text-white' },
  orphan: { label: 'Órfão', className: 'bg-rose-600 text-white' },
  divergent: { label: 'Divergente', className: 'bg-amber-500 text-amber-950' },
};

function listingUrl(link: CatalogLink): string {
  if (link.platform === 'mercadolivre') return `https://www.mercadolivre.com.br/p/${encodeURIComponent(link.externalId)}`;
  return `https://www.nuvemshop.com.br/admin/products/${encodeURIComponent(link.externalId)}`;
}

export function LinkDataGrid({
  items,
  onUnlink,
}: {
  items: CatalogLink[];
  onUnlink: (link: CatalogLink) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<CatalogLink | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-border-color bg-bg-surface px-6 py-12 text-center">
          <Unlink className="h-12 w-12 text-text-muted" />
          <p className="mt-4 max-w-md text-sm text-text-muted">
            Nenhum vínculo encontrado. Vá até a aba de Matching para aprovar sugestões ou crie um vínculo manual.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
              <tr className="h-10">
                <th className="px-4 font-semibold">Produto (ERP)</th>
                <th className="px-3 font-semibold">Anúncio</th>
                <th className="px-3 font-semibold">Método</th>
                <th className="px-3 font-semibold">Status</th>
                <th className="px-3 font-semibold">Data</th>
                <th className="px-4 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((link) => {
                const state = STATUS[link.status];
                return (
                  <tr key={link.id} className="border-b border-border-color">
                    <td className="px-4 py-3">
                      <p className="max-w-xs truncate font-medium text-text-primary" title={link.name}>{link.name}</p>
                      <p className="font-mono text-[11px] text-text-muted">{link.sku}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-mono text-xs">{link.externalId}</p>
                      <p className="text-[11px] text-text-muted">{link.platform === 'nuvemshop' ? 'Nuvemshop' : 'Mercado Livre'}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full border border-border-color px-2 py-0.5 text-[11px] font-semibold">{METHOD[link.method] ?? link.method}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.className}`}>{state.label}</span>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-text-muted">
                      {link.createdAt ? new Date(link.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem data'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a href={listingUrl(link)} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-1 text-xs font-semibold underline">
                        Ver no marketplace
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button type="button" onClick={() => setConfirming(link)} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600">
                        <Link2Off className="h-3.5 w-3.5" />
                        Desvincular
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirmar desvínculo">
          <div className="w-full max-w-md rounded-xl border border-border-color bg-bg-base p-5 text-sm text-text-primary">
            <h2 className="text-base font-semibold">Desvincular {confirming.sku}?</h2>
            <p className="mt-2 text-text-muted">Isso impedirá que o HUB atualize este anúncio. O anúncio não será apagado no marketplace.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-border-color px-3 py-1.5 text-xs">Cancelar</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onUnlink(confirming).finally(() => {
                    setBusy(false);
                    setConfirming(null);
                  });
                }}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Removendo...' : 'Desvincular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
