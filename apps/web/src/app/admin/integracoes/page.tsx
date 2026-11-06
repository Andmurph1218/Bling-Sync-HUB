'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch } from '../../../utils/api-client';

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
  tokenValid: boolean;
  health: 'ok' | 'attention' | 'available' | 'soon';
}

const FILTERS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'Marketplace', label: 'Canais de Venda' },
  { id: 'ERP', label: 'ERP' },
  { id: 'Logística', label: 'Logística' },
];

const MARK: Record<string, string> = {
  mercadolivre: 'bg-amber-400 text-zinc-950',
  nuvemshop: 'bg-sky-600 text-white',
  shopee: 'bg-orange-500 text-white',
  amazon: 'bg-zinc-800 text-white',
  tiktok: 'bg-zinc-900 text-white',
  bling: 'bg-emerald-600 text-white',
  omie: 'bg-blue-700 text-white',
  correios: 'bg-yellow-500 text-zinc-950',
  melhorenvio: 'bg-zinc-700 text-white',
};

export default function AdminIntegrationsPage() {
  const router = useRouter();
  const { currentUser, hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>('todos');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<CatalogApp | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');

  useEffect(() => {
    if (!currentUser.id) return;
    if (!isAdmin) router.replace('/?erro=403');
  }, [currentUser.id, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    void apiFetch<{ groups: Array<{ apps: CatalogApp[] }> }>('/api/admin/integrations')
      .then((payload) => setApps(payload.groups.flatMap((group) => group.apps)))
      .catch(() => setError('Não foi possível ler o catálogo de integrações.'));
  }, [isAdmin]);

  if (!isAdmin) {
    return <main className="px-6 py-8 text-sm text-zinc-300">Acesso restrito ao administrador.</main>;
  }

  const visible = apps.filter((app) => filter === 'todos' || app.category === filter);

  const openCredentials = async (app: CatalogApp) => {
    setCredentialsFor(app);
    setClientSecret('');
    setWebhookSecret('');
    setNotice(null);
    try {
      const saved = await apiFetch<{ clientId: string; callbackUrl: string }>(
        `/api/admin/integrations/${app.slug}/credentials`
      );
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
        },
      });
      setNotice('Credenciais salvas. O segredo não volta para a tela.');
      setClientSecret('');
      const payload = await apiFetch<{ groups: Array<{ apps: CatalogApp[] }> }>('/api/admin/integrations');
      setApps(payload.groups.flatMap((group) => group.apps));
    } catch {
      setNotice('Informe o Client ID e o Client Secret na primeira gravação.');
    }
  };

  const requestApp = async (app: CatalogApp) => {
    try {
      await apiFetch(`/api/admin/integrations/${app.slug}/request`, { method: 'POST' });
      setNotice(`Pedido de ${app.name} registrado.`);
    } catch {
      setNotice('Não foi possível registrar o pedido.');
    }
  };

  return (
    <main className="min-h-full bg-[#f4f5f7] px-6 py-8 text-zinc-900">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">Loja de integrações</h1>
        <p className="mt-1 text-sm text-zinc-500">Aplicativos de ERP, canais de venda e logística. Só o administrador configura.</p>
        {error && <p className="mt-4 text-sm text-rose-700" role="alert">{error}</p>}
        {notice && <p className="mt-4 text-sm text-emerald-800" role="status">{notice}</p>}
        <div className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]">
          <nav aria-label="Categorias">
            <h2 className="px-3 text-lg font-semibold">Categorias</h2>
            <ul className="mt-3">
              {FILTERS.map((item) => {
                const count = item.id === 'todos' ? apps.length : apps.filter((app) => app.category === item.id).length;
                const selected = filter === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm ${
                        selected ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800' : 'border-transparent text-zinc-600 hover:bg-white'
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
            {visible.map((app) => {
              const soon = !app.isAvailable;
              const healthy = app.hasCredentials && app.tokenValid;
              return (
                <article key={app.id} className={`flex min-h-[180px] flex-col rounded-xl border bg-white p-5 shadow-sm ${soon ? 'border-zinc-200 opacity-80' : 'border-zinc-200'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold ${MARK[app.slug] ?? 'bg-zinc-200'}`}>
                      {app.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3 className="font-semibold">{app.name}</h3>
                      <p className="text-xs text-zinc-500">{app.category === 'Marketplace' ? 'Canal de venda' : app.category}</p>
                    </div>
                    <span className={`ml-auto mt-1 h-2.5 w-2.5 rounded-full ${soon ? 'bg-zinc-300' : healthy ? 'bg-emerald-500' : app.hasCredentials ? 'bg-amber-400' : 'bg-zinc-300'}`} title={healthy ? 'Token válido' : app.hasCredentials ? 'Token expirado' : 'Sem credenciais'} />
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">
                    {soon ? 'Em breve' : healthy ? 'Credenciais salvas e token válido' : app.hasCredentials ? 'Credenciais salvas. Token expirado.' : 'Ainda sem credenciais'}
                  </p>
                  <div className="mt-auto pt-4">
                    {soon ? (
                      <button type="button" className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700" onClick={() => void requestApp(app)}>
                        Solicitar Integração
                      </button>
                    ) : (
                      <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void openCredentials(app)}>
                        Configurar
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </div>
      {credentialsFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 text-sm">
            <h2 className="font-bold">Credenciais · {credentialsFor.name}</h2>
            <label className="mt-3 block text-xs text-zinc-600">
              Client ID
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5" />
            </label>
            <label className="mt-2 block text-xs text-zinc-600">
              Client Secret
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5" />
            </label>
            <label className="mt-2 block text-xs text-zinc-600">
              Segredo do webhook
              <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5" />
            </label>
            <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{callbackUrl || 'O callback aparece depois de salvar.'}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void saveCredentials()}>Salvar</button>
              <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setCredentialsFor(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
