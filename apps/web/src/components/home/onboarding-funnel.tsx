import React from 'react';
import { Check } from 'lucide-react';

export function CatalogCycle({
  imported,
  enriching,
  shadow,
  canContinue,
  continuing,
  onContinue,
}: {
  imported: boolean;
  enriching: boolean;
  shadow: boolean;
  canContinue: boolean;
  continuing: boolean;
  onContinue: () => void;
}) {
  const steps = [
    {
      title: 'Importação ERP',
      detail: imported ? 'Catálogo lido do Bling' : 'Nenhum produto importado',
      tone: imported ? 'done' : 'idle',
    },
    {
      title: 'Enriquecimento',
      detail: enriching ? 'Imagens e NCM sendo copiados do ERP' : 'Copia imagem e NCM do Bling para o HUB',
      tone: enriching ? 'running' : 'idle',
    },
    {
      title: 'Publicação',
      detail: shadow ? 'Modo simulação: nada é enviado aos canais' : 'Publicação liberada para os canais',
      tone: shadow ? 'shadow' : 'idle',
    },
  ] as const;

  const circle = {
    done: 'border-emerald-600 bg-emerald-600 text-white',
    running: 'border-amber-500 bg-amber-500 text-amber-950',
    shadow: 'border-border-color bg-bg-base text-text-muted',
    idle: 'border-border-color bg-bg-surface text-text-muted',
  };

  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="relative">
          {index > 0 && (
            <span className="absolute -left-3 top-3 hidden h-px w-6 bg-border-color md:block" aria-hidden="true" />
          )}
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${circle[step.tone]}`}>
              {step.tone === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{step.title}</p>
              <p className="mt-1 text-xs text-text-muted">{step.detail}</p>
              {step.title === 'Enriquecimento' && canContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={continuing}
                  className="mt-3 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {continuing ? 'Enriquecendo...' : 'Continuar Enriquecimento'}
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
