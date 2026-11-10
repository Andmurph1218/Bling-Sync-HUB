'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { ValuePair } from './types';

function sameValue(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a === b;
}

export function ValueMappingModal({
  title,
  field,
  channelValues,
  pairs,
  onClose,
  onConfirm,
}: {
  title: string;
  field: string;
  channelValues: string[];
  pairs: ValuePair[];
  onClose: () => void;
  onConfirm: (pairs: ValuePair[]) => void;
}) {
  const [values, setValues] = useState<string[]>([]);
  const [draft, setDraft] = useState<ValuePair[]>(pairs);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    void apiFetch<{ values: string[] }>(`/api/catalog/mapping-studio/values?field=${encodeURIComponent(field)}`)
      .then((payload) => setValues(payload.values))
      .catch(() => setError('Não foi possível ler os valores do catálogo.'));
  }, [field]);

  const hubValues = [...new Set([...values, ...draft.map((pair) => pair.hubValue), ...(manual.trim() ? [] : [])])];

  const assign = (hubValue: string, channelValue: string) => {
    setDraft((prev) => {
      const rest = prev.filter((pair) => pair.hubValue !== hubValue);
      return channelValue ? [...rest, { hubValue, channelValue }] : rest;
    });
  };

  const auto = () => {
    setDraft((prev) => {
      const next = [...prev];
      for (const hubValue of hubValues) {
        if (next.some((pair) => pair.hubValue === hubValue)) continue;
        const match = channelValues.find((channelValue) => sameValue(hubValue, channelValue));
        if (match) next.push({ hubValue, channelValue: match });
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Mapear valores de ${title}`}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border-color bg-bg-base text-text-primary shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-color px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Mapear valores · {title}</h2>
            <p className="mt-1 text-xs text-text-muted">Arraste um valor do catálogo para o valor aceito pelo canal, ou use a lista.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-bg-surface" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid flex-1 gap-4 overflow-auto p-5 sm:grid-cols-2">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">No catálogo</h3>
            {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
            <ul className="mt-2 space-y-1">
              {hubValues.map((hubValue) => (
                <li key={hubValue}>
                  <div
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', hubValue)}
                    className="flex cursor-grab items-center justify-between gap-2 rounded-md border border-border-color bg-bg-surface px-2 py-1.5 text-sm"
                  >
                    <span className="truncate">{hubValue}</span>
                    <select
                      value={draft.find((pair) => pair.hubValue === hubValue)?.channelValue ?? ''}
                      onChange={(event) => assign(hubValue, event.target.value)}
                      className="max-w-[9rem] rounded border border-border-color bg-bg-base px-1 py-0.5 text-xs"
                      aria-label={`Canal para ${hubValue}`}
                    >
                      <option value="">Sem destino</option>
                      {channelValues.map((channelValue) => (
                        <option key={channelValue} value={channelValue}>{channelValue}</option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
              {hubValues.length === 0 && <li className="text-xs text-text-muted">Nenhum valor desse campo no catálogo. Adicione um abaixo.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="Valor do ERP"
                className="min-w-0 flex-1 rounded-md border border-border-color bg-bg-surface px-2 py-1 text-xs"
              />
              <button
                type="button"
                className="rounded-md border border-border-color px-2 py-1 text-xs"
                onClick={() => {
                  const value = manual.trim();
                  if (!value) return;
                  setValues((prev) => (prev.includes(value) ? prev : [...prev, value]));
                  setManual('');
                }}
              >
                Adicionar
              </button>
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Aceitos pelo canal</h3>
            <ul className="mt-2 space-y-2">
              {channelValues.map((channelValue) => {
                const received = draft.filter((pair) => pair.channelValue === channelValue);
                return (
                  <li
                    key={channelValue}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const hubValue = event.dataTransfer.getData('text/plain');
                      if (hubValue) assign(hubValue, channelValue);
                    }}
                    className="rounded-md border border-dashed border-border-color px-3 py-2"
                  >
                    <p className="text-sm font-medium">{channelValue}</p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {received.length > 0 ? received.map((pair) => pair.hubValue).join(', ') : 'Solte um valor do catálogo aqui'}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-color px-5 py-3">
          <button type="button" onClick={auto} className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            Auto-mapear Valores Idênticos
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border-color px-3 py-1.5 text-xs">Cancelar</button>
            <button type="button" onClick={() => onConfirm(draft)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
              Usar estes valores
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
