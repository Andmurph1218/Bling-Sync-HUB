'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, MoreVertical, Plus, Search, Warehouse } from 'lucide-react';
import { useCurrentRole } from '../../components/app-shell';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { BrandLogo } from '../../components/brand-logo';

interface ChannelRow {
  id: string;
  name: string;
  storeName: string | null;
  health: 'ok' | 'attention' | 'down';
  healthLabel: string;
  reason: string | null;
  stockOwner: string | null;
  contentOwner: string | null;
  enrichmentMode: string | null;
  killSwitch: boolean | null;
}

interface WarehouseRow {
  bling_warehouse_id: string;
  name: string;
  role: string;
  include_in_push: boolean;
}

interface ChannelsPayload {
  catalogMode: { badge: string };
  channels: ChannelRow[];
  warehouses: WarehouseRow[];
}

interface WebhookEvent {
  id: string;
  eventType: string;
  resourceId: string;
  status: string;
  createdAt: string;
}

interface TestResult {
  ok: boolean;
  statusLabel: string;
  reason: string | null;
}

interface SettingsResult {
  statusLabel: string;
  reason: string | null;
  expiresAt: string | null;
  authorizePath: string | null;
  catalogMode: { badge: string };
  store: { name: string; bling_loja_id: string } | null;
  syncOwner: { stockPrice: string; content: string } | null;
}

const HEALTH_DOT: Record<ChannelRow['health'], string> = {
  ok: 'bg-emerald-500',
  attention: 'bg-amber-400',
  down: 'bg-rose-500',
};

const ROLE_LABEL: Record<string, string> = {
  seller: 'Depósito próprio (seller)',
  ml_full: 'Espelho do Full (ml_full)',
  other: 'Outro',
  unclassified: 'Não classificado',
};

const OWNER_LABEL: Record<string, string> = {
  bling_native: 'Integração nativa do Bling',
  hub: 'JH Sync Hub',
};

export default function CanaisConfiguracoesPage() {
  const [data, setData] = useState<ChannelsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(15);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ channelId: string; kind: 'logs' | 'test' | 'settings' } | null>(null);
  const [logs, setLogs] = useState<WebhookEvent[] | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');

  useEffect(() => {
    void (async () => {
      try {
        setData(await apiFetch<ChannelsPayload>('/api/integrations/channels'));
      } catch {
        setLoadError('Não foi possível carregar os canais de venda.');
      }
    })();
  }, []);

  async function runAction(channelId: string, kind: 'logs' | 'test' | 'settings') {
    setOpenMenu(null);
    setPanel({ channelId, kind });
    setLogs(null);
    setTestResult(null);
    setSettings(null);
    setActionError(null);
    try {
      if (kind === 'logs') {
        const body = await apiFetch<{ events: WebhookEvent[] }>(`/api/integrations/${channelId}/webhooks`);
        setLogs(body.events);
      } else if (kind === 'test') {
        setTestResult(await apiFetch<TestResult>(`/api/integrations/${channelId}/test`, { method: 'POST' }));
      } else {
        setSettings(await apiFetch<SettingsResult>(`/api/integrations/${channelId}/settings`));
      }
    } catch {
      setActionError('Não foi possível concluir a ação deste canal.');
    }
  }

  const term = search.trim().toLowerCase();
  const filtered = (data?.channels ?? []).filter((channel) => {
    if (term.length === 0) return true;
    return channel.name.toLowerCase().includes(term) || (channel.storeName ?? '').toLowerCase().includes(term);
  });
  const visible = filtered.slice(0, pageSize);

  return (
    <main className="min-h-full bg-bg-base px-6 py-8 text-text-primary">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Canais de venda</h1>
            <p className="mt-1 text-sm text-text-muted">Gerencie os canais de venda da sua operação</p>
          </div>
          <Link href="/integracoes" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-text-primary">
            <Plus className="h-4 w-4" />
            Adicionar canal
          </Link>
        </header>

        <p className="mt-4 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          {data?.catalogMode.badge ?? 'Modo Catálogo (Webhooks de Pedido Desativados)'}
        </p>

        {loadError && (
          <div role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
        )}
        {!data && !loadError && <p className="mt-6 text-sm text-text-muted" role="status">Carregando canais...</p>}

        {data && (
          <>
            <section className="mt-4 overflow-hidden rounded-xl border border-border-color bg-bg-surface shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border-color px-4 py-3">
                <label className="relative w-full max-w-sm">
                  <span className="sr-only">Pesquisar canais</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Pesquisar..."
                    className="w-full rounded-lg border border-border-color py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
                  />
                </label>
                <p className="shrink-0 text-sm text-text-muted">{filtered.length} registros</p>
              </div>
              <p className="border-b border-border-color bg-bg-surface px-4 py-2 text-xs text-text-muted">Canal de venda</p>
              <ul>
                {visible.length === 0 && <li className="px-4 py-6 text-sm text-text-muted">Nenhum canal encontrado.</li>}
                {visible.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-4 border-b border-border-color px-4 py-4 last:border-b-0">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_DOT[channel.health]}`} title={channel.healthLabel} />
                    <BrandLogo id={channel.id} name={channel.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-text-primary">{channel.name}</p>
                      <p className="text-xs text-text-muted">
                        Provedor: {channel.name}
                        {channel.storeName ? ` · ${channel.storeName}` : ''}
                      </p>
                      {channel.health !== 'ok' && (
                        <p className="text-xs font-medium text-amber-700">{channel.healthLabel}</p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`Ações de ${channel.name}`}
                          aria-expanded={openMenu === channel.id}
                          onClick={() => setOpenMenu(openMenu === channel.id ? null : channel.id)}
                          className="rounded-md p-1.5 text-text-muted hover:bg-bg-base"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openMenu === channel.id && (
                          <div role="menu" className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-border-color bg-bg-surface py-1 text-left text-xs shadow-lg">
                            <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-text-muted hover:bg-bg-surface" onClick={() => void runAction(channel.id, 'logs')}>
                              Logs de Webhook
                            </button>
                            <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-text-muted hover:bg-bg-surface" onClick={() => void runAction(channel.id, 'test')}>
                              Testar Conexão
                            </button>
                            <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-text-muted hover:bg-bg-surface" onClick={() => void runAction(channel.id, 'settings')}>
                              Configurações da Conta
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-border-color px-4 py-3">
                <label className="text-xs text-text-muted">
                  <span className="sr-only">Registros por página</span>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="rounded-md border border-border-color bg-bg-surface px-2 py-1 text-sm text-text-muted"
                  >
                    <option value={15}>15</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>
            </section>

            {panel && (
              <section className="mt-4 rounded-xl border border-border-color bg-bg-surface p-4 text-sm text-text-muted shadow-sm">
                <h2 className="font-semibold text-text-primary">
                  {panel.kind === 'logs' ? 'Logs de Webhook' : panel.kind === 'test' ? 'Teste de conexão' : 'Configurações da conta'}
                </h2>
                {actionError && <p className="mt-2 text-rose-700">{actionError}</p>}
                {panel.kind === 'logs' && logs && logs.length === 0 && <p className="mt-2">Nenhum webhook recebido para este canal.</p>}
                {panel.kind === 'logs' && logs && logs.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {logs.map((event) => (
                      <li key={event.id}>
                        {event.eventType} · {event.resourceId} · {event.status} · {new Date(event.createdAt).toLocaleString('pt-BR')}
                      </li>
                    ))}
                  </ul>
                )}
                {panel.kind === 'test' && testResult && (
                  <p className="mt-2">
                    {testResult.statusLabel}
                    {testResult.reason ? `. ${testResult.reason}` : ''}
                  </p>
                )}
                {panel.kind === 'settings' && settings && (
                  <div className="mt-2 space-y-1">
                    <p>Status: {settings.statusLabel}</p>
                    {settings.reason && <p>{settings.reason}</p>}
                    {settings.expiresAt && <p>Expira em {new Date(settings.expiresAt).toLocaleString('pt-BR')}</p>}
                    {settings.store && <p>Loja no Bling: {settings.store.name} ({settings.store.bling_loja_id})</p>}
                    {settings.syncOwner && (
                      <p>
                        Estoque e preço: {OWNER_LABEL[settings.syncOwner.stockPrice] ?? settings.syncOwner.stockPrice}. Conteúdo:{' '}
                        {OWNER_LABEL[settings.syncOwner.content] ?? settings.syncOwner.content}.
                      </p>
                    )}
                    <p>{settings.catalogMode.badge}</p>
                    {settings.authorizePath && (
                      <a href={`${API_BASE_URL}${settings.authorizePath}`} className="mt-2 inline-flex rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-text-primary">
                        Reautorizar
                      </a>
                    )}
                  </div>
                )}
              </section>
            )}

            <section className="mt-8 rounded-xl border border-border-color bg-bg-surface p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Warehouse className="h-5 w-5 text-sky-600" />
                <h2 className="text-base font-semibold text-text-primary">Depósitos do Bling e regra de soma de estoque</h2>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                O estoque publicado soma apenas o saldo virtual dos depósitos seller marcados para entrar na soma. Depósitos espelho do Full nunca entram.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Depósitos do Bling</caption>
                  <thead className="border-b border-border-color text-[11px] uppercase text-text-muted">
                    <tr>
                      <th scope="col" className="py-2.5 pr-4">ID no Bling</th>
                      <th scope="col" className="py-2.5 px-4">Nome</th>
                      <th scope="col" className="py-2.5 px-4">Classificação</th>
                      <th scope="col" className="py-2.5 pl-4">Entra na soma publicada?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-color">
                    {data.warehouses.map((warehouse) => (
                      <tr key={warehouse.bling_warehouse_id}>
                        <td className="py-3 pr-4 font-mono font-semibold text-emerald-700">{warehouse.bling_warehouse_id}</td>
                        <td className="py-3 px-4 font-semibold text-text-primary">{warehouse.name}</td>
                        <td className="py-3 px-4 text-text-muted">{ROLE_LABEL[warehouse.role] ?? warehouse.role}</td>
                        <td className={`py-3 pl-4 font-semibold ${warehouse.include_in_push ? 'text-emerald-700' : 'text-text-muted'}`}>
                          {warehouse.include_in_push ? 'Sim' : 'Não'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.warehouses.some((warehouse) => warehouse.role === 'unclassified') && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Há depósitos não classificados. Eles não entram no estoque publicado até um administrador classificá-los.</span>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
