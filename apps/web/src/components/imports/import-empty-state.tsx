import React from 'react';
import { UploadCloud } from 'lucide-react';

export function ImportEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto mt-10 flex max-w-xl flex-col items-center rounded-xl border border-border-color bg-bg-surface px-6 py-12 text-center">
      <UploadCloud className="h-14 w-14 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-semibold text-text-primary">Importe seu catálogo em massa</h2>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        Envie um arquivo CSV ou Excel para atualizar nome, descrição, categoria e imagem. Preço, estoque e dados fiscais continuam no ERP.
      </p>
      <button type="button" onClick={onStart} className="mt-6 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
        Fazer Nova Importação
      </button>
    </div>
  );
}
