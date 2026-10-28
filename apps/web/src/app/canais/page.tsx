'use client';

import React, { useEffect, useState } from 'react';
import { Sliders, Warehouse, CheckCircle2, AlertTriangle, HelpCircle, XCircle } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';

interface ChannelsPayload {
  calculatedAt: string;
  channels: {
    oauth: Array<{ provider: string; expires_at: string; updated_at: string; has_refresh: boolean }>;
    stores: Array<{ platform: string; bling_loja_id: string; name: string }>;
    syncOwners: Array<{ platform: string; stock_price: string; content: string }>;
    enrichmentControls: Array<{ platform: string; mode: string; kill_switch: boolean; max_replaces_per_run: number }>;
    warehouses: Array<{ bling_warehouse_id: string; name: string; role: string; include_in_push: boolean }>;
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  bling: 'Bling ERP v3',
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
};

const OWNER_LABEL: Record<string, string> = {
  bling_native: 'Integração nativa do Bling',
  hub: 'Bling Sync HUB',
};

const ROLE_LABEL: Record<string, string> = {
  seller: 'Depósito próprio (seller)',
  ml_full: 'Espelho do Full (ml_full)',
  other: 'Outro',
  unclassified: 'Não classificado',
};

function tokenState(row: ChannelsPayload['channels']['oauth'][number] | undefined) {
  if (!row) return { label: 'Desconectado', tone: 'error' as const };
  const expired = new Date(row.expires_at).getTime() < Date.now();
  if (expired && !row.has_refresh) return { label: 'Token expirado sem renovação automática', tone: 'error' as const };
  if (expired) return { label: 'Token expirado (renovação automática disponível)', tone: 'warning' as const };
  if (!row.has_refresh) return { label: 'Conectado · sem renovação automática', tone: 'warning' as const };
  return { label: 'Conectado · renovação automática ativa', tone: 'ok' as const };
}

const toneClass = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

export default function CanaisConfiguracoesPage() {
  const [data, setData] = useState<ChannelsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await apiFetch<ChannelsPayload>('/api/dashboard/operational-state'));
      } catch {
        setLoadError('Não foi possível carregar o estado dos canais da API local.');
      }
    })();
  }, []);

  const ch = data?.channels;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="border-b border-zinc-800 pb-6">
        <div className="flex items-center gap-2">
          <Sliders className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Canais, Integrações Nativas &amp; Depósitos</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Quem é responsável por estoque/preço e por conteúdo em cada canal, para evitar conflito entre o HUB e a integração nativa do Bling.
          {data && ` Lido em ${new Date(data.calculatedAt).toLocaleString('pt-BR')}.`}
        </p>
      </header>

      {loadError && (
        <div role="alert" className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{loadError}</div>
      )}
      {!data && !loadError && <p className="mt-6 text-sm text-zinc-400" role="status">Carregando canais...</p>}

      {ch && (
        <>
          {/* Conexões OAuth */}
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            {(['bling', 'mercadolivre', 'nuvemshop'] as const).map((p) => {
              const st = tokenState(ch.oauth.find((o) => o.provider === p));
              const row = ch.oauth.find((o) => o.provider === p);
              return (
                <div key={p} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs">
                  <div className="text-sm font-bold text-white">{PLATFORM_LABEL[p]}</div>
                  <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold ${toneClass[st.tone]}`}>
                    {st.tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : st.tone === 'warning' ? <AlertTriangle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {st.label}
                  </span>
                  {row && (
                    <p className="mt-2 text-zinc-400">
                      Expira em: {new Date(row.expires_at).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          {/* 5.4 Monitoramento das integrações nativas */}
          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            {(['mercadolivre', 'nuvemshop'] as const).map((p) => {
              const store = ch.stores.find((s) => s.platform === p);
              const owner = ch.syncOwners.find((o) => o.platform === p);
              const ctrl = ch.enrichmentControls.find((c) => c.platform === p);
              const stockByHub = owner?.stock_price === 'hub';
              return (
                <div key={p} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <h2 className="text-base font-bold text-white">
                    {PLATFORM_LABEL[p]} · {store?.name ?? 'Loja não vinculada'}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Loja no Bling: <code className="text-emerald-400">{store?.bling_loja_id ?? '—'}</code>
                  </p>

                  <div className="mt-4 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-400">Responsável por preço e estoque</span>
                      <span className={`rounded border px-2 py-0.5 font-semibold ${stockByHub ? toneClass.ok : toneClass.warning}`}>
                        {OWNER_LABEL[owner?.stock_price ?? ''] ?? 'Não configurado'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-400">Responsável por conteúdo e imagens</span>
                      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
                        {OWNER_LABEL[owner?.content ?? ''] ?? 'Não configurado'}
                        {ctrl && ` · modo ${ctrl.mode === 'shadow' ? 'simulação (shadow)' : 'real (live)'} · máx. ${ctrl.max_replaces_per_run}/execução`}
                        {ctrl?.kill_switch && ' · DESLIGADO (kill switch)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <span className="text-zinc-400">Integração nativa do Bling para este canal</span>
                      <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-semibold text-zinc-300">
                        <HelpCircle className="h-3.5 w-3.5" />
                        Estado não verificado
                      </span>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
                      <strong className="text-white">Operações bloqueadas ao HUB:</strong>{' '}
                      {stockByHub
                        ? 'escrita de quantidade em estoque Full (meli_facility).'
                        : 'escrita de estoque e preço em anúncios já publicados (responsabilidade da integração nativa) e qualquer escrita em estoque Full (meli_facility).'}
                      {' '}A API do Bling não informa se a integração nativa está ligada, então o HUB não presume autorização para escrever preço ou estoque.
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Depósitos */}
          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-sky-400" />
              <h2 className="text-base font-bold text-white">Depósitos do Bling e regra de soma de estoque</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              O estoque publicado soma apenas o saldo virtual dos depósitos <strong>seller</strong> marcados para entrar na soma. Depósitos espelho do Full nunca entram.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Depósitos do Bling</caption>
                <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-400">
                  <tr>
                    <th scope="col" className="py-2.5 pr-4">ID no Bling</th>
                    <th scope="col" className="py-2.5 px-4">Nome</th>
                    <th scope="col" className="py-2.5 px-4">Classificação</th>
                    <th scope="col" className="py-2.5 pl-4">Entra na soma publicada?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {ch.warehouses.map((w) => (
                    <tr key={w.bling_warehouse_id}>
                      <td className="py-3 pr-4 font-mono font-bold text-emerald-400">{w.bling_warehouse_id}</td>
                      <td className="py-3 px-4 font-semibold text-white">{w.name}</td>
                      <td className="py-3 px-4 text-zinc-300">{ROLE_LABEL[w.role] ?? w.role}</td>
                      <td className={`py-3 pl-4 font-semibold ${w.include_in_push ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {w.include_in_push ? 'Sim' : 'Não'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ch.warehouses.some((w) => w.role === 'unclassified') && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>Há depósitos não classificados. Eles não entram no estoque publicado até um administrador classificá-los.</span>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Ao passar estoque/preço para o HUB no futuro: desligue no Bling apenas a exportação nativa de estoque e preço daquele canal e mantenha ligada a importação de pedidos, para que o saldo continue baixando.
              </span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
