'use client';

import React, { useState } from 'react';

export interface MotorStatus {
  motor: string;
  resultState: 'healthy' | 'attention_required' | 'blocked';
  ruleApplied: string;
  executionId: string;
  operationalExplanation: string;
  lastEvaluatedAt?: string;
}

const DOT = {
  healthy: 'bg-emerald-500',
  attention_required: 'bg-amber-400',
  blocked: 'bg-rose-500',
};

const LABEL = {
  healthy: 'OK',
  attention_required: 'Atenção',
  blocked: 'Bloqueio',
};

export function EngineHealthStrip({ motors }: { motors: MotorStatus[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const selected = motors.find((motor) => motor.motor === open) ?? null;
  const lastRun = selected?.lastEvaluatedAt
    ? new Date(selected.lastEvaluatedAt).toLocaleString('pt-BR')
    : selected?.executionId;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {motors.map((motor) => (
          <button
            key={motor.motor}
            type="button"
            aria-expanded={open === motor.motor}
            onClick={() => setOpen((current) => (current === motor.motor ? null : motor.motor))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-color bg-bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary"
          >
            <span className={`h-2 w-2 rounded-full ${DOT[motor.resultState]}`} />
            {motor.motor}: {LABEL[motor.resultState]}
          </button>
        ))}
      </div>
      {selected && (
        <div className="mt-2 max-w-2xl rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-xs text-text-muted">
          <p className="font-semibold text-text-primary">{selected.motor}</p>
          <p className="mt-1">{selected.operationalExplanation}</p>
          <p className="mt-1">Regra: {selected.ruleApplied}</p>
          <p className="mt-1">Última execução: {lastRun}</p>
        </div>
      )}
    </div>
  );
}
