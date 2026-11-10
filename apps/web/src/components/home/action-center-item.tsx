'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  const toneClass =
    tone === 'rose' ? 'text-rose-600 dark:text-rose-300' : tone === 'orange' ? 'text-orange-600 dark:text-orange-300' : 'text-amber-600 dark:text-amber-300';

  return (
    <li className="border-b border-border-color last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={toneClass} aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="text-xs text-text-muted">{count.toLocaleString('pt-BR')} pendência(s)</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-1 text-xs text-text-muted underline"
          aria-expanded={open}
        >
          Ver detalhes
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <Link href={href} className="rounded-lg border border-border-color px-2.5 py-1 text-xs font-semibold text-text-primary">
          Abrir
        </Link>
      </div>
      {open && (
        <div className="space-y-1 px-4 pb-3 pl-11 text-xs text-text-muted">
          <p><span className="font-semibold text-text-primary">Motivo. </span>{reason}</p>
          <p><span className="font-semibold text-text-primary">Impacto. </span>{impact}</p>
          {tech && <p className="font-mono text-[11px]">{tech}</p>}
        </div>
      )}
    </li>
  );
}
