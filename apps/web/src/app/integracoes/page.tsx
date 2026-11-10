'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useCurrentRole } from '../../components/app-shell';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { IntegrationCard, type CardStatus } from '../../components/integrations/integration-card';
import { ExplorarIntegracoes } from '../../components/integrations/explorar-integracoes';
import { MinhasConexoes } from '../../components/integrations/minhas-conexoes';

type AppCategory = 'marketplaces' | 'erps' | 'logistics';
type FilterId = 'all' | 'erps' | 'marketplaces';

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
  apps: IntegrationAppCard[];
  publicWebhooks?: { bling: string | null };
}

const COPY: Record<string, string> = {
  mercadolivre: 'Sincronize catálogo e estoque para o Mercado Livre. Requer autorização OAuth.',
  nuvemshop: 'Publique catálogo e estoque na loja. A escrita ao vivo continua desligada.',
  shopee: 'Marketplace previsto. O conector ainda não recebe catálogo.',
  amazon: 'Marketplace previsto. O conector ainda não recebe catálogo.',
  tiktok: 'Canal previsto. O conector ainda não está instalado.',
  bling: 'ERP do catálogo, do estoque e do preço. O HUB não processa pedidos.',
};

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'erps', label: 'ERP (Bling)' },
  { id: 'marketplaces', label: 'Marketplaces' },
];

function cardStatus(app: IntegrationAppCard): CardStatus {
  if (!app.implemented) return 'coming_soon';
  if (app.status === 'installed') return 'connected';
  if (app.status === 'attention') return 'attention';
  return 'disconnected';
}

function categoryLabel(category: AppCategory): string {
  if (category === 'erps') return 'ERP';
  if (category === 'logistics') return 'Logística';
  return 'Marketplace';
}

function AppGrid({
  apps,
  canManage,
  onConfigure,
  onDisconnect,
}: {
  apps: IntegrationAppCard[];
  canManage: boolean;
  onConfigure: (app: IntegrationAppCard) => void;
  onDisconnect: (app: IntegrationAppCard) => void;
}) {
  if (apps.length === 0) return <p className="text-sm text-text-muted">Nenhuma integração neste filtro.</p>;
  return (
    <div className="grid content-start gap-4 sm:grid-cols-2">
      {apps.map((app) => {
        const status = cardStatus(app);
        return (
          <IntegrationCard
            key={app.id}
            id={app.id}
            name={app.name}
            categoryLabel={categoryLabel(app.category)}
            description={COPY[app.id] ?? 'Integração do catálogo.'}
            status={status}
            canManage={canManage}
            onConfigure={() => onConfigure(app)}
            onDisconnect={() => onDisconnect(app)}
            onConnect={app.authorizePath ? () => { window.location.href = `${API_BASE_URL}${app.authorizePath}`; } : undefined}
          />
        );
      })}
    </div>
  );
}

export default function IntegracoesPage() {
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');
  const [data, setData] = useState<IntegrationsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'explore'>('mine');
  const [filter, setFilter] = useState<FilterId>('all');
  const [search, setSearch] = useState('');
  const [credentialsFor, setCredentialsFor] = useState<IntegrationAppCard | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [hasSavedSecret, setHasSavedSecret] = useState(false);

  const load = async () => {
    try {
      setData(await apiFetch<IntegrationsPayload>('/api/integrations'));
      setLoadError(null);
    } catch {
      setLoadError('Não foi possível carregar a loja de integrações.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const mine = useMemo(
    () => (data?.apps ?? []).filter((app) => app.implemented && app.status !== 'available'),
    [data]
  );
  const pool = tab === 'mine' ? mine : (data?.apps ?? []);
  const visible = pool.filter((app) => {
    if (filter === 'erps' && app.category !== 'erps') return false;
    if (filter === 'marketplaces' && app.category !== 'marketplaces') return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return app.name.toLowerCase().includes(term) || categoryLabel(app.category).toLowerCase().includes(term);
  });

  const openCredentials = async (app: IntegrationAppCard) => {
    setCredentialsFor(app);
    setNotice(null);
    setClientSecret('');
    setWebhookSecret('');
    try {
      const saved = await apiFetch<{ clientId: string; callbackUrl: string; hasClientSecret: boolean }>(
        `/api/admin/integrations/${app.id}/credentials`
      );
      setClientId(saved.clientId);
      setCallbackUrl(saved.callbackUrl);
      setHasSavedSecret(saved.hasClientSecret);
    } catch {
      setClientId('');
      setCallbackUrl('');
      setHasSavedSecret(false);
      setNotice('Não foi possível ler as credenciais.');
    }
  };

  const saveCredentials = async () => {
    if (!credentialsFor) return;
    try {
      const saved = await apiFetch<{ callbackUrl: string; hasClientSecret: boolean }>(
        `/api/admin/integrations/${credentialsFor.id}/credentials`,
        {
          method: 'PUT',
          json: {
            clientId,
            ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
            ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
          },
        }
      );
      setCallbackUrl(saved.callbackUrl);
      setHasSavedSecret(saved.hasClientSecret);
      setClientSecret('');
      setWebhookSecret('');
      setCredentialsFor(null);
      setNotice('Credenciais salvas. O segredo não volta para a tela.');
      await load();
    } catch {
      setNotice(hasSavedSecret ? 'Não foi possível atualizar.' : 'Informe o Client Secret na primeira gravação.');
    }
  };

  const disconnect = async (app: IntegrationAppCard) => {
    try {
      await apiFetch(`/api/admin/integrations/${app.id}/disconnect`, { method: 'POST' });
      setNotice(`${app.name} desconectado. Nada foi apagado na loja.`);
      await load();
    } catch {
      setNotice('Não foi possível desconectar.');
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Loja de integrações</h1>
          <p className="mt-1 text-sm text-text-muted">O que já está ligado e o que o HUB ainda pode conectar.</p>
        </div>
        <Link href="/canais" className="text-sm font-semibold text-emerald-700">Canais de venda</Link>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-border-color p-1" role="tablist">
          {([['mine', 'Minhas conexões'], ['explore', 'Explorar integrações']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tab === id ? 'bg-emerald-700 text-white' : 'text-text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Buscar integração</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou categoria" className="w-full rounded-lg border border-border-color bg-bg-surface py-2 pl-9 pr-3 text-sm" />
        </label>
      </div>

      {loadError && <p role="alert" className="mt-4 text-sm text-rose-600">{loadError}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-text-muted">{notice}</p>}
      {!data && !loadError && <p className="mt-6 text-sm text-text-muted">Carregando integrações...</p>}

      {data && (
        <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
          <nav aria-label="Categorias">
            <ul>
              {FILTERS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`flex w-full border-l-2 px-3 py-2 text-left text-sm ${filter === item.id ? 'border-emerald-600 font-semibold text-text-primary' : 'border-transparent text-text-muted'}`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section>
            {tab === 'mine' ? (
              <MinhasConexoes>
                <AppGrid apps={visible} canManage={isAdmin} onConfigure={(app) => void openCredentials(app)} onDisconnect={(app) => void disconnect(app)} />
              </MinhasConexoes>
            ) : (
              <ExplorarIntegracoes>
                <AppGrid apps={visible} canManage={isAdmin} onConfigure={(app) => void openCredentials(app)} onDisconnect={(app) => void disconnect(app)} />
              </ExplorarIntegracoes>
            )}
          </section>
        </div>
      )}

      {credentialsFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Configurar ${credentialsFor.name}`}>
          <div className="w-full max-w-lg rounded-xl border border-border-color bg-bg-surface p-5">
            <h2 className="text-lg font-semibold">Configurar {credentialsFor.name}</h2>
            <label className="mt-4 block text-sm text-text-muted">
              Client ID
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm text-text-muted">
              Client Secret {hasSavedSecret ? '(em branco mantém o atual)' : ''}
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm" autoComplete="off" />
            </label>
            <label className="mt-3 block text-sm text-text-muted">
              Segredo do webhook
              <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm" autoComplete="off" />
            </label>
            <label className="mt-3 block text-sm text-text-muted">
              URL de callback
              <div className="mt-1 flex gap-2">
                <input readOnly value={callbackUrl} className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 font-mono text-xs" />
                <button type="button" className="rounded-lg border border-border-color px-3 text-sm font-semibold" onClick={() => void navigator.clipboard.writeText(callbackUrl)}>Copiar</button>
              </div>
            </label>
            {credentialsFor.id === 'bling' && (
              <label className="mt-3 block text-sm text-text-muted">
                Endereço do webhook no Bling
                <div className="mt-1 flex gap-2">
                  <input readOnly value={data?.publicWebhooks?.bling ?? 'PUBLIC_BASE_URL ainda não definido'} className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 font-mono text-xs" />
                  <button
                    type="button"
                    className="rounded-lg border border-border-color px-3 text-sm font-semibold"
                    onClick={() => void navigator.clipboard.writeText(data?.publicWebhooks?.bling ?? '')}
                  >
                    Copiar
                  </button>
                </div>
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-text-muted" onClick={() => setCredentialsFor(null)}>Fechar</button>
              <button type="button" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => void saveCredentials()}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
