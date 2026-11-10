'use client';

import React from 'react';
import { BrandLogo } from '../brand-logo';

export function ChannelCard({
  id,
  name,
  connected,
  detail,
  canManage,
  onConfigure,
  onDisconnect,
  onConnect,
}: {
  id: string;
  name: string;
  connected: boolean;
  detail: string | null;
  canManage: boolean;
  onConfigure?: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
}) {
  return (
    <article className={`rounded-xl border bg-bg-surface p-4 ${connected ? 'border-emerald-600' : 'border-border-color'}`}>
      <div className="flex items-center gap-3">
        <BrandLogo id={id} name={name} size={40} />
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">{name}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-text-muted">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            {connected ? 'Conectado' : 'Desconectado'}
          </p>
        </div>
      </div>
      {detail && <p className="mt-3 truncate text-xs text-text-muted">{detail}</p>}
      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2">
          {connected && onConfigure && (
            <button type="button" onClick={onConfigure} className="rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold">
              Configurar
            </button>
          )}
          {connected && onDisconnect && (
            <button type="button" onClick={onDisconnect} className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-600">
              Desconectar
            </button>
          )}
          {!connected && onConnect && (
            <button type="button" onClick={onConnect} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
              Conectar
            </button>
          )}
        </div>
      )}
    </article>
  );
}
