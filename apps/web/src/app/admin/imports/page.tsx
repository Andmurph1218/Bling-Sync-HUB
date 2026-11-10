'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentRole } from '../../../components/app-shell';
import { apiFetch } from '../../../utils/api-client';

interface ImportJob {
  id: string;
  file_name: string;
  status: string;
  rows_processed: number;
  rows_error: number;
  created_at: string;
}

export default function ImportHistoryPage() {
  const router = useRouter();
  const { currentUser, hasRole } = useCurrentRole();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser.id) return;
    if (!hasRole('admin')) router.replace('/?erro=403');
  }, [currentUser.id, hasRole, router]);

  useEffect(() => {
    if (!hasRole('admin')) return;
    void apiFetch<{ jobs: ImportJob[] }>('/api/catalog/imports')
      .then((payload) => setJobs(payload.jobs))
      .catch(() => setError('Não foi possível ler o histórico de importações.'));
  }, [hasRole]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Histórico de importações</h1>
      <p className="mt-1 text-sm text-text-muted">Cada planilha enviada no catálogo fica registrada com linhas processadas e erros.</p>
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      <ul className="mt-4 space-y-2">
        {jobs.length === 0 && <li className="text-sm text-text-muted">Nenhuma importação registrada.</li>}
        {jobs.map((job) => (
          <li key={job.id} className="rounded-xl border border-border-color bg-bg-surface px-4 py-3 text-sm">
            <p className="font-semibold">{job.file_name}</p>
            <p className="text-xs text-text-muted">
              {job.status} · {job.rows_processed} linhas · {job.rows_error} erros · {new Date(job.created_at).toLocaleString('pt-BR')}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
