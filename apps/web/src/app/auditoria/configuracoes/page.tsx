'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../utils/api-client';

interface SettingsChange {
  id: string;
  target: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  at: string;
  actor: string | null;
}

const TARGET: { [key: string]: string } = {
  user_role: 'Papel de usuário',
  tenant_settings: 'Configuração',
  api_key: 'Chave de API',
};

export default function SettingsAuditPage() {
  const [records, setRecords] = useState<SettingsChange[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ records: SettingsChange[] }>('/api/governance/audit')
      .then((payload) => setRecords(payload.records))
      .catch(() => setError('Não foi possível ler a auditoria de configurações.'));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-end justify-between border-b border-border-color pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Auditoria de configurações</h1>
          <p className="mt-1 text-sm text-text-muted">Quem mudou um papel, o fuso horário ou rotacionou uma chave.</p>
        </div>
        <Link href="/auditoria" className="text-xs font-semibold underline">Trilha operacional</Link>
      </header>
      {error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}
      <div className="mt-6 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-color text-[11px] uppercase text-text-muted">
            <tr className="h-10">
              <th className="px-4">Quando</th>
              <th className="px-3">Quem</th>
              <th className="px-3">Alvo</th>
              <th className="px-3">Campo</th>
              <th className="px-4">Mudança</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className="border-b border-border-color">
                <td className="px-4 py-3 text-xs tabular-nums text-text-muted">{new Date(record.at).toLocaleString('pt-BR')}</td>
                <td className="px-3 py-3 text-xs">{record.actor || 'Sistema'}</td>
                <td className="px-3 py-3 text-xs">{TARGET[record.target] ?? record.target}</td>
                <td className="px-3 py-3 font-mono text-xs">{record.field}</td>
                <td className="px-4 py-3 text-xs">
                  <span className="text-text-muted line-through">{record.previousValue || '(vazio)'}</span>
                  <span className="mx-1">→</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">{record.newValue || '(vazio)'}</span>
                </td>
              </tr>
            ))}
            {records.length === 0 && !error && (
              <tr><td colSpan={5} className="px-4 py-8 text-sm text-text-muted">Nenhuma alteração de configuração registrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
