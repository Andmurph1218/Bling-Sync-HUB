'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/api-client';

interface HubProduct {
  id: string;
  blingId: string;
  sku: string;
  name: string;
  ean: string | null;
  price: number | null;
  stock: number | null;
  status: string;
  listingId: string | null;
}

interface Listing {
  id: string;
  title: string;
  price: number | null;
  status: string;
}

interface SearchResult {
  warning: string | null;
  hub: HubProduct | null;
  listing: Listing | null;
}

const money = (value: number | null) =>
  value === null ? 'Sem preço' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function VinculosPage() {
  const [sku, setSku] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    const term = sku.trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiFetch<SearchResult>(`/api/matching/search?sku=${encodeURIComponent(term)}`);
      setResult(payload);
    } catch {
      setResult(null);
      setError('Não foi possível buscar o SKU.');
    } finally {
      setLoading(false);
    }
  };

  const link = async () => {
    if (!result?.hub || !result.listing) return;
    setLinking(true);
    setError(null);
    try {
      await apiFetch<{ status: string }>('/api/matching/link', {
        method: 'POST',
        json: {
          productId: result.hub.id,
          listingId: result.listing.id,
          title: result.listing.title,
          price: result.listing.price,
          status: result.listing.status,
        },
      });
      setResult({
        ...result,
        hub: { ...result.hub, status: 'Vinculado', listingId: result.listing.id },
      });
      setNotice('Vínculo salvo. Nenhum anúncio novo foi criado.');
    } catch {
      setError('Não foi possível salvar o vínculo.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Vínculos</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Se o anúncio já existe no Mercado Livre, o HUB só registra o vínculo.
      </p>
      <form onSubmit={(event) => void search(event)} className="mx-auto mt-6 flex max-w-xl gap-2">
        <label className="sr-only" htmlFor="sku-search">Digite o SKU</label>
        <input
          id="sku-search"
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          placeholder="Digite o SKU"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
        />
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </form>
      {error && <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-emerald-300" role="status">{notice}</p>}
      {result?.warning && <p className="mt-4 text-sm text-amber-200">{result.warning}</p>}
      {result && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Produto no HUB</h2>
            {!result.hub && <p className="mt-3 text-sm text-zinc-300">Nenhum produto do Bling com esse SKU.</p>}
            {result.hub && (
              <div className="mt-3 space-y-1 text-sm text-zinc-200">
                <p className="font-semibold text-white">{result.hub.name}</p>
                <p className="font-mono text-emerald-300">SKU {result.hub.sku}</p>
                <p>EAN {result.hub.ean || 'ausente'}</p>
                <p>{money(result.hub.price)} · Estoque {result.hub.stock ?? 'não lido'}</p>
                <p>Status: <strong className={result.hub.status === 'Vinculado' ? 'text-emerald-300' : 'text-amber-200'}>{result.hub.status}</strong></p>
              </div>
            )}
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Anúncio no Mercado Livre</h2>
            {!result.listing && <p className="mt-3 text-sm text-zinc-300">Nenhum anúncio encontrado para esse SKU ou EAN.</p>}
            {result.listing && (
              <div className="mt-3 space-y-1 text-sm text-zinc-200">
                <p className="font-semibold text-white">{result.listing.title}</p>
                <p className="font-mono text-sky-300">{result.listing.id}</p>
                <p>{money(result.listing.price)}</p>
                <p>Status: {result.listing.status}</p>
              </div>
            )}
          </section>
        </div>
      )}
      {result?.hub && result.listing && result.hub.status !== 'Vinculado' && (
        <button
          type="button"
          className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={linking}
          onClick={() => void link()}
        >
          {linking ? 'Vinculando...' : 'Vincular Produto ao Anúncio'}
        </button>
      )}
      {result?.hub && !result.listing && (
        <Link
          href={`/catalogo?aba=envio&sku=${encodeURIComponent(result.hub.sku)}`}
          className="mt-4 inline-block rounded-lg border border-sky-500 px-4 py-2 text-sm font-semibold text-sky-200"
        >
          Criar novo anúncio
        </Link>
      )}
    </main>
  );
}
