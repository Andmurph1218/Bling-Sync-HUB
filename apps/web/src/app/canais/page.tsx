'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle, Plus } from 'lucide-react';
import { useCurrentRole } from '../../components/app-shell';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { ChannelCard } from '../../components/channels/channel-card';
import { IntegrationCatalogModal } from '../../components/channels/integration-catalog-modal';
import { WarehouseConfigTable, WarehouseRow } from '../../components/channels/warehouse-config-table';

interface ChannelRow {
  id: string;
  name: string;
  storeName: string | null;
  health: 'ok' | 'attention' | 'down';
  healthLabel: string;
  reason: string | null;
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

interface SettingsResult {
  statusLabel: string;
  reason: string | null;
  expiresAt: string | null;
  authorizePath: string | null;
  store: { name: string; bling_loja_id: string } | null;
  syncOwner: { stockPrice: string; content: string } | null;
}

const OWNER_LABEL: Record<string, string> = {
  bling_native: 'Integração nativa do Bling',
  hub: 'JH Sync Hub',
};

export default function CanaisConfiguracoesPage() {
  const [data, setData] = useState<ChannelsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [logs, setLogs] = useState<WebhookEvent[] | null>(null);
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');

  const load = async () => {
    try {
      setData(await apiFetch<ChannelsPayload>('/api/integrations/channels'));
      setLoadError(null);
    } catch {
      setLoadError('Não foi possível carregar os canais de venda.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const channel = (id: string) => data?.channels.find((item) => item.id === id);
  const nuvemshop = channel('nuvemshop');
  const mercadoLivre = channel('mercadolivre');
  const nuvemshopConnected = nuvemshop?.health === 'ok';
  const mercadoLivreConnected = MERCADO_LIVRE_ACTIVE && mercadoLivre?.health === 'ok';
  const unclassified = (data?.warehouses ?? []).filter((warehouse) => warehouse.role === 'unclassified');

  const openSettings = async (id: string) => {
    setNotice(null);
    try {
      const [account, events] = await Promise.all([
        apiFetch<SettingsResult>(`/api/integrations/${id}/settings`),
        apiFetch<{ events: WebhookEvent[] }>(`/api/integrations/${id}/webhooks`),
      ]);
      setSettings(account);
      setLogs(events.events);
    } catch {
      setNotice('Não foi possível abrir a configuração deste canal.');
    }
  };

  const disconnect = async (id: string) => {
    try {
      await apiFetch(`/api/admin/integrations/${id}/disconnect`, { method: 'POST' });
      setSettings(null);
      setNotice('Canal desconectado. Os anúncios na loja não foram apagados.');
      await load();
    } catch {
      setNotice('Não foi possível desconectar o canal.');
    }
  };

  const saveWarehouse = async (next: WarehouseRow) => {
    if (!data) return;
    const previous = data.warehouses;
    setData({ ...data, warehouses: previous.map((row) => (row.bling_warehouse_id === next.bling_warehouse_id ? next : row)) });
    try {
      await apiFetch(`/admin/controls/warehouses/${encodeURIComponent(next.bling_warehouse_id)}`, {
        method: 'PUT',
        json: { name: next.name, role: next.role, include_in_push: next.include_in_push },
      });
    } catch {
      setData({ ...data, warehouses: previous });
      setNotice('Não foi possível salvar o depósito. Só depósito próprio entra na soma publicada.');
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Canais de venda</h1>
          <p className="mt-1 text-sm text-text-muted">Marketplaces conectados e a regra de estoque que sai do Bling.</p>
        </div>
        <button type="button" onClick={() => setCatalogOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />
          Adicionar canal
        </button>
      </header>

      <p className="mt-4 inline-flex rounded-full border border-border-color bg-bg-surface px-3 py-1 text-xs font-semibold text-text-muted">
        Sincronização de catálogo (pedidos desativados)
      </p>
      {loadError && <p role="alert" className="mt-4 text-sm text-rose-600">{loadError}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-text-muted">{notice}</p>}

      {!data && !loadError && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-hidden="true">
          <div className="h-36 animate-pulse rounded-xl bg-bg-surface" />
          <div className="h-36 animate-pulse rounded-xl bg-bg-surface" />
        </div>
      )}

      {data && (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <ChannelCard
              id="nuvemshop"
              name="Nuvemshop"
              connected={nuvemshopConnected}
              detail={nuvemshop?.storeName ?? null}
              canManage={isAdmin}
              onConfigure={() => void openSettings('nuvemshop')}
              onDisconnect={() => void disconnect('nuvemshop')}
              onConnect={() => void openSettings('nuvemshop')}
            />
            <ChannelCard
              id="mercadolivre"
              name="Mercado Livre"
              connected={mercadoLivreConnected}
              detail={MERCADO_LIVRE_ACTIVE ? mercadoLivre?.reason ?? null : 'Aguardando nova autorização'}
              canManage={isAdmin}
              onConnect={() => {
                window.location.href = `${API_BASE_URL}/oauth/mercadolivre/authorize`;
              }}
            />
          </section>

          {settings && (
            <section className="mt-4 rounded-xl border border-border-color bg-bg-surface p-4 text-sm">
              <h2 className="font-semibold">Configuração da conta</h2>
              <p className="mt-2 text-text-muted">Status: {settings.statusLabel}</p>
              {settings.reason && <p className="text-text-muted">{settings.reason}</p>}
              {settings.store && <p className="text-text-muted">Loja no Bling: {settings.store.name}</p>}
              {settings.syncOwner && (
                <p className="text-text-muted">
                  Estoque e preço: {OWNER_LABEL[settings.syncOwner.stockPrice] ?? settings.syncOwner.stockPrice}. Conteúdo: {OWNER_LABEL[settings.syncOwner.content] ?? settings.syncOwner.content}.
                </p>
              )}
              {settings.authorizePath && (
                <a href={`${API_BASE_URL}${settings.authorizePath}`} className="mt-3 inline-flex rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
                  Reautorizar
                </a>
              )}
              {logs && logs.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-text-muted">
                  {logs.slice(0, 5).map((event) => (
                    <li key={event.id}>{event.eventType} · {event.status} · {new Date(event.createdAt).toLocaleString('pt-BR')}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="mt-8 rounded-xl border border-border-color bg-bg-surface p-6">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Mapeamento de estoque (ERP para canais)</h2>
              <span title="Regra do HUB: O estoque enviado ao marketplace é a soma dos saldos virtuais dos depósitos marcados como Seller. O depósito ML Full é de responsabilidade do Mercado Livre e nunca entra nesta soma.">
                <HelpCircle className="h-4 w-4 text-text-muted" aria-label="Regra da soma de estoque" />
              </span>
            </div>
            {unclassified.length > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Atenção: você tem {unclassified.length} {unclassified.length === 1 ? 'depósito não classificado' : 'depósitos não classificados'}. O estoque {unclassified.length === 1 ? 'dele' : 'deles'} não será enviado aos canais. Configure {unclassified.length === 1 ? 'abaixo' : 'abaixo'}.
              </p>
            )}
            <div className="mt-4">
              <WarehouseConfigTable warehouses={data.warehouses} canEdit={isAdmin} onChange={(warehouse) => void saveWarehouse(warehouse)} />
            </div>
          </section>
        </>
      )}

      {catalogOpen && <IntegrationCatalogModal onClose={() => setCatalogOpen(false)} />}
    </main>
  );
}
