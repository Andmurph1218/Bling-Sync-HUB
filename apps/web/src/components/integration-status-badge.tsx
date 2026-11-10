import React from 'react';
import { BrandLogo } from './brand-logo';

export type IntegrationBadgeKind = 'blocked' | 'ready' | 'synced' | 'unlinked';

const COPY: Record<IntegrationBadgeKind, { label: string; tooltip: string; className: string }> = {
  blocked: {
    label: 'Bloqueado',
    tooltip: 'Falta NCM ou dados obrigatórios no ERP',
    className: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200',
  },
  ready: {
    label: 'Pronto p/ Envio',
    tooltip: 'Apto a ser enviado. Aguardando ação',
    className: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100',
  },
  synced: {
    label: 'Sincronizado',
    tooltip: 'Produto publicado e atualizado',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  unlinked: {
    label: 'Não vinculado',
    tooltip: 'Produto não existe neste canal',
    className: 'border-border-color bg-bg-base text-text-muted',
  },
};

export function integrationBadgeKind(input: { visual: string; ready: boolean }): IntegrationBadgeKind {
  if (input.visual === 'blocked') return 'blocked';
  if (input.visual === 'connected') return 'synced';
  if (input.ready) return 'ready';
  return 'unlinked';
}

export function IntegrationStatusBadge({
  platform,
  kind,
  onClick,
}: {
  platform: string;
  kind: IntegrationBadgeKind;
  onClick?: () => void;
}) {
  const copy = COPY[kind];
  return (
    <button
      type="button"
      title={copy.tooltip}
      aria-label={`${copy.label}. ${copy.tooltip}`}
      onClick={onClick}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${copy.className}`}
    >
      <BrandLogo id={platform} name={platform} size={16} />
      <span className="truncate">{copy.label}</span>
    </button>
  );
}
