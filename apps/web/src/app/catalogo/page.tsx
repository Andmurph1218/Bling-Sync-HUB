'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Boxes,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import {
  CatalogProductSummary,
  fetchOperationalState,
  translateBlockerToPlainPortuguese,
} from '../../utils/operational-state';
import { buildBlingProductUrl } from '../../utils/matching-signals';

const SAMPLE_PRODUCTS_FALLBACK: CatalogProductSummary[] = [
  {
    id: '55bf36c0-8d26-42e7-8981-231483e17f8a',
    bling_id: '16722020114',
    bling_sku: '13621',
    name: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un. 13621',
    brand: 'JHS Elétrica',
    ncm: '85469000',
    ncm_status: 'valid',
    ncm_fiscal_risk: false,
    catalog_status: 'active',
    last_bling_sync: '2026-10-22T22:48:00.000Z',
    variant_id: '73787b22-c8c8-4234-b204-c86dfae4ab15',
    price: '142.00',
    cost_price: '89.00',
    stock: '18.000',
    ean: '7898912345601',
    ean_status: 'valid',
    score_bling: 99,
    score_ml: 56,
    score_ns: 52,
    publishable_ml: true,
    publishable_ns: true,
    blockers: ['ml_category_not_verified'],
  },
  {
    id: 'a53e21f4-8998-483d-8b13-188005a8887f',
    bling_id: '16723377536',
    bling_sku: 'Mercurio 400w e40',
    name: 'Lampada Vapor Mercúrio 400w Hpl E40 Cor Da Luz Branco-neutro',
    brand: 'Osram / JHS',
    ncm: '85393200',
    ncm_status: 'valid',
    ncm_fiscal_risk: false,
    catalog_status: 'active',
    last_bling_sync: '2026-10-22T22:48:00.000Z',
    variant_id: '3a53e7a5-8c8c-432e-9e6d-21607fcbbe78',
    price: '89.90',
    cost_price: '52.00',
    stock: '24.000',
    ean: '7891234567895',
    ean_status: 'valid',
    score_bling: 99,
    score_ml: 38,
    score_ns: 34,
    publishable_ml: false,
    publishable_ns: false,
    blockers: ['ml_category_not_verified', 'score_ml_below_50', 'score_ns_below_45'],
  },
  {
    id: '98ae05dc-40b8-4b4a-8edd-973143e99b56',
    bling_id: '16719381290',
    bling_sku: '',
    name: 'CONTATOR AUXILIAR 2NA+2NF',
    brand: null,
    ncm: '85364900',
    ncm_status: 'valid',
    ncm_fiscal_risk: false,
    catalog_status: 'active',
    last_bling_sync: '2026-10-22T22:48:00.000Z',
    variant_id: '4d56595d-7635-4e17-a494-0db30bd917f2',
    price: '64.50',
    cost_price: '41.00',
    stock: '9.000',
    ean: null,
    ean_status: 'missing',
    score_bling: 47,
    score_ml: 16,
    score_ns: 17,
    publishable_ml: false,
    publishable_ns: false,
    blockers: [
      'ean_invalid_or_risk',
      'ml_category_not_verified',
      'score_ml_below_50',
      'score_ns_below_45',
    ],
  },
];

export default function CatalogoPage() {
  const [products, setProducts] = useState<CatalogProductSummary[]>(
    SAMPLE_PRODUCTS_FALLBACK
  );
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'blocked'>('all');

  useEffect(() => {
    void (async () => {
      const res = await fetchOperationalState();
      if (res.data.catalogProducts && res.data.catalogProducts.length > 0) {
        setProducts(res.data.catalogProducts);
      }
    })();
  }, []);

  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const matchSku = (p.bling_sku || '').toLowerCase().includes(q);
      const matchName = (p.name || '').toLowerCase().includes(q);
      const matchBlingId = p.bling_id.toLowerCase().includes(q);
      if (!matchSku && !matchName && !matchBlingId) return false;
    }
    const isReady = Boolean(p.publishable_ml || p.publishable_ns);
    if (statusFilter === 'ready' && !isReady) return false;
    if (statusFilter === 'blocked' && isReady) return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-6 w-6 text-sky-400" />
            <h1 className="text-2xl font-bold text-white">
              Catálogo de Produtos (Bling &rarr; Canais)
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Consulte todos os produtos sincronizados do Bling ERP v3, compare notas de prontidão por canal e abra a Ficha Única de 7 abas.
          </p>
        </div>
      </header>

      {/* Busca e Filtros */}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, nome do produto ou ID do Bling..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-lg border px-3 py-1.5 font-medium ${
              statusFilter === 'all'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300'
            }`}
          >
            Todos ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('ready')}
            className={`rounded-lg border px-3 py-1.5 font-medium ${
              statusFilter === 'ready'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300'
            }`}
          >
            Prontos para publicar
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('blocked')}
            className={`rounded-lg border px-3 py-1.5 font-medium ${
              statusFilter === 'blocked'
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300'
            }`}
          >
            Com pendência ou bloqueio
          </button>
        </div>
      </section>

      {/* Tabela do Catálogo */}
      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3.5">SKU / Produto (Bling)</th>
                <th className="px-4 py-3.5">Estoque Seller / Preço</th>
                <th className="px-4 py-3.5">Fiscal (EAN / NCM)</th>
                <th className="px-4 py-3.5">Prontidão por Canal</th>
                <th className="px-4 py-3.5">O que falta fazer</th>
                <th className="px-4 py-3.5 text-right">Ficha Única</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filtered.map((prod) => {
                const isReady = Boolean(
                  prod.publishable_ml || prod.publishable_ns
                );
                const firstBlocker = (prod.blockers ?? [])[0];
                const translatedBlocker = firstBlocker
                  ? translateBlockerToPlainPortuguese(firstBlocker)
                  : null;

                return (
                  <tr key={prod.id} className="hover:bg-zinc-900/80">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-emerald-400">
                          {prod.bling_sku || '(Sem SKU cadastrado)'}
                        </span>
                        <a
                          href={buildBlingProductUrl(prod.bling_id)}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir no Bling"
                          className="text-zinc-400 hover:text-emerald-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-white">
                        {prod.name}
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        Bling ID: #{prod.bling_id}
                      </span>
                    </td>

                    <td className="px-4 py-4 text-xs">
                      <div className="font-semibold text-white">
                        R$ {prod.price ?? '0.00'}
                      </div>
                      <div className="mt-0.5 text-zinc-400">
                        Saldo seller:{' '}
                        <strong className="text-emerald-300">
                          {prod.stock !== null && prod.stock !== undefined
                            ? Math.floor(Number(prod.stock))
                            : 'Aguardando leitura'}
                        </strong>{' '}
                        un.
                      </div>
                    </td>

                    <td className="px-4 py-4 text-xs">
                      <div>
                        <span className="text-zinc-400">NCM: </span>
                        <span className="font-mono text-zinc-200">
                          {prod.ncm || 'Ausente'}
                        </span>
                      </div>
                      <div className="mt-0.5">
                        <span className="text-zinc-400">EAN: </span>
                        {prod.ean ? (
                          <span className="font-mono text-emerald-300">
                            {prod.ean}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                            <Lock className="h-3 w-3" /> Ausente
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5">
                          Bling: <strong>{prod.score_bling ?? '—'}</strong>
                        </span>
                        <span
                          className={`rounded border px-2 py-0.5 ${
                            prod.publishable_ml
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          ML: <strong>{prod.score_ml ?? '—'}</strong>
                        </span>
                        <span
                          className={`rounded border px-2 py-0.5 ${
                            prod.publishable_ns
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          NS: <strong>{prod.score_ns ?? '—'}</strong>
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-xs">
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-4 w-4" />
                          Apto para publicar conteúdo
                        </span>
                      ) : translatedBlocker ? (
                        <div>
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {translatedBlocker.title}
                          </span>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            Próximo passo: {translatedBlocker.nextStep}
                          </p>
                        </div>
                      ) : (
                        <span className="text-zinc-400">Em avaliação</span>
                      )}
                    </td>

                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/catalogo/${prod.bling_id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
                      >
                        <span>Abrir Ficha (7 abas)</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
