import React from 'react';

export interface FunnelStep {
  title: string;
  detail: string;
  percent: number;
  state: 'done' | 'active' | 'blocked';
}

const STATE_LABEL = {
  done: 'Concluído',
  active: 'Em andamento',
  blocked: 'Bloqueado',
} as const;

export function OnboardingFunnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-xl border border-border-color bg-bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted">Etapa {index + 1}</p>
            <p className={`text-xs font-semibold ${step.state === 'blocked' ? 'text-rose-600 dark:text-rose-300' : step.state === 'done' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {STATE_LABEL[step.state]}
            </p>
          </div>
          <p className="mt-2 text-sm font-bold text-text-primary">{step.title}</p>
          <p className="mt-1 text-xs text-text-muted">{step.detail}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-base">
            <div
              className={`h-full ${step.state === 'blocked' ? 'bg-rose-400' : step.state === 'done' ? 'bg-emerald-600' : 'bg-amber-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, step.percent))}%` }}
            />
          </div>
          <p className="mt-1 text-xs font-bold text-text-primary">{step.percent}%</p>
        </li>
      ))}
    </ol>
  );
}
