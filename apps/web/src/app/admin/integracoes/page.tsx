'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Factory, LayoutGrid, Search, Store, Truck } from 'lucide-react';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch } from '../../../utils/api-client';
import { MERCADO_LIVRE_ACTIVE } from '../../../config/channels';
import { AppStoreCard, StoreCardStatus } from '../../../components/integrations/app-store-card';

type CategoryFilter = 'todos' | 'Marketplace' | 'ERP' | 'Logística';

interface CatalogApp {
  id: string;
  name: string;
  slug: string;
  category: 'Marketplace' | 'ERP' | 'Logística';
  logoUrl: string | null;
  isInstalled: boolean;
  isAvailable: boolean;
  hasCredentials: boolean;
  hasToken: boolean;
  tokenValid: boolean;
  health: 'ok' | 'attention' | 'available' | 'soon';
}

const FILTERS: Array<{ id: CategoryFilter; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'todos', label: 'Todos', icon: LayoutGrid },
  { id: 'Marketplace', label: 'Canais de venda', icon: Store },
  { id: 'ERP', label: 'ERP', icon: Factory },
  { id: 'Logística', label: 'Logística', icon: Truck },
];

const COPY: Record<string, string> = {
  bling: 'Sincronize produtos, estoque e preço a partir do ERP.',
  nuvemshop: 'Sincronize catálogo e estoque com a loja.',
  mercadolivre: 'Sincronize anúncios. A autorização OAuth precisa ser refeita.',
  amazon: 'Sincronize produtos, estoque e pedidos.',
  shopee: 'Publique catálogo na Shopee. Preço e estoque continuam no ERP.',
  tiktok: 'Sincronize produtos, estoque e pedidos.',
};

function storeStatus(app: CatalogApp): StoreCardStatus {
  if (!app.isAvailable) return 'coming_soon';
  if (app.slug === 'mercadolivre' && !MERCADO_LIVRE_ACTIVE) return 'action';
  if (app.tokenValid) return 'connected';
  if (app.hasCredentials || app.hasToken || app.health === 'attention') return 'action';
  return 'disconnected';
}

export default function AdminIntegrationsPage() {
  const router = useRouter();
  const { currentUser, hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>('todos');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<CatalogApp | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');

  const reloadApps = async () => {
    const payload = await apiFetch<{ groups: Array<{ apps: CatalogApp[] }> }>('/api/admin/integrations');
    setApps(payload.groups.flatMap((group) => group.apps));
  };

  useEffect(() => {
    if (!currentUser.id) return;
    if (!isAdmin) router.replace('/?erro=403');
  }, [currentUser.id, isAdmin, router]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('nuvemshop') === 'conectado') {
      setNotice('Nuvemshop autorizada. O token da loja não tem prazo de validade.');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void reloadApps().catch(() => setError('Não foi possível ler o catálogo de integrações.'));
  }, [isAdmin]);

  const term = search.trim().toLowerCase();
  const matchesSearch = (app: CatalogApp) =>
    term.length === 0 || app.name.toLowerCase().includes(term) || app.category.toLowerCase().includes(term);

  const inFilter = (app: CatalogApp) => filter === 'todos' || app.category === filter;
  const visible = useMemo(
    () => apps.filter((app) => inFilter(app) && matchesSearch(app)),
    [apps, filter, term]
  );
  const recommended = filter === 'todos'
    ? visible.filter((app) => {
      const status = storeStatus(app);
      return status === 'action' || status === 'disconnected';
    })
    : [];
  const recommendedIds = new Set(recommended.map((app) => app.id));
  const rest = visible.filter((app) => !recommendedIds.has(app.id));

  const openCredentials = async (app: CatalogApp) => {
    setCredentialsFor(app);
    setClientSecret('');
    setWebhookSecret('');
    setAccessToken('');
    setNotice(null);
    try {
      const saved = await apiFetch<{ clientId: string; callbackUrl: string }>(`/api/admin/integrations/${app.slug}/credentials`);
      setClientId(saved.clientId);
      setCallbackUrl(saved.callbackUrl);
    } catch {
      setClientId('');
      setCallbackUrl('');
      setNotice('Não foi possível ler as credenciais.');
    }
  };

  const saveCredentials = async () => {
    if (!credentialsFor) return;
    try {
      await apiFetch(`/api/admin/integrations/${credentialsFor.slug}/credentials`, {
        method: 'PUT',
        json: {
          clientId,
          ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
          ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        },
      });
      setNotice(credentialsFor.slug === 'nuvemshop' && accessToken.trim()
        ? 'Token da Nuvemshop gravado. A loja fica autorizada sem instalar aplicativo.'
        : 'Credenciais salvas. O segredo não volta para a tela.');
      setClientSecret('');
      setWebhookSecret('');
      setAccessToken('');
      setCredentialsFor(null);
      await reloadApps();
    } catch {
      setNotice('Informe o Client ID e o Client Secret na primeira gravação.');
    }
  };

  const disconnectApp = async (app: CatalogApp) => {
    try {
      await apiFetch(`/api/admin/integrations/${app.slug}/disconnect`, { method: 'POST' });
      setNotice(`${app.name} desconectado. As credenciais do aplicativo continuam salvas.`);
      await reloadApps();
    } catch {
      setNotice('Não foi possível desconectar.');
    }
  };

  const connectApp = (app: CatalogApp) => {
    if (app.slug === 'nuvemshop' || !app.hasCredentials) {
      void openCredentials(app);
      return;
    }
    window.location.href = `/oauth/${app.slug}/authorize`;
  };

  const requestApp = async (app: CatalogApp) => {
    try {
      await apiFetch(`/api/admin/integrations/${app.slug}/request`, { method: 'POST' });
      setNotice(`Pedido de ${app.name} registrado.`);
    } catch {
      setNotice('Não foi possível registrar o pedido.');
    }
  };

  const renderCard = (app: CatalogApp) => (
    <AppStoreCard
      key={app.id}
      id={app.slug}
      name={app.name}
      category={app.category === 'Marketplace' ? 'Canal de venda' : app.category}
      description={COPY[app.slug] ?? 'Sincronize dados deste conector com o HUB.'}
      status={storeStatus(app)}
      onConfigure={() => void openCredentials(app)}
      onDisconnect={() => void disconnectApp(app)}
      onConnect={() => connectApp(app)}
      onNotify={() => void requestApp(app)}
    />
  );

  if (!isAdmin) {
    return <main className="px-6 py-8 text-sm text-text-muted">Acesso restrito ao administrador.</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Loja de integrações</h1>
        <p className="mt-1 text-sm text-text-muted">ERP, marketplaces e logística. Só o administrador configura.</p>
        <label className="relative mx-auto mt-4 block max-w-xl">
          <span className="sr-only">Buscar integração</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por ERP, Marketplace ou Logística..."
            className="w-full rounded-full border border-border-color bg-bg-surface py-2.5 pl-10 pr-4 text-sm"
          />
        </label>
      </header>
      {error && <p className="mt-4 text-sm text-rose-600" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-center text-sm text-text-muted" role="status">{notice}</p>}

      <div className="mt-8 grid gap-6 md:grid-cols-[220px_1fr]">
        <nav aria-label="Categorias">
          <ul>
            {FILTERS.map((item) => {
              const Icon = item.icon;
              const count = item.id === 'todos' ? apps.length : apps.filter((app) => app.category === item.id).length;
              const selected = filter === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm ${selected ? 'border-emerald-600 font-semibold text-text-primary' : 'border-transparent text-text-muted'}`}
                  >
                    <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4" />{item.label}</span>
                    <span className="tabular-nums">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div>
          {recommended.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-text-primary">Recomendados para você</h2>
              <div className="grid content-start gap-3 sm:grid-cols-2">{recommended.map(renderCard)}</div>
            </section>
          )}
          <section className={recommended.length > 0 ? 'mt-6' : ''}>
            {rest.length === 0 && recommended.length === 0 && <p className="text-sm text-text-muted">Nenhuma integração neste filtro.</p>}
            <div className="grid content-start gap-3 sm:grid-cols-2">{rest.map(renderCard)}</div>
          </section>
        </div>
      </div>

      {credentialsFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-border-color bg-bg-surface p-5 text-sm">
            <h2 className="font-bold">Configurar {credentialsFor.name}</h2>
            <label className="mt-3 block text-xs text-text-muted">
              {credentialsFor.slug === 'nuvemshop' ? 'ID da loja' : 'Client ID'}
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded border border-border-color bg-bg-base px-2 py-1.5" />
            </label>
            <label className="mt-2 block text-xs text-text-muted">
              Client Secret
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className="mt-1 w-full rounded border border-border-color bg-bg-base px-2 py-1.5" />
            </label>
            <label className="mt-2 block text-xs text-text-muted">
              Segredo do webhook
              <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} className="mt-1 w-full rounded border border-border-color bg-bg-base px-2 py-1.5" />
            </label>
            {credentialsFor.slug === 'nuvemshop' && (
              <label className="mt-2 block text-xs text-text-muted">
                Token de acesso
                <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} className="mt-1 w-full rounded border border-border-color bg-bg-base px-2 py-1.5" autoComplete="off" />
              </label>
            )}
            <div className="mt-2 flex gap-2">
              <input readOnly value={callbackUrl} placeholder="O callback aparece depois de salvar" className="w-full rounded border border-border-color bg-bg-base px-2 py-1.5 font-mono text-[11px]" />
              <button type="button" className="shrink-0 rounded border border-border-color px-2 text-xs font-semibold" onClick={() => void navigator.clipboard.writeText(callbackUrl)}>Copiar</button>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void saveCredentials()}>Salvar</button>
              <button type="button" className="text-xs text-text-muted underline" onClick={() => setCredentialsFor(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
