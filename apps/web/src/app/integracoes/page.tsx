'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, LayoutGrid, Search, Store } from 'lucide-react';
import { useCurrentRole } from '../../components/app-shell';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';

type StoreCategory = 'all' | 'sales' | 'erps' | 'logistics' | 'marketplaces';
type AppCategory = 'marketplaces' | 'erps' | 'logistics';

interface IntegrationAppCard {
  id: string;
  name: string;
  category: AppCategory;
  implemented: boolean;
  status: 'installed' | 'attention' | 'available';
  statusLabel: string;
  reason: string | null;
  authorizePath: string | null;
}

interface IntegrationsPayload {
  categories: Array<{ id: StoreCategory; label: string }>;
  apps: IntegrationAppCard[];
  publicWebhooks?: {
    base: string | null;
    bling: string | null;
  };
}

const COPY: Record<string, string> = {
  mercadolivre: 'Marketplace de anúncios. O HUB cuida do catálogo. Pedido e nota fiscal ficam na integração nativa.',
  nuvemshop: 'Loja virtual. O conteúdo pode ser enriquecido em simulação, sem escrita ao vivo.',
  shopee: 'Marketplace previsto. O conector ainda não está instalado e o HUB não grava nesta plataforma.',
  amazon: 'Marketplace previsto. O conector ainda não está instalado e o HUB não grava nesta plataforma.',
  tiktok: 'Canal previsto para uma próxima etapa. O conector ainda não está instalado.',
  bling: 'ERP soberano do catálogo, do estoque e do preço. O HUB não processa pedidos.',
};

const MARK: Record<string, string> = {
  mercadolivre: 'bg-amber-400 text-zinc-950',
  nuvemshop: 'bg-sky-600 text-white',
  shopee: 'bg-orange-500 text-white',
  amazon: 'bg-zinc-800 text-white',
  tiktok: 'bg-zinc-900 text-white',
  bling: 'bg-emerald-600 text-white',
};

function matchesCategory(app: IntegrationAppCard, category: StoreCategory): boolean {
  if (category === 'all') return true;
  if (category === 'sales') return app.category === 'marketplaces' && app.implemented;
  return app.category === category;
}

export default function IntegracoesPage() {
  const [data, setData] = useState<IntegrationsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'store' | 'mine'>('store');
  const [category, setCategory] = useState<StoreCategory>('marketplaces');
  const [search, setSearch] = useState('');
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');

  useEffect(() => {
    void (async () => {
      try {
        setData(await apiFetch<IntegrationsPayload>('/api/integrations'));
      } catch {
        setLoadError('Não foi possível carregar a loja de integrações.');
      }
    })();
  }, []);

  const pool = useMemo(() => {
    const apps = data?.apps ?? [];
    return tab === 'mine' ? apps.filter((app) => app.status !== 'available') : apps;
  }, [data, tab]);

  const visible = pool.filter((app) => {
    if (!matchesCategory(app, category)) return false;
    const term = search.trim().toLowerCase();
    return term.length === 0 || app.name.toLowerCase().includes(term);
  });

  return (
    <main className="min-h-full bg-[#f4f5f7] px-6 py-8 text-zinc-900">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setTab('store')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                tab === 'store' ? 'bg-emerald-600 text-white' : 'text-zinc-600'
              }`}
            >
              <Store className="h-4 w-4" />
              Loja
            </button>
            <button
              type="button"
              onClick={() => setTab('mine')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                tab === 'mine' ? 'bg-emerald-600 text-white' : 'text-zinc-600'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Meus Apps
            </button>
          </div>
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Pesquisar aplicativos</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar aplicativos..."
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
            />
          </label>
          <p className="text-sm text-zinc-500">{visible.length} registros</p>
          <Link href="/canais" className="text-sm font-semibold text-emerald-700">
            Canais de venda
          </Link>
        </div>

        {data && (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
            {data.publicWebhooks?.bling
              ? <>Endereço fixo do Bling: <span className="font-mono text-zinc-900">{data.publicWebhooks.bling}</span></>
              : 'O endereço público ainda não está definido. Grave PUBLIC_BASE_URL com o seu domínio e reinicie a API.'}
          </p>
        )}

        {loadError && (
          <div role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
        )}
        {!data && !loadError && <p className="mt-6 text-sm text-zinc-500" role="status">Carregando integrações...</p>}

        {data && (
          <div className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]">
            <nav aria-label="Categorias">
              <h2 className="px-3 text-lg font-semibold text-zinc-800">Categorias</h2>
              <ul className="mt-3">
                {data.categories.map((item) => {
                  const count = pool.filter((app) => matchesCategory(app, item.id)).length;
                  const selected = category === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setCategory(item.id)}
                        className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm ${
                          selected
                            ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800'
                            : 'border-transparent text-zinc-600 hover:bg-white'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="text-zinc-400">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section className="grid content-start gap-4 sm:grid-cols-2">
              {visible.length === 0 && (
                <p className="text-sm text-zinc-500">Nenhum aplicativo nesta categoria.</p>
              )}
              {visible.map((app) => (
                <article key={app.id} className="flex min-h-[180px] flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${MARK[app.id] ?? 'bg-zinc-200 text-zinc-800'}`}>
                      {app.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3 className="font-semibold text-zinc-900">{app.name}</h3>
                      <p className="text-xs text-zinc-400">{app.category === 'erps' ? 'ERP' : app.category === 'logistics' ? 'Logística' : 'Marketplaces'}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-3 flex-1 text-sm text-zinc-500">{COPY[app.id] ?? app.reason ?? 'Integração do catálogo.'}</p>
                  {app.reason && <p className="mt-2 text-xs text-amber-700">{app.reason}</p>}
                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-sm">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${app.status === 'attention' ? 'text-amber-600' : app.status === 'installed' ? 'text-emerald-600' : 'text-zinc-400'}`}>
                      {app.status === 'installed' && <Check className="h-4 w-4" />}
                      {app.status === 'attention' && <AlertTriangle className="h-4 w-4" />}
                      {app.statusLabel}
                    </span>
                    {isAdmin && app.status === 'attention' && app.authorizePath && (
                      <a href={`${API_BASE_URL}${app.authorizePath}`} className="font-semibold text-amber-700">
                        Reautorizar
                      </a>
                    )}
                    {app.status === 'installed' && (
                      <Link href="/canais" className="font-semibold text-emerald-700">
                        Configurar
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
