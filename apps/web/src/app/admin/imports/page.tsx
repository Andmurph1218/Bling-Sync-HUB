'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { apiFetch } from '../../../utils/api-client';
import { ImportEmptyState } from '../../../components/imports/import-empty-state';
import { ImportHistoryTable, ImportJobRow } from '../../../components/imports/import-history-table';
import { ImportUploadModal } from '../../../components/imports/import-upload-modal';

interface ImportError {
  line: number;
  sku: string;
  message: string;
}

export default function ImportHistoryPage() {
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<{ fileName: string; errors: ImportError[] } | null>(null);

  const load = async () => {
    try {
      const payload = await apiFetch<{ jobs: ImportJobRow[] }>('/api/catalog/imports');
      setJobs(payload.jobs);
      setError(null);
    } catch {
      setError('Não foi possível ler o histórico de importações.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'running')) return;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [jobs]);

  const openDetails = async (job: ImportJobRow) => {
    try {
      const payload = await apiFetch<{ file_name: string; error_log: ImportError[] }>(`/api/catalog/imports/${job.id}`);
      setDetail({ fileName: payload.file_name, errors: payload.error_log ?? [] });
    } catch {
      setNotice('Não foi possível abrir o log desta importação.');
    }
  };

  const finished = jobs.filter((job) => job.status !== 'running');
  const successRate = finished.length === 0
    ? 0
    : Math.round((finished.filter((job) => job.status === 'done' && job.rows_error === 0).length / finished.length) * 100);
  const pendingErrors = jobs.reduce((sum, job) => sum + job.rows_error, 0);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Centro de Controle de Ingestão</h1>
          <p className="mt-1 text-sm text-text-muted">Planilhas do catálogo, com progresso e o motivo de cada linha recusada.</p>
        </div>
        {jobs.length > 0 && (
          <button type="button" onClick={() => setUploadOpen(true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">
            Fazer Nova Importação
          </button>
        )}
      </header>
      {error && <p className="mt-4 text-sm text-rose-600" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-text-muted" role="status">{notice}</p>}

      {jobs.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border-color bg-bg-surface px-4 py-3">
            <p className="text-2xl font-bold tabular-nums">{jobs.length.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-xs text-text-muted">Total de importações</p>
          </div>
          <div className="rounded-xl border border-border-color bg-bg-surface px-4 py-3">
            <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{successRate}%</p>
            <p className="mt-1 text-xs text-text-muted">Taxa de sucesso</p>
          </div>
          <div className="rounded-xl border border-border-color bg-bg-surface px-4 py-3">
            <p className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-300">{pendingErrors.toLocaleString('pt-BR')}</p>
            <p className="mt-1 text-xs text-text-muted">Linhas com erro</p>
          </div>
        </div>
      )}

      {jobs.length === 0 && !error && <ImportEmptyState onStart={() => setUploadOpen(true)} />}
      {jobs.length > 0 && <div className="mt-6"><ImportHistoryTable jobs={jobs} onDetails={(job) => void openDetails(job)} /></div>}

      {uploadOpen && <ImportUploadModal onClose={() => setUploadOpen(false)} onUploaded={(message) => { setNotice(message); void load(); }} />}

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60" onClick={() => setDetail(null)} />
          <aside role="dialog" aria-label="Log da importação" className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border-color bg-bg-base shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-border-color px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-muted">Log de erros</p>
                <h2 className="text-base font-semibold">{detail.fileName}</h2>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Fechar" className="rounded-md p-1 text-text-muted"><X className="h-4 w-4" /></button>
            </header>
            <ul className="flex-1 space-y-3 overflow-auto p-5 text-sm">
              {detail.errors.length === 0 && <li className="text-text-muted">Nenhuma linha com erro.</li>}
              {detail.errors.map((row) => (
                <li key={`${row.line}-${row.sku}`} className="rounded-lg border border-border-color px-3 py-2">
                  <p className="font-mono text-xs text-text-muted">Linha {row.line} · {row.sku || 'sem SKU'}</p>
                  <p className="mt-1 text-text-primary">{row.message}</p>
                  {row.sku && (
                    <Link href={`/problemas?q=${encodeURIComponent(row.sku)}&importacao=${encodeURIComponent(detail.fileName)}`} className="mt-1 inline-flex text-xs font-semibold underline">
                      Ver na aba Problemas
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </main>
  );
}
