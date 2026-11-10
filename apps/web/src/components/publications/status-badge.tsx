import React from 'react';
import { Lock } from 'lucide-react';

export type PublicationTone = 'ready' | 'fiscal' | 'ignored' | 'waiting';

const TONE: Record<PublicationTone, { label: string; className: string; hint: string }> = {
  ready: {
    label: 'Pronto para envio',
    className: 'bg-emerald-600 text-white',
    hint: 'O conteúdo passaria na simulação. Preço e estoque continuam na integração nativa do Bling.',
  },
  fiscal: {
    label: 'Bloqueio fiscal (ver detalhes)',
    className: 'bg-rose-600 text-white',
    hint: 'NCM ou EAN inválido. Clique para resolver.',
  },
  ignored: {
    label: 'Ignorado (estoque/preço via integração nativa)',
    className: 'bg-bg-base text-text-muted',
    hint: 'Protegido pela regra de soberania do Bling.',
  },
  waiting: {
    label: 'Aguardando enriquecimento',
    className: 'bg-sky-600 text-white',
    hint: 'Falta categoria, atributo ou nota mínima para publicar o conteúdo.',
  },
};

export function classifyPublication(stockPriceAction: string, contentAction: string): PublicationTone {
  if (/^APTO/i.test(contentAction)) return 'ready';
  if (/BLOQUEADO/i.test(contentAction) && /ncm|ean/i.test(contentAction)) return 'fiscal';
  if (/BLOQUEADO/i.test(contentAction)) return 'waiting';
  if (/IGNORADO/i.test(stockPriceAction)) return 'ignored';
  return 'waiting';
}

export function fiscalQueue(contentAction: string): 'ean' | 'ncm' {
  return /ean/i.test(contentAction) && !/ncm/i.test(contentAction) ? 'ean' : 'ncm';
}

export function StatusBadge({ tone }: { tone: PublicationTone }) {
  const meta = TONE[tone];
  return (
    <span title={meta.hint} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export function SovereigntyLock() {
  return (
    <span title="Protegido pela regra de soberania do Bling." className="inline-flex text-text-muted">
      <Lock className="h-4 w-4" aria-label="Protegido pela regra de soberania do Bling." />
    </span>
  );
}
