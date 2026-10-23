'use client';

import React, { useState } from 'react';
import { Check, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { TechTooltip } from '../../../components/tech-tooltip';
import { useCurrentRole } from '../../../components/app-shell';

interface NcmRow {
  id: string;
  sku: string;
  productName: string;
  proposedNcm: string;
  origin: 'Mercado Livre' | 'Nuvemshop';
  firstApprover: string | null;
  secondApprover: string | null;
  tipiNote?: string;
  status: 'pending_first' | 'pending_second' | 'approved';
}

const INITIAL_NCM_ROWS: NcmRow[] = [
  {
    id: 'ncm-1',
    sku: 'Mercurio 400w e40',
    productName: 'Lâmpada Vapor Mercúrio 400w Hpl E40',
    proposedNcm: '8539.32.00',
    origin: 'Mercado Livre',
    firstApprover: 'Carla Mendes (fiscal1@blingsync.local)',
    secondApprover: null,
    status: 'pending_second',
  },
  {
    id: 'ncm-2',
    sku: '13621',
    productName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8',
    proposedNcm: '8546.90.00',
    origin: 'Nuvemshop',
    firstApprover: null,
    secondApprover: null,
    status: 'pending_first',
  },
  {
    id: 'ncm-3',
    sku: 'CONT-AUX-2NA2NF',
    productName: 'CONTATOR AUXILIAR 2NA+2NF',
    proposedNcm: '8536.49.00',
    origin: 'Mercado Livre',
    firstApprover: null,
    secondApprover: null,
    status: 'pending_first',
  },
];

export default function FiscalNcmPage() {
  const { currentUser } = useCurrentRole();
  const [rows, setRows] = useState<NcmRow[]>(INITIAL_NCM_ROWS);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleFirstConfirm = (row: NcmRow) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              firstApprover: `${currentUser.name} (${currentUser.email})`,
              status: 'pending_second',
            }
          : r
      )
    );
    setFeedback(
      `1ª confirmação registrada para ${row.sku} (${row.proposedNcm}). Aguardando um segundo aprovador distinto.`
    );
  };

  const handleSecondConfirm = (row: NcmRow) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              secondApprover: 'Roberto Silva (fiscal2@blingsync.local)',
              tipiNote: 'Posição TIPI validada no Capítulo 85',
              status: 'approved',
            }
          : r
      )
    );
    setFeedback(
      `2ª confirmação concluída por aprovador distinto com nota TIPI: master_products.ncm atualizado para ${row.proposedNcm} e gravado em ncm_audit_log.`
    );
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Dupla Confirmação de NCM (<TechTooltip term="NVE" />)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Código <code className="text-zinc-300">0000.00.00</code> exige confirmação em duas etapas por dois usuários{' '}
            <code className="text-zinc-300">fiscal_approver</code> distintos (<code className="text-zinc-300">second_review_by &lt;&gt; first_review_by</code>) com nota obrigatória da TIPI.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
          Segregação de Funções · 2 Revisores
        </span>
      </header>

      {feedback && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-emerald-300 hover:text-white"
          >
            Fechar
          </button>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3.5">SKU</th>
                <th className="px-4 py-3.5">NCM Proposto</th>
                <th className="px-4 py-3.5">Origem</th>
                <th className="px-4 py-3.5">1ª Confirmação</th>
                <th className="px-4 py-3.5">2ª Confirmação</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-900/80">
                  <td className="px-4 py-4">
                    <div className="font-mono text-xs font-semibold text-emerald-400">
                      {row.sku}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-300">
                      {row.productName}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs font-bold text-white">
                    {row.proposedNcm}
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {row.origin}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs">
                    {row.firstApprover ? (
                      <span className="text-emerald-300">{row.firstApprover}</span>
                    ) : (
                      <span className="text-zinc-500">Pendente</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-xs">
                    {row.secondApprover ? (
                      <span className="text-emerald-300">{row.secondApprover}</span>
                    ) : row.status === 'pending_second' ? (
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span>Aguardando um segundo aprovador distinto</span>
                      </div>
                    ) : (
                      <span className="text-zinc-500">Bloqueado até 1ª revisão</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {row.status === 'pending_first' && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                        Aguardando 1ª Aprovação
                      </span>
                    )}
                    {row.status === 'pending_second' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                        <ShieldAlert className="h-3 w-3" />
                        Aguardando 2ª Aprovação
                      </span>
                    )}
                    {row.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Aprovado (TIPI)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {row.status === 'pending_first' && (
                      <button
                        type="button"
                        onClick={() => handleFirstConfirm(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirmar 1ª Etapa
                      </button>
                    )}
                    {row.status === 'pending_second' && (
                      <button
                        type="button"
                        onClick={() => handleSecondConfirm(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirmar 2ª Etapa (TIPI)
                      </button>
                    )}
                    {row.status === 'approved' && (
                      <span className="text-xs font-semibold text-emerald-400">
                        Auditado em ncm_audit_log
                      </span>
                    )}
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
