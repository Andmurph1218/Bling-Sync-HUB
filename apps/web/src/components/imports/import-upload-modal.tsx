'use client';

import React, { useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { API_BASE_URL } from '../../utils/api-client';

const REQUIRED = ['SKU (obrigatório)', 'Nome', 'Descrição, categoria e URL da imagem são opcionais'];

export function ImportUploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/import`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!response.ok) throw new Error('upload_failed');
      const body = (await response.json()) as { queued?: boolean; total?: number };
      onUploaded(body.queued ? `Importação de ${body.total ?? 0} linhas entrou na fila.` : 'Importação concluída.');
      onClose();
    } catch {
      setError('Não foi possível enviar o arquivo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Nova importação">
      <div className="w-full max-w-lg rounded-xl border border-border-color bg-bg-base p-5 text-text-primary">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">Nova importação</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-text-muted hover:bg-bg-surface">
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          className="mt-3 inline-flex text-sm font-semibold text-emerald-700 underline dark:text-emerald-300"
          onClick={() => {
            void fetch(`${API_BASE_URL}/api/catalog/import/template.csv`, { credentials: 'include' }).then(async (response) => {
              if (!response.ok) return;
              const url = URL.createObjectURL(await response.blob());
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'template-catalogo.csv';
              anchor.click();
              URL.revokeObjectURL(url);
            });
          }}
        >
          Baixar Template (CSV)
        </button>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-text-muted">
          {REQUIRED.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          O HUB não sobrescreve dados fiscais do ERP (NCM, EAN). Esses campos serão ignorados se presentes na planilha. Preço e estoque também permanecem no Bling.
        </p>
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
          className={`mt-4 flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-4 py-8 text-center ${dragging ? 'border-emerald-600 bg-emerald-500/10' : 'border-border-color'}`}
        >
          <UploadCloud className="h-8 w-8 text-text-muted" />
          <span className="mt-2 text-sm">{file ? file.name : 'Arraste o CSV ou Excel, ou clique para escolher'}</span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border-color px-3 py-1.5 text-xs">Cancelar</button>
          <button type="button" disabled={!file || sending} onClick={() => void submit()} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {sending ? 'Enviando...' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
