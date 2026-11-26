'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Package,
  PackageMinus,
  PackagePlus,
  PencilLine,
  Warehouse,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/**
 * Peças do cockpit da Visão Geral. O foco da tela é "onde o catálogo vaza":
 * cada número leva à lista já filtrada, e o funil marca o maior gargalo.
 */

export function formatCount(value: number): string {
  return value.toLocaleString('pt-BR');
}

export type HealthTone = 'good' | 'warn' | 'bad';

export function healthToneOf(percent: number): HealthTone {
  if (percent > 80) return 'good';
  if (percent >= 50) return 'warn';
  return 'bad';
}

export const TONE_BAR: Record<HealthTone, string> = {
  good: 'bg-emerald-600 dark:bg-[#3ecf74]',
  warn: 'bg-amber-500 dark:bg-[#f09a42]',
  bad: 'bg-rose-600 dark:bg-rose-500',
};

export const TONE_TEXT: Record<HealthTone, string> = {
  good: 'text-emerald-700 dark:text-[#52dc86]',
  warn: 'text-amber-700 dark:text-[#f2a65a]',
  bad: 'text-rose-700 dark:text-rose-300',
};

/** Cartão-base do topo: mesmo raio, padding e título em caixa alta para os 4. */
export function CockpitCard({
  label,
  icon,
  aside,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="ui-card flex flex-col">
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {icon}
          {label}
        </span>
        {aside}
      </header>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </article>
  );
}

export interface ActionTopic {
  key: string;
  label: string;
  count: number;
  href: string;
  severity: 'block' | 'warn';
}

/** Cada pendência é uma linha clicável que leva à lista filtrada. */
export function ActionTopicList({ topics }: { topics: ActionTopic[] }) {
  const visible = topics.filter((topic) => topic.count > 0);
  if (visible.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-[#52dc86]">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        Nenhuma ação pendente no catálogo.
      </p>
    );
  }
  return (
    <ul className="-mx-2 space-y-0.5">
      {visible.map((topic) => (
        <li key={topic.key}>
          <Link
            href={topic.href}
            className="group flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-base focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60 dark:hover:bg-white/[0.05]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${topic.severity === 'block' ? 'bg-rose-500' : 'bg-amber-500'}`}
                aria-hidden
              />
              <span className="truncate text-xs text-text-primary">{topic.label}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-sm font-bold tabular-nums text-text-primary">{formatCount(topic.count)}</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  href: string;
  /** Rótulo do que falta nesta etapa (ex.: "sem capa"). */
  missingLabel?: string;
  final?: boolean;
}

/**
 * Funil horizontal. Cada barra mede contra o total do catálogo; o rodapé de cada
 * etapa mostra quantos produtos ficam de fora, e a etapa que mais perde ganha a
 * marca "Maior gargalo".
 */
export function CoverageFunnel({ total, stages }: { total: number; stages: FunnelStage[] }) {
  const safeTotal = Math.max(total, 1);
  const leaks = stages
    .filter((stage) => !stage.final && stage.missingLabel)
    .map((stage) => ({ key: stage.key, missing: Math.max(0, total - stage.value) }));
  const worst = leaks.reduce<{ key: string; missing: number } | null>(
    (best, leak) => (leak.missing > (best?.missing ?? 0) ? leak : best),
    null
  );

  return (
    <ol className="space-y-3.5">
      <li>
        <FunnelRow label="Total no catálogo" value={total} percent={100} href="/catalogo" tone="base" />
      </li>
      {stages.map((stage) => {
        const percent = Math.round((stage.value / safeTotal) * 100);
        const missing = Math.max(0, total - stage.value);
        const isWorst = worst !== null && worst.key === stage.key && worst.missing > 0;
        return (
          <li key={stage.key}>
            <FunnelRow
              label={stage.label}
              value={stage.value}
              percent={percent}
              href={stage.href}
              tone={stage.final ? 'final' : isWorst ? 'worst' : 'stage'}
              leak={
                !stage.final && stage.missingLabel && missing > 0
                  ? `${formatCount(missing)} ${stage.missingLabel}`
                  : undefined
              }
              badge={isWorst ? 'Maior gargalo' : undefined}
            />
          </li>
        );
      })}
    </ol>
  );
}

function FunnelRow({
  label,
  value,
  percent,
  href,
  tone,
  leak,
  badge,
}: {
  label: string;
  value: number;
  percent: number;
  href: string;
  tone: 'base' | 'stage' | 'worst' | 'final';
  leak?: string;
  badge?: string;
}) {
  const bar =
    tone === 'final'
      ? 'bg-emerald-600 dark:bg-[#3ecf74]'
      : tone === 'worst'
        ? 'bg-rose-500/80 dark:bg-rose-500/80'
        : tone === 'base'
          ? 'bg-text-primary/20 dark:bg-[#f5dbb6]/35'
          : 'bg-text-primary/35 dark:bg-[#f5dbb6]/70';
  return (
    <Link
      href={href}
      className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-copper/60"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold ${tone === 'final' ? 'text-emerald-700 dark:text-[#52dc86]' : 'text-text-primary'}`}
          >
            {label}
          </span>
          {badge && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
              {badge}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span
            className={`text-sm font-bold ${tone === 'final' ? 'text-emerald-700 dark:text-[#52dc86]' : 'text-text-primary'}`}
          >
            {formatCount(value)}
          </span>
          <span className="w-9 text-right text-[11px] text-text-muted">{percent}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-base dark:bg-white/[0.06]">
        <div
          className={`ui-progress h-full w-full rounded-full ${bar}`}
          style={{ transform: `scaleX(${Math.max(value > 0 ? 0.015 : 0, Math.min(1, percent / 100))})` }}
        />
      </div>
      {leak && <p className="mt-1 text-[11px] text-text-muted">−{leak}</p>}
    </Link>
  );
}

export interface ActivityView {
  label: string;
  icon: LucideIcon;
  iconClass: string;
}

const NEUTRAL_ICON = 'text-text-muted';

/** Ícone por tipo de evento: criação, edição, exclusão, estoque e preço. */
export function activityView(eventType: string, failed: boolean): ActivityView {
  const type = eventType.toLowerCase();
  const label = EVENT_LABEL[type] ?? eventType.replace(/[._/]/g, ' ');
  if (failed) return { label, icon: XCircle, iconClass: 'text-rose-600 dark:text-rose-400' };
  if (type.includes('price') || type.includes('preco')) {
    return { label, icon: BadgeDollarSign, iconClass: 'text-emerald-700 dark:text-[#52dc86]' };
  }
  if (type.includes('stock') || type.includes('estoque')) {
    return { label, icon: Warehouse, iconClass: 'text-sky-700 dark:text-[#6db2f2]' };
  }
  if (type.endsWith('created')) return { label, icon: PackagePlus, iconClass: 'text-emerald-700 dark:text-[#52dc86]' };
  if (type.endsWith('deleted')) return { label, icon: PackageMinus, iconClass: 'text-rose-600 dark:text-rose-400' };
  if (type.endsWith('updated')) return { label, icon: PencilLine, iconClass: 'text-accent-copper' };
  return { label, icon: Package, iconClass: NEUTRAL_ICON };
}

const EVENT_LABEL: Record<string, string> = {
  'product.created': 'Produto criado',
  'product.updated': 'Produto atualizado',
  'product.deleted': 'Produto removido',
  'stock.created': 'Estoque atualizado',
  'stock.updated': 'Estoque atualizado',
  'virtual_stock.updated': 'Estoque atualizado',
  'price.updated': 'Preço atualizado',
  'product/created': 'Produto criado',
  'product/updated': 'Produto atualizado',
  'product/deleted': 'Produto removido',
};

export interface ResultBadge {
  label: string;
  className: string;
  icon: LucideIcon;
  failed: boolean;
}

/** Verde sucesso, vermelho erro, âmbar aviso/fila, cinza ignorado sem mudança. */
export function resultBadge(status: string, reason: string | null): ResultBadge {
  const normalized = status.toLowerCase();
  const detail = (reason ?? '').toLowerCase();
  if (normalized === 'failed' || normalized === 'error' || normalized === 'erro') {
    return {
      label: 'Erro',
      icon: XCircle,
      failed: true,
      className: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    };
  }
  if (normalized === 'ignored' || detail.includes('identical') || detail.includes('idêntico')) {
    return {
      label: 'Sem alteração',
      icon: CircleSlash,
      failed: false,
      className: 'border-border-color bg-bg-base text-text-muted dark:border-white/10 dark:bg-white/[0.04]',
    };
  }
  if (normalized === 'processed' || normalized === 'processado' || normalized === 'completed') {
    return {
      label: 'Sucesso',
      icon: CheckCircle2,
      failed: false,
      className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-[#3ecf74]/30 dark:bg-[#3ecf74]/12 dark:text-[#66e094]',
    };
  }
  if (normalized === 'received' || normalized === 'queued' || normalized === 'pending') {
    return {
      label: 'Na fila',
      icon: Clock3,
      failed: false,
      className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200',
    };
  }
  return {
    label: 'Aviso',
    icon: AlertTriangle,
    failed: false,
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  };
}
