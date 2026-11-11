'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { BrandLogo } from '../brand-logo';

const SOON = [
  { id: 'amazon', name: 'Amazon' },
  { id: 'magalu', name: 'Magalu' },
];

export function IntegrationCatalogModal({ onClose }: { onClose: () => void }) {
  const [requested, setRequested] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Catálogo de integrações">
      <div className="w-full max-w-lg rounded-xl border border-border-color bg-bg-base p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Adicionar canal</h2>
            <p className="mt-1 text-xs text-text-muted">Nuvemshop e Shopee já estão no HUB. Os demais canais ainda não recebem catálogo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-text-muted"><X className="h-4 w-4" /></button>
        </div>
        <ul className="mt-4 space-y-2">
          {SOON.map((channel) => (
            <li key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-color px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm">
                <BrandLogo id={channel.id} name={channel.name} size={28} />
                {channel.name}
              </span>
              <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-muted">Em breve</span>
              <button
                type="button"
                onClick={() => setRequested(channel.name)}
                className="rounded-lg border border-border-color px-2.5 py-1 text-xs font-semibold"
              >
                Solicitar integração
              </button>
            </li>
          ))}
        </ul>
        {requested && <p className="mt-3 text-xs text-text-muted" role="status">Pedido de {requested} anotado nesta sessão. Ainda não há fila de integração.</p>}
      </div>
    </div>
  );
}
