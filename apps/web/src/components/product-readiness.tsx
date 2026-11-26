'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Peças da ficha do produto. A nota é o elemento focal da aba Geral: anel grande,
 * número tabular e cor de status. As pendências aparecem uma vez cada, com o
 * ícone do estado e a ação alinhada à direita.
 */

export type ReadinessTone = 'ready' | 'attention' | 'blocked' | 'unknown';

export function readinessTone(score: number | null | undefined): ReadinessTone {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'unknown';
  if (score > 80) return 'ready';
  if (score >= 50) return 'attention';
  return 'blocked';
}

const TONE_TEXT: Record<ReadinessTone, string> = {
  ready: 'text-emerald-800 dark:text-emerald-400',
  attention: 'text-amber-800 dark:text-amber-300',
  blocked: 'text-rose-600 dark:text-rose-400',
  unknown: 'text-text-muted',
};

const TONE_STROKE: Record<ReadinessTone, string> = {
  ready: 'stroke-emerald-500',
  attention: 'stroke-amber-500',
  blocked: 'stroke-rose-500',
  unknown: 'stroke-border-color',
};

const TONE_LABEL: Record<ReadinessTone, string> = {
  ready: 'Pronto para publicar',
  attention: 'Atenção',
  blocked: 'Bloqueado',
  unknown: 'Sem nota calculada',
};

export function ScoreRing({
  score,
  pendingCount,
  size = 88,
}: {
  score: number | null | undefined;
  pendingCount?: number;
  size?: number;
}) {
  const tone = readinessTone(score);
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  const caption =
    score === null || score === undefined
      ? TONE_LABEL.unknown
      : pendingCount && pendingCount > 0
        ? `${pendingCount} pendência${pendingCount > 1 ? 's' : ''}`
        : TONE_LABEL[tone];

  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 36 36"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={score === null || score === undefined ? 'Nota não calculada' : `Nota ${score} de 100`}
        >
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3"
            className="stroke-border-color/60"
          />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
            className={TONE_STROKE[tone]}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold leading-none tabular-nums ${TONE_TEXT[tone]}`}>
            {score === null || score === undefined ? '—' : score}
          </span>
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-text-muted">/100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${TONE_TEXT[tone]}`}>{caption}</p>
        {score !== null && score !== undefined && (
          <p className="mt-0.5 text-[11px] text-text-muted">{TONE_LABEL[tone]}</p>
        )}
      </div>
    </div>
  );
}

export function ReadinessHeroCard({
  title,
  subtitle,
  score,
  pendingCount,
  meta,
}: {
  title: string;
  subtitle: string;
  score: number | null | undefined;
  pendingCount?: number;
  meta?: React.ReactNode;
}) {
  const tone = readinessTone(score);
  return (
    <article className="flex flex-col justify-between gap-4 rounded-2xl border border-border-color bg-bg-surface p-5">
      <header>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
        <p className={`mt-1 text-sm font-bold ${tone === 'unknown' ? 'text-text-primary' : TONE_TEXT[tone]}`}>
          {subtitle}
        </p>
      </header>
      <ScoreRing score={score} pendingCount={pendingCount} />
      {meta && <div className="border-t border-border-color/70 pt-3 text-[11px] leading-relaxed text-text-muted">{meta}</div>}
    </article>
  );
}

/** Pendência com ação à direita. Bloqueio usa XCircle; aviso usa AlertCircle. */
export function BlockerRow({
  title,
  blocks,
  where,
  fixHref,
  erpUrl,
}: {
  title: string;
  blocks: boolean;
  where: 'erp' | 'hub';
  fixHref: string;
  erpUrl?: string;
}) {
  const Icon = blocks ? XCircle : AlertCircle;
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border-color bg-bg-base/60 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${blocks ? 'text-rose-500 dark:text-rose-400' : 'text-amber-500 dark:text-amber-300'}`}
          aria-hidden
        />
        <span className="text-xs leading-relaxed text-text-primary">{title}</span>
      </div>
      {where === 'erp' ? (
        <a
          href={erpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-color px-2.5 py-1 text-[11px] font-semibold text-text-primary transition hover:border-accent-copper/60 hover:text-accent-copper"
        >
          Corrigir no ERP
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
      ) : (
        <Link
          href={fixHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-color px-2.5 py-1 text-[11px] font-semibold text-text-primary transition hover:border-accent-copper/60 hover:text-accent-copper"
        >
          Resolver
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </li>
  );
}

export function AllClearRow({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{text}</span>
    </li>
  );
}

/** Etiqueta de checklist: verde ok, vermelha bloqueio, amarela aviso. */
export function ChecklistBadge({
  title,
  ok,
  blocks,
  fixHref,
}: {
  title: string;
  ok: boolean;
  blocks: boolean;
  fixHref?: string;
}) {
  const Icon = ok ? CheckCircle2 : blocks ? XCircle : AlertCircle;
  const palette = ok
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : blocks
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{title}</span>
      {!ok && fixHref && <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
    </>
  );
  const className = `inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${palette}`;

  if (!ok && fixHref) {
    return (
      <Link href={fixHref} className={`${className} hover:border-current`} title="Corrigir">
        {body}
      </Link>
    );
  }
  return <span className={className}>{body}</span>;
}
