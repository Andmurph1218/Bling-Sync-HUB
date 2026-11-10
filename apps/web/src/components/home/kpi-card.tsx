import React from 'react';
import Link from 'next/link';

type Accent = 'neutral' | 'sky' | 'rose' | 'amber';

const BORDER: Record<Accent, string> = {
  neutral: 'border-l-border-color',
  sky: 'border-l-sky-500',
  rose: 'border-l-rose-500',
  amber: 'border-l-amber-500',
};

export function KpiCard({
  label,
  value,
  hint,
  href,
  accent = 'neutral',
  progress,
  pulse,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  href: string;
  accent?: Accent;
  progress?: number | null;
  pulse?: 'live' | 'stopped' | null;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-border-color border-l-4 bg-bg-surface p-4 ${BORDER[accent]}`}>
      <Link href={href} className="block">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-muted">{label}</p>
          {pulse && (
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              {pulse === 'live' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${pulse === 'live' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            </span>
          )}
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight text-text-primary">{value}</p>
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
        {progress != null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-base" aria-hidden="true">
            <div className="h-full bg-emerald-600" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
      </Link>
      {children}
    </div>
  );
}
