'use client';

import React from 'react';
import { History, ShieldCheck, Lock } from 'lucide-react';

interface AuditRecord {
  id: string;
  when: string;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  originActor: string;
  result: string;
  table: 'control_changes' | 'ncm_audit_log' | 'ean_validation_history';
}

const AUDIT_RECORDS: AuditRecord[] = [
  {
    id: 'aud-1',
    when: '19/10/2026 15:59',
    whatChanged: 'Classificação do depósito Bling #14886768228 (Geral)',
    previousValue: 'role = unclassified · include_in_push = false',
    newValue: 'role = seller · include_in_push = true',
    originActor: 'Admin (admin@blingsync.local · origin = admin)',
    result: 'Aplicado e protegido por trigger trg_control_changes_immutable',
    table: 'control_changes',
  },
  {
    id: 'aud-2',
    when: '19/10/2026 16:00',
    whatChanged: 'Vínculo da loja Mercado Livre no Bling',
    previousValue: 'bling_loja_id = não configurado',
    newValue: 'bling_loja_id = 204990471 (JHS SHOPPING ML)',
    originActor: 'Admin (admin@blingsync.local · origin = admin)',
    result: 'Aplicado em channel_stores e registrado em control_changes',
    table: 'control_changes',
  },
  {
    id: 'aud-3',
    when: '19/10/2026 16:00',
    whatChanged: 'Vínculo da loja Nuvemshop no Bling',
    previousValue: 'bling_loja_id = não configurado',
    newValue: 'bling_loja_id = 205681549 (Nuvemshop)',
    originActor: 'Admin (admin@blingsync.local · origin = admin)',
    result: 'Aplicado em channel_stores e registrado em control_changes',
    table: 'control_changes',
  },
  {
    id: 'aud-4',
    when: '22/10/2026 22:48',
    whatChanged: 'Primeira sincronização real de catálogo em modo Shadow',
    previousValue: '0 produtos sincronizados',
    newValue: '15 produtos Bling + 50 itens ML + 50 produtos Nuvemshop',
    originActor: 'Processo shadow-sync.ts (origin = system)',
    result: 'Concluído sem erros e sem nenhuma escrita externa nos canais',
    table: 'control_changes',
  },
];

export default function AuditoriaPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Auditoria, Rastreabilidade &amp; Retenção Fiscal (5 Anos)
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Cada registro responde: O que mudou? Qual era o valor anterior? Qual é o valor novo? Quem originou? Qual foi o resultado?
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <Lock className="h-3.5 w-3.5" />
          Tabelas Imutáveis no PostgreSQL 16
        </span>
      </header>

      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3.5">1. O que mudou?</th>
                <th className="px-4 py-3.5">2. Valor Anterior</th>
                <th className="px-4 py-3.5">3. Valor Novo / Proposto</th>
                <th className="px-4 py-3.5">4. Quem / Qual processo originou?</th>
                <th className="px-4 py-3.5">5. Qual foi o resultado?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {AUDIT_RECORDS.map((rec) => (
                <tr key={rec.id} className="hover:bg-zinc-900/80">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-white">
                      {rec.whatChanged}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {rec.when} · Tabela: <code>{rec.table}</code>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-zinc-400">
                    {rec.previousValue}
                  </td>
                  <td className="px-4 py-4 font-mono font-semibold text-emerald-300">
                    {rec.newValue}
                  </td>
                  <td className="px-4 py-4 text-zinc-200">{rec.originActor}</td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      {rec.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
