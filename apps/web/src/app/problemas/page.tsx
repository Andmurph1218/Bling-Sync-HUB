'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/api-client';

interface ProblemRow {
  id: string;
  bling_id: string;
  bling_sku: string;
  name: string | null;
  platform: string;
  job_kind: string;
  created_at: string;
}

export default function ProblemasPage() {
  const [total, setTotal] = useState<number | null>(null);
  const [items, setItems] = useState<ProblemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ total: number; items: ProblemRow[] }>('/api/catalog/problems')
      .then((payload) => {
        setTotal(payload.total);
        setItems(payload.items);
      })
      .catch(() => setError('Não foi possível ler os problemas de sync.'));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Problemas de sync</h1>
      <p className="mt-2 text-sm text-zinc-300" role="status">
        {error ?? (total === null ? 'Lendo falhas...' : `${total} falha(s) aberta(s)`)}
      </p>
      <ul className="mt-6 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-200">
            <Link href={`/catalogo/${item.bling_id}`} className="font-semibold text-white hover:underline">
              {item.bling_sku || 'Sem SKU'} — {item.name ?? 'Sem nome'}
            </Link>
            <p className="mt-1 text-zinc-400">
              {item.platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop'} · {item.job_kind}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
