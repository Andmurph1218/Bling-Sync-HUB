'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api-client';
import { ProductFixModal } from '../../components/product-fix-modal';

type ProblemType = 'estoque' | 'preco' | 'anuncio' | 'cadastro';

interface ProblemItem {
  id: string;
  type: ProblemType;
  sku: string;
  name: string;
  productId: string;
  blingId: string;
  channel: string;
  message: string;
  source: string;
}

interface ProblemGroup {
  type: ProblemType;
  label: string;
  count: number;
  items: ProblemItem[];
}

const FILTERS: Array<{ type: ProblemType | 'todos'; label: string }> = [
  { type: 'todos', label: 'Todos' },
  { type: 'estoque', label: 'Problemas de Estoque' },
  { type: 'preco', label: 'Problemas de Preço' },
  { type: 'anuncio', label: 'Problemas de Anúncio' },
  { type: 'cadastro', label: 'Problemas de Cadastro' },
];

export default function ProblemasPage() {
  const [groups, setGroups] = useState<ProblemGroup[]>([]);
  const [filter, setFilter] = useState<ProblemType | 'todos'>('todos');
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<ProblemItem | null>(null);

  const load = async () => {
    const payload = await apiFetch<{ groups: ProblemGroup[] }>('/api/problems');
    setGroups(payload.groups);
    setError(null);
  };

  useEffect(() => {
    void load().catch(() => setError('Não foi possível ler os problemas do catálogo.'));
  }, []);

  const visible = groups
    .filter((group) => filter === 'todos' || group.type === filter)
    .flatMap((group) => group.items);
  const countFor = (type: ProblemType | 'todos') =>
    type === 'todos' ? groups.reduce((sum, group) => sum + group.count, 0) : groups.find((group) => group.type === type)?.count ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Problemas</h1>
      <p className="mt-2 text-sm text-text-muted">
        Falhas de envio, erros de webhook e pendências de cadastro no mesmo lugar.
      </p>
      {error && <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border border-border-color bg-bg-surface/60 p-3">
          <ul className="space-y-1">
            {FILTERS.map((item) => (
              <li key={item.type}>
                <button
                  type="button"
                  onClick={() => setFilter(item.type)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
                    filter === item.type ? 'bg-sky-500/15 text-sky-100' : 'text-text-muted hover:bg-bg-surface'
                  }`}
                >
                  <span>{item.label}</span>
                  <span>{countFor(item.type)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section>
          {visible.length === 0 && !error && (
            <p className="rounded-xl border border-border-color px-4 py-6 text-sm text-text-muted">Nenhum problema neste filtro.</p>
          )}
          <ul className="space-y-2">
            {visible.map((item) => (
              <li key={item.id} className="grid items-center gap-3 rounded-xl border border-border-color bg-bg-surface/60 px-4 py-3 text-xs text-text-primary sm:grid-cols-[1.4fr_0.8fr_1.6fr_auto]">
                <div>
                  <p className="font-semibold text-text-primary">{item.name}</p>
                  <p className="font-mono text-emerald-300">SKU {item.sku}</p>
                </div>
                <p>{item.channel}</p>
                <p>{item.message}</p>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-text-primary disabled:opacity-40"
                  disabled={!item.blingId}
                  onClick={() => setFixing(item)}
                >
                  Corrigir
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {fixing && (
        <ProductFixModal
          blingId={fixing.blingId}
          reason={fixing.message}
          onClose={() => setFixing(null)}
          onSaved={() => void load().catch(() => undefined)}
        />
      )}
    </main>
  );
}
