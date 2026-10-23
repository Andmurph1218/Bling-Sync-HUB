'use client';

import React, { useState } from 'react';
import { Check, X, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { TechTooltip } from '../../../components/tech-tooltip';
import { useCurrentRole } from '../../../components/app-shell';

interface EanRow {
  id: string;
  sku: string;
  variantName: string;
  proposedEan: string;
  gs1Validation: 'Válido' | 'Inválido' | 'Placeholder';
  gs1PrefixDetail: string;
  sourcePlatform: 'Mercado Livre' | 'Nuvemshop';
  status: 'Pendente' | 'Duplicado no Produto';
  decision?: 'approved' | 'rejected';
}

const INITIAL_EAN_ROWS: EanRow[] = [
  {
    id: 'ean-1',
    sku: 'Mercurio 400w e40',
    variantName: 'Padrão (220V · E40)',
    proposedEan: '7891234567895',
    gs1Validation: 'Válido',
    gs1PrefixDetail: 'GS1 Brasil (789) · Mod-10 OK',
    sourcePlatform: 'Mercado Livre',
    status: 'Pendente',
  },
  {
    id: 'ean-2',
    sku: '13621',
    variantName: 'Caixa 10 un. 30x30x3/8',
    proposedEan: '7898912345601',
    gs1Validation: 'Válido',
    gs1PrefixDetail: 'GS1 Brasil (789) · Mod-10 OK',
    sourcePlatform: 'Nuvemshop',
    status: 'Pendente',
  },
  {
    id: 'ean-3',
    sku: 'CONT-AUX-2NA2NF',
    variantName: 'Contator Auxiliar 2NA+2NF',
    proposedEan: '0000000000000',
    gs1Validation: 'Placeholder',
    gs1PrefixDetail: 'Dígitos repetidos rejeitados pelo GVE',
    sourcePlatform: 'Mercado Livre',
    status: 'Pendente',
  },
  {
    id: 'ean-4',
    sku: 'Infra Ray 127V 250W',
    variantName: '127V · 250W',
    proposedEan: '7896543210988',
    gs1Validation: 'Válido',
    gs1PrefixDetail: 'GS1 Brasil (789) · Compartilhado na mesma grade',
    sourcePlatform: 'Mercado Livre',
    status: 'Duplicado no Produto',
  },
  {
    id: 'ean-5',
    sku: 'DPS-VCL-275V',
    variantName: 'Clamper VCL Slim 275V',
    proposedEan: '7891112223339',
    gs1Validation: 'Inválido',
    gs1PrefixDetail: 'Dígito verificador GS1 incorreto',
    sourcePlatform: 'Nuvemshop',
    status: 'Pendente',
  },
];

export default function FiscalEanPage() {
  const { currentUser } = useCurrentRole();
  const [rows, setRows] = useState<EanRow[]>(INITIAL_EAN_ROWS);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canReviewFiscal =
    currentUser.role === 'fiscal_approver' || currentUser.role === 'admin';

  const handleDecision = (row: EanRow, decision: 'approved' | 'rejected') => {
    if (!canReviewFiscal) return;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, decision } : r))
    );
    setFeedback(
      decision === 'approved'
        ? `EAN ${row.proposedEan} aprovado por ${currentUser.name} e registrado em ean_validation_history.`
        : `EAN ${row.proposedEan} rejeitado por ${currentUser.name}; cadastro do Bling preservado.`
    );
  };

  const gs1Badge: Record<EanRow['gs1Validation'], string> = {
    Válido: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    Inválido: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    Placeholder: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Fila Fiscal de EAN / GTIN (<TechTooltip term="GVE" />)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Validação humana obrigatória para códigos GTIN/EAN externos quando o Bling está vazio. Nunca auto-preenche o ERP.
          </p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
          Papel exigido: fiscal_approver
        </span>
      </header>

      {!canReviewFiscal && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          <Lock className="h-4 w-4 text-rose-400" />
          <span>
            Seu papel atual (<strong>{currentUser.roleLabel}</strong>) possui acesso somente leitura. Alterne para{' '}
            <strong>Fiscal Approver</strong> ou <strong>Admin</strong> no topo para aprovar/rejeitar EANs.
          </span>
        </div>
      )}

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
                <th className="px-4 py-3.5">Variante</th>
                <th className="px-4 py-3.5">EAN Proposto</th>
                <th className="px-4 py-3.5">Validação GS1</th>
                <th className="px-4 py-3.5">Plataforma de Origem</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-900/80">
                  <td className="px-4 py-4 font-mono text-xs font-semibold text-emerald-400">
                    {row.sku}
                  </td>
                  <td className="px-4 py-4 text-xs text-zinc-200">
                    {row.variantName}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs font-bold text-white">
                    {row.proposedEan}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${gs1Badge[row.gs1Validation]}`}
                    >
                      {row.gs1Validation}
                    </span>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      {row.gs1PrefixDetail}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {row.sourcePlatform}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {row.status === 'Pendente' ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                        Pendente
                      </span>
                    ) : (
                      <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                        Duplicado no Produto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {row.decision === 'approved' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Aprovado
                      </span>
                    ) : row.decision === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                        <XCircle className="h-4 w-4" />
                        Rejeitado
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={
                            !canReviewFiscal || row.gs1Validation !== 'Válido'
                          }
                          onClick={() => handleDecision(row, 'approved')}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Aprovar
                        </button>
                        <button
                          type="button"
                          disabled={!canReviewFiscal}
                          onClick={() => handleDecision(row, 'rejected')}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                          Rejeitar
                        </button>
                      </div>
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
