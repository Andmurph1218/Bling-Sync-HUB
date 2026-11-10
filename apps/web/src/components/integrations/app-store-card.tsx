'use client';

import React from 'react';
import { BrandLogo } from '../brand-logo';

export type StoreCardStatus = 'connected' | 'action' | 'disconnected' | 'coming_soon';

const BADGE: Record<StoreCardStatus, { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bg-emerald-600 text-white' },
  action: { label: 'Ação necessária', className: 'bg-amber-500 text-amber-950' },
  disconnected: { label: 'Desconectado', className: 'bg-rose-600 text-white' },
  coming_soon: { label: 'Em breve', className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100' },
};

export function AppStoreCard({
  id,
  name,
  category,
  description,
  status,
  onConfigure,
  onDisconnect,
  onConnect,
  onNotify,
}: {
  id: string;
  name: string;
  category: string;
  description: string;
  status: StoreCardStatus;
  onConfigure?: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onNotify?: () => void;
}) {
  const badge = BADGE[status];
  return (
    <article className="flex flex-col rounded-xl border border-border-color bg-bg-surface p-4">
      <div className="flex items-start gap-3">
        <BrandLogo id={id} name={name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold text-text-primary">{name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
          </div>
          <p className="text-[11px] text-text-muted">{category}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-text-muted">{description}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        {status === 'connected' && (
          <>
            <button type="button" onClick={onConfigure} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Configurar</button>
            <button type="button" onClick={onDisconnect} className="rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-600">Desconectar</button>
          </>
        )}
        {(status === 'action' || status === 'disconnected') && (
          <button type="button" onClick={onConnect} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Conectar agora</button>
        )}
        {status === 'coming_soon' && (
          <button type="button" onClick={onNotify} className="text-xs text-text-muted underline">Avisar-me quando disponível</button>
        )}
      </div>
    </article>
  );
}
