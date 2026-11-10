'use client';

import React from 'react';
import { BrandLogo } from '../brand-logo';

export type CardStatus = 'connected' | 'attention' | 'disconnected' | 'coming_soon';

const STATUS_LABEL: Record<CardStatus, { label: string; className: string }> = {
  connected: { label: 'Conectado e saudável', className: 'text-emerald-700 dark:text-emerald-300' },
  attention: { label: 'Instalado (atenção)', className: 'text-amber-700 dark:text-amber-200' },
  disconnected: { label: 'Desconectado', className: 'text-rose-700 dark:text-rose-300' },
  coming_soon: { label: 'Em breve', className: 'text-text-muted' },
};

export function IntegrationCard({
  id,
  name,
  categoryLabel,
  description,
  status,
  canManage,
  onConfigure,
  onDisconnect,
  onConnect,
}: {
  id: string;
  name: string;
  categoryLabel: string;
  description: string;
  status: CardStatus;
  canManage: boolean;
  onConfigure?: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
}) {
  const visual = STATUS_LABEL[status];
  return (
    <article className="flex min-h-[190px] flex-col rounded-xl border border-border-color bg-bg-surface p-5">
      <div className="flex items-start gap-3">
        <BrandLogo id={id} name={name} />
        <div>
          <h3 className="font-semibold text-text-primary">{name}</h3>
          <p className="text-xs text-text-muted">{categoryLabel}</p>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-text-muted">{description}</p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border-color pt-3">
        <span className={`text-xs font-semibold ${visual.className}`}>{visual.label}</span>
        {status === 'coming_soon' ? null : canManage && (
          <div className="flex items-center gap-2">
            {(status === 'connected' || status === 'attention') && (
              <>
                <button type="button" onClick={onConfigure} className="text-xs font-semibold underline">Configurar</button>
                <button type="button" onClick={onDisconnect} className="text-xs font-semibold text-rose-600">Desconectar</button>
              </>
            )}
            {status === 'disconnected' && onConnect && (
              <button type="button" onClick={onConnect} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
                Conectar
              </button>
            )}
            {status === 'disconnected' && !onConnect && onConfigure && (
              <button type="button" onClick={onConfigure} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
                Conectar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
