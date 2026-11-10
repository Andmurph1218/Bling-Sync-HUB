'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/api-client';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';

type Tab = 'ean' | 'ncm' | 'conflitos';

interface EanItem {
  id: string;
  productName: string | null;
  variantSku: string | null;
  proposedEan: string;
  sourcePlatform: string;
}

export default function FiscalHubPage() {
  const [tab, setTab] = useState<Tab>('ean');
  const [eans, setEans] = useState<EanItem[]>([]);
  const [conflicts, setConflicts] = useState<Array<{ id: string; name: string | null; sku: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ items: EanItem[] }>('/api/fiscal/ean/pending?platform=nuvemshop')
      .then((payload) => setEans((payload.items ?? []).filter((item) => MERCADO_LIVRE_ACTIVE || item.sourcePlatform !== 'mercadolivre')))
      .catch(() => setError('Não foi possível ler a fila de EAN.'));
    void apiFetch<{ items: Array<{ blingId: string; name: string | null; sku: string }> }>('/api/catalog/products?status=todos&pendencia=ncm&pageSize=50')
      .then((payload) => setConflicts((payload.items ?? []).map((item) => ({ id: item.blingId, name: item.name, sku: item.sku }))))
      .catch(() => undefined);
  }, []);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'ean', label: 'EAN Pendentes' },
    { id: 'ncm', label: 'NCM Dupla Aprovação' },
    { id: 'conflitos', label: 'Conflitos de Variantes' },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Fiscal</h1>
      <p className="mt-1 text-sm text-text-muted">
        {MERCADO_LIVRE_ACTIVE
          ? 'Fila fiscal dos canais conectados.'
          : 'Mercado Livre desconectado. A fila mostra só a Nuvemshop.'}
      </p>
      <div className="mt-4 flex gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${tab === item.id ? 'border-emerald-600 bg-emerald-600 text-text-primary' : 'border-border-color text-text-muted'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      {tab === 'ean' && (
        <ul className="mt-4 space-y-2">
          {eans.length === 0 && <li className="text-sm text-text-muted">Nenhum EAN pendente da Nuvemshop.</li>}
          {eans.map((item) => (
            <li key={item.id} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-sm">
              <span className="font-semibold">{item.productName || item.variantSku || 'Produto'}</span>
              <span className="ml-2 text-text-muted">{item.proposedEan}</span>
            </li>
          ))}
          <li><Link href="/fiscal/ean" className="text-xs font-semibold text-text-primary underline">Abrir a fila completa de EAN</Link></li>
        </ul>
      )}
      {tab === 'ncm' && (
        <div className="mt-4 rounded-xl border border-border-color bg-bg-surface p-4 text-sm text-text-muted">
          A dupla aprovação de NCM continua na fila dedicada, restrita a dois revisores fiscais.
          <div className="mt-3">
            <Link href="/fiscal/ncm" className="font-semibold text-text-primary underline">Abrir NCM</Link>
          </div>
        </div>
      )}
      {tab === 'conflitos' && (
        <ul className="mt-4 space-y-2">
          {conflicts.length === 0 && <li className="text-sm text-text-muted">Nenhum conflito de NCM entre variantes.</li>}
          {conflicts.map((item) => (
            <li key={item.id} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-sm">
              <Link href={`/catalogo/${item.id}`} className="font-semibold">{item.name || item.sku}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
