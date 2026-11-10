'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/api-client';
import { CatalogLink, LinkDataGrid } from '../../components/links/link-data-grid';

type Filter = 'todos' | 'ativos' | 'orfaos';

interface ProductHit {
  id: string;
  sku: string;
  name: string;
}

interface LinksPayload {
  kpis: { active: number; orphans: number; unlinked: number };
  items: CatalogLink[];
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativos', label: 'Apenas ativos' },
  { id: 'orfaos', label: 'Apenas órfãos/quebrados' },
];

export default function VinculosPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [payload, setPayload] = useState<LinksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [productId, setProductId] = useState('');
  const [externalId, setExternalId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (nextQuery = query, nextFilter = filter) => {
    try {
      const params = new URLSearchParams({ q: nextQuery.trim(), status: nextFilter });
      setPayload(await apiFetch<LinksPayload>(`/api/matching/links?${params.toString()}`));
      setError(null);
    } catch {
      setError('Não foi possível ler os vínculos.');
    }
  };

  useEffect(() => {
    void load('', 'todos');
  }, []);

  const searchProducts = async (value: string) => {
    setProductQuery(value);
    if (value.trim().length < 2) {
      setProducts([]);
      return;
    }
    const found = await apiFetch<{ items: ProductHit[] }>(`/api/matching/products?q=${encodeURIComponent(value.trim())}`);
    setProducts(found.items);
  };

  const createLink = async () => {
    if (!productId || !externalId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/matching/links', { method: 'POST', json: { productId, externalId: externalId.trim(), platform: 'nuvemshop' } });
      setManualOpen(false);
      setProductId('');
      setExternalId('');
      setProductQuery('');
      setNotice('Vínculo manual salvo. Nenhum anúncio foi criado na Nuvemshop.');
      await load();
    } catch {
      setError('Não foi possível criar o vínculo. Confira se esse anúncio já está ligado a outro produto.');
    } finally {
      setSaving(false);
    }
  };

  const kpis = payload?.kpis;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="border-b border-border-color pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Gerenciador de identidade</h1>
        <p className="mt-1 text-sm text-text-muted">Gerencie as conexões entre os SKUs do Bling e os anúncios na Nuvemshop.</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-border-color bg-bg-surface p-4">
          <p className="text-2xl font-bold tabular-nums">{(kpis?.active ?? 0).toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-text-muted">Vínculos ativos</p>
        </article>
        <article className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <p className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-200">{(kpis?.orphans ?? 0).toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-text-muted">Órfãos: o anúncio sumiu no marketplace</p>
        </article>
        <article className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-2xl font-bold tabular-nums text-amber-800 dark:text-amber-100">{(kpis?.unlinked ?? 0).toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-text-muted">Produtos do ERP sem anúncio na Nuvemshop</p>
        </article>
      </section>

      <section className="mt-6 rounded-xl border border-border-color bg-bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Ações rápidas</h2>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query, filter);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SKU do Bling ou ID do anúncio"
            className="flex-1 rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg border border-border-color px-4 py-2 text-sm font-semibold">Buscar</button>
          <button type="button" onClick={() => setManualOpen(true)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
            Criar vínculo manual
          </button>
        </form>
      </section>

      {error && <p className="mt-4 text-sm text-rose-600" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-text-muted" role="status">{notice}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setFilter(item.id);
              void load(query, item.id);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === item.id ? 'bg-emerald-700 text-white' : 'border border-border-color text-text-muted'}`}
          >
            {item.label}
          </button>
        ))}
        <Link href="/matching" className="rounded-full border border-border-color px-3 py-1.5 text-xs font-semibold text-text-muted">
          Ir para Matching
        </Link>
      </div>

      {!payload && !error && <p className="mt-6 text-sm text-text-muted">Carregando vínculos...</p>}
      {payload && (
      <LinkDataGrid
        items={payload.items}
        onUnlink={async (link) => {
          await apiFetch(`/api/matching/links/${link.id}`, { method: 'DELETE' });
          setNotice('Vínculo removido no HUB. O anúncio continua na loja.');
          await load();
        }}
      />
      )}

      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Criar vínculo manual">
          <div className="grid w-full max-w-3xl gap-4 rounded-xl border border-border-color bg-bg-base p-5 sm:grid-cols-2">
            <section>
              <h2 className="text-sm font-semibold">Produto no Bling</h2>
              <input
                value={productQuery}
                onChange={(event) => void searchProducts(event.target.value)}
                placeholder="Nome ou SKU"
                className="mt-2 w-full rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm"
              />
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                {products.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => setProductId(product.id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${productId === product.id ? 'bg-emerald-500/15' : 'hover:bg-bg-surface'}`}
                    >
                      <span className="block truncate font-medium">{product.name}</span>
                      <span className="font-mono text-text-muted">{product.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-sm font-semibold">Anúncio na Nuvemshop</h2>
              <input
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
                placeholder="ID do anúncio"
                className="mt-2 w-full rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm"
              />
              <p className="mt-2 text-xs text-text-muted">Use quando o SKU do ERP não bate com o anúncio. O HUB só registra a ponte.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setManualOpen(false)} className="rounded-lg border border-border-color px-3 py-1.5 text-xs">Cancelar</button>
                <button type="button" disabled={saving || !productId || !externalId.trim()} onClick={() => void createLink()} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  {saving ? 'Salvando...' : 'Costurar vínculo'}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
