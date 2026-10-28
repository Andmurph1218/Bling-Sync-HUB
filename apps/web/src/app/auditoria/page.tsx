'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { History, ShieldCheck, Lock, Cpu, ArrowRight } from 'lucide-react';
import { apiFetch, ApiError } from '../../utils/api-client';

interface AuditRecord {
  id: string;
  when: string;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  originActor: string;
  result: string;
  table: string;
}

interface MotorEnvelope {
  motor: string;
  motorNamePlain: string;
  resultState: 'healthy' | 'attention_required' | 'blocked';
  operationalExplanation: string;
  evidencesUsed: string[];
  ruleApplied: string;
  affectedCount: number;
  affectedTargetLabel: string;
  recommendedNextAction: string;
  actionHref: string;
  approvalMode: string;
  executionId: string;
}

export default function AuditoriaPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [motors, setMotors] = useState<MotorEnvelope[]>([]);
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [aj, mj] = await Promise.all([
          apiFetch<{ records?: AuditRecord[] }>('/api/dashboard/audit-trail'),
          apiFetch<{ motors?: MotorEnvelope[] }>('/api/dashboard/motors-diagnostic'),
        ]);
        setRecords(aj.records ?? []);
        setMotors(mj.motors ?? []);
        setLiveFromDb(true);
      } catch (err) {
        setLiveFromDb(false);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? 'Seu papel não tem acesso à trilha de auditoria (restrita a Administrador e Revisor Fiscal).'
            : 'Não foi possível carregar a auditoria da API local.'
        );
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {loadError && (
        <div role="alert" className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{loadError}</div>
      )}
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <History className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Auditoria, Rastreabilidade &amp; Diagnóstico dos 10 Motores
            </h1>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                liveFromDb
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {liveFromDb ? 'Trilha real do PostgreSQL 16' : 'Modo demonstração'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Cada registro responde: O que mudou? Qual era o valor anterior? Qual é o valor novo? Quem originou? Qual foi o resultado?
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <Lock className="h-3.5 w-3.5" />
          Tabelas Imutáveis · Retenção Fiscal 5 Anos
        </span>
      </header>

      {/* Seção 6: Evolução dos 10 Motores (Estrutura Consistente) */}
      {motors.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
              Diagnóstico Padronizado dos 10 Motores (Seção 6 — Resultado, Evidências, Regra e Próxima Ação)
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {motors.map((m) => {
              const badgeColor =
                m.resultState === 'healthy'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : m.resultState === 'blocked'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300';

              const stateLabel =
                m.resultState === 'healthy'
                  ? 'Operacional'
                  : m.resultState === 'blocked'
                  ? 'Com Bloqueio'
                  : 'Exige Atenção';

              return (
                <div
                  key={m.motor}
                  className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white">
                        {m.motor} — {m.motorNamePlain}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badgeColor}`}>
                        {stateLabel} ({m.affectedCount})
                      </span>
                    </div>
                    <p className="text-zinc-200">{m.operationalExplanation}</p>
                    <p className="text-[11px] text-zinc-400">
                      <strong>Regra aplicada:</strong> {m.ruleApplied}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      <strong>Evidências:</strong> {m.evidencesUsed.join(' · ')}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2.5">
                    <span className="font-mono text-[10px] text-zinc-500">
                      Exec: {m.executionId}
                    </span>
                    <Link
                      href={m.actionHref}
                      className="inline-flex items-center gap-1 font-semibold text-emerald-400 hover:underline"
                    >
                      <span>{m.recommendedNextAction}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Seção 5.7: Tabela de Auditoria */}
      <section className="mt-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
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
              {records.map((rec) => (
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
