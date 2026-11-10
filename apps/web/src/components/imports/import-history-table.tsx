import React from 'react';
import { API_BASE_URL } from '../../utils/api-client';

export interface ImportJobRow {
  id: string;
  file_name: string;
  status: 'running' | 'done' | 'failed' | string;
  total: number;
  rows_processed: number;
  rows_error: number;
  created_at: string;
  user_name: string;
}

function badge(job: ImportJobRow): { label: string; className: string } {
  if (job.status === 'failed') return { label: 'Falhou', className: 'bg-rose-600 text-white' };
  if (job.status === 'running') return { label: 'Processando', className: 'bg-sky-600 text-white' };
  if (job.rows_error > 0) return { label: 'Concluído com erros', className: 'bg-amber-500 text-amber-950' };
  return { label: 'Concluído', className: 'bg-emerald-700 text-white' };
}

export function ImportHistoryTable({
  jobs,
  onDetails,
}: {
  jobs: ImportJobRow[];
  onDetails: (job: ImportJobRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
          <tr className="h-10">
            <th className="px-4 font-semibold">Data/Hora</th>
            <th className="px-3 font-semibold">Arquivo</th>
            <th className="px-3 font-semibold">Usuário</th>
            <th className="px-3 font-semibold">Status</th>
            <th className="px-3 font-semibold">Progresso</th>
            <th className="px-4 text-right font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const state = badge(job);
            const total = job.total > 0 ? job.total : job.rows_processed;
            const percent = total === 0 ? 0 : Math.min(100, Math.round((job.rows_processed / total) * 100));
            return (
              <tr key={job.id} className="border-b border-border-color">
                <td className="px-4 py-3 text-xs tabular-nums text-text-muted">
                  {new Date(job.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-text-primary">{job.file_name}</td>
                <td className="px-3 py-3 text-xs">{job.user_name}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.className}`}>{state.label}</span>
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs tabular-nums text-text-muted">{job.rows_processed}/{total} linhas processadas</p>
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-bg-base">
                    <div className={`h-full ${job.status === 'failed' ? 'bg-rose-600' : 'bg-emerald-600'}`} style={{ width: `${job.status === 'running' ? percent : 100}%` }} />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => onDetails(job)} className="mr-2 text-xs font-semibold underline">Ver Detalhes</button>
                  {job.rows_error > 0 && (
                    <a className="text-xs font-semibold underline" href={`${API_BASE_URL}/api/catalog/imports/${job.id}/errors.csv`}>
                      Baixar Log de Erros (CSV)
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
