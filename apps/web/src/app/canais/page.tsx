'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, HelpCircle, Plus } from 'lucide-react';
import { useCurrentRole } from '../../components/app-shell';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { ChannelCard } from '../../components/channels/channel-card';
import { IntegrationCatalogModal } from '../../components/channels/integration-catalog-modal';
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
  warehouses: Array<{ bling_warehouse_id: string; name: string; role: string; include_in_push: boolean }>;
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
  const warehouses = data?.warehouses ?? [];
  const unclassified = warehouses.filter((warehouse) => warehouse.role === 'unclassified');
  const sellerCount = warehouses.filter((warehouse) => warehouse.role === 'seller' && warehouse.include_in_push).length;
  const fullCount = warehouses.filter((warehouse) => warehouse.role === 'ml_full').length;
  const damagedCount = warehouses.filter((warehouse) => warehouse.role === 'damaged').length;

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

          <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-color bg-bg-surface p-6">
            <div className="max-w-xl">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Depósitos de estoque</h2>
                <span title="O estoque enviado ao marketplace é a soma dos saldos virtuais dos depósitos de Venda. Full e Avaria nunca entram nesta soma.">
                  <HelpCircle className="h-4 w-4 text-text-muted" aria-label="Regra da soma de estoque" />
                </span>
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {sellerCount} de venda · {fullCount} Full · {damagedCount} avaria · {unclassified.length} sem classificação
              </p>
              {sellerCount === 0 && (
                <p className="mt-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Nenhum depósito de venda classificado. Nenhum produto entra na lista de envio.
                </p>
              )}
            </div>
            <Link
              href="/canais/depositos"
              className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {sellerCount === 0 || unclassified.length > 0 ? 'Classificar depósitos' : 'Ver depósitos'}
            </Link>
          </section>
        </>
      )}

      {catalogOpen && <IntegrationCatalogModal onClose={() => setCatalogOpen(false)} />}
    </main>
  );
}
