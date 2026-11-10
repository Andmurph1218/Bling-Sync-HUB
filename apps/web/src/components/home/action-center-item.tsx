import React from 'react';
import Link from 'next/link';
import { ChevronRight, HelpCircle } from 'lucide-react';

export function ActionCenterItem({
  icon,
  tone,
  title,
  count,
  href,
  reason,
  impact,
  tech,
}: {
  icon: React.ReactNode;
  tone: 'amber' | 'rose' | 'orange';
  title: string;
  count: number;
  href: string;
  reason: string;
  impact: string;
  tech?: string;
}) {
  const toneClass =
    tone === 'rose' ? 'text-rose-600 dark:text-rose-300' : tone === 'orange' ? 'text-orange-600 dark:text-orange-300' : 'text-amber-600 dark:text-amber-300';
  const explanation = tech ? `${reason} ${impact} ${tech}` : `${reason} ${impact}`;

  return (
    <li className="border-b border-border-color last:border-b-0">
      <div className="flex items-center hover:bg-bg-base">
        <Link href={href} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3">
          <span className={toneClass} aria-hidden="true">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-primary">{title}</span>
            <span className="block text-xs text-text-muted">{count.toLocaleString('pt-BR')} pendência(s)</span>
          </span>
        </Link>
        <button
          type="button"
          className="group relative shrink-0 rounded-full p-1 text-text-muted hover:text-text-primary"
          aria-label={`Detalhe de ${title}`}
        >
          <HelpCircle className="h-4 w-4" />
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded-lg border border-border-color bg-bg-surface p-3 text-left text-xs font-normal leading-relaxed text-text-primary shadow-lg group-hover:block group-focus:block"
          >
            {explanation}
          </span>
        </button>
        <Link href={href} className="px-3 py-3 text-text-muted" aria-label={title}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </li>
  );
}
