'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch } from '../../../utils/api-client';
import { BrandLogo } from '../../../components/brand-logo';
import { MERCADO_LIVRE_ACTIVE } from '../../../config/channels';

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

const FILTERS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'Marketplace', label: 'Canais de Venda' },
  { id: 'ERP', label: 'ERP' },
  { id: 'Logística', label: 'Logística' },
];

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
  const [accessToken, setAccessToken] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');

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
    void apiFetch<{ groups: Array<{ apps: CatalogApp[] }> }>('/api/admin/integrations')
      .then((payload) => setApps(payload.groups.flatMap((group) => group.apps)))
      .catch(() => setError('Não foi possível ler o catálogo de integrações.'));
  }, [isAdmin]);

  if (!isAdmin) {
    return <main className="px-6 py-8 text-sm text-text-muted">Acesso restrito ao administrador.</main>;
  }

  const visible = apps.filter((app) => filter === 'todos' || app.category === filter);

  const openCredentials = async (app: CatalogApp) => {
    setCredentialsFor(app);
    setClientSecret('');
    setWebhookSecret('');
    setAccessToken('');
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

  const reloadApps = async () => {
    const payload = await apiFetch<{ groups: Array<{ apps: CatalogApp[] }> }>('/api/admin/integrations');
    setApps(payload.groups.flatMap((group) => group.apps));
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

  return (
    <main className="min-h-full bg-bg-base px-6 py-8 text-text-primary">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">Loja de integrações</h1>
        <p className="mt-1 text-sm text-text-muted">Aplicativos de ERP, canais de venda e logística. Só o administrador configura.</p>
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
                        selected ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800' : 'border-transparent text-text-muted hover:bg-bg-surface'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="text-text-muted">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <section className="grid content-start gap-4 sm:grid-cols-2">
            {visible.map((app) => {
              const soon = !app.isAvailable;
              const paused = app.slug === 'mercadolivre' && !MERCADO_LIVRE_ACTIVE;
              const connected = app.tokenValid && !paused;
              const healthy = connected;
              const statusText = soon
                ? 'Em breve'
                  : paused
                  ? 'Conector no código. Desativado até nova autorização.'
                  : !app.hasCredentials
                  ? 'Ainda sem credenciais'
                  : app.tokenValid
                    ? app.slug === 'nuvemshop'
                      ? 'Credenciais salvas. Loja autorizada.'
                      : app.slug === 'bling'
                        ? 'Credenciais salvas. Conta do Bling autorizada.'
                        : 'Credenciais salvas e token válido'
                    : app.slug === 'nuvemshop'
                      ? 'Credenciais salvas. Falta autorizar a loja. O token da Nuvemshop não expira.'
                      : app.hasToken
                        ? 'Credenciais salvas. Token expirado.'
                        : 'Credenciais salvas. Falta autorizar a conta.';
              return (
                <article key={app.id} className={`flex min-h-[180px] flex-col rounded-xl border bg-bg-surface p-5 shadow-sm ${soon ? 'border-border-color opacity-80' : 'border-border-color'}`}>
                  <div className="flex items-start gap-3">
                    <BrandLogo id={app.slug} name={app.name} />
                    <div>
                      <h3 className="font-semibold">{app.name}</h3>
                      <p className="text-xs text-text-muted">{app.category === 'Marketplace' ? 'Canal de venda' : app.category}</p>
                    </div>
                    <span className={`ml-auto mt-1 h-2.5 w-2.5 rounded-full ${soon ? 'bg-text-muted' : healthy ? 'bg-emerald-500' : app.hasCredentials ? 'bg-amber-400' : 'bg-text-muted'}`} title={statusText} />
                  </div>
                  <p className="mt-3 text-xs text-text-muted">
                    {statusText}
                  </p>
                  <div className="mt-auto pt-4">
                    {soon ? (
                      <button type="button" className="rounded-lg bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted" onClick={() => void requestApp(app)}>
                        Em breve
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!paused && !connected && (
                          <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => connectApp(app)}>
                            Conectar
                          </button>
                        )}
                        <button type="button" className="rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold" onClick={() => void openCredentials(app)}>
                          Configurar
                        </button>
                        {app.hasToken && !paused && (
                          <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-700" onClick={() => void disconnectApp(app)}>
                            Desconectar
                          </button>
                        )}
                      </div>
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
          <div className="w-full max-w-md rounded-xl bg-bg-surface p-5 text-sm">
            <h2 className="font-bold">Credenciais · {credentialsFor.name}</h2>
            <label className="mt-3 block text-xs text-text-muted">
              {credentialsFor.slug === 'nuvemshop' ? 'ID da loja' : 'Client ID'}
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded border border-border-color px-2 py-1.5" />
            </label>
            {credentialsFor.slug === 'nuvemshop' && (
              <p className="mt-1 text-[11px] text-text-muted">Use 6667412. Esse número é a loja, não um aplicativo para instalar.</p>
            )}
            <label className="mt-2 block text-xs text-text-muted">
              Client Secret
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className="mt-1 w-full rounded border border-border-color px-2 py-1.5" />
            </label>
            <label className="mt-2 block text-xs text-text-muted">
              Segredo do webhook
              <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} className="mt-1 w-full rounded border border-border-color px-2 py-1.5" />
            </label>
            {credentialsFor.slug === 'nuvemshop' && (
              <label className="mt-2 block text-xs text-text-muted">
                Token de acesso
                <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} className="mt-1 w-full rounded border border-border-color px-2 py-1.5" autoComplete="off" />
                <span className="mt-1 block">Copie o token revelado em Aplicativos sob medida. Ele não expira e substitui a instalação.</span>
              </label>
            )}
            <p className="mt-2 break-all font-mono text-[11px] text-text-muted">{callbackUrl || 'O callback aparece depois de salvar.'}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-text-primary" onClick={() => void saveCredentials()}>Salvar</button>
              <button type="button" className="text-xs text-text-muted underline" onClick={() => setCredentialsFor(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
