import React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export function FiscalEmptyState({
  approvedToday,
  rejectedToday,
  awaitingSecond,
  subtitle = 'Nenhum EAN ou NCM pendente de aprovação para a Nuvemshop no momento.',
}: {
  approvedToday: number;
  rejectedToday: number;
  awaitingSecond: number;
  subtitle?: string;
}) {
  const cards = [
    { label: 'Aprovados hoje', value: approvedToday },
    { label: 'Rejeitados hoje', value: rejectedToday },
    { label: 'Aguardando 2ª aprovação', value: awaitingSecond },
  ];
  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <div className="flex flex-col items-center rounded-xl border border-border-color bg-bg-surface px-6 py-10 text-center">
        <ShieldCheck className="h-14 w-14 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-text-primary">Tudo em conformidade!</h2>
        <p className="mt-2 max-w-md text-sm text-text-muted">
          {subtitle}
        </p>
        <Link
          href="/auditoria"
          className="mt-5 inline-flex rounded-lg border border-border-color px-3 py-2 text-xs font-semibold text-text-primary hover:bg-bg-base"
        >
          Ver Histórico de Aprovações
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-center">
            <p className="text-2xl font-bold tabular-nums text-text-primary">{card.value.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-xs text-text-muted">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
