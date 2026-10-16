import React from 'react';

export default function FiscalNcmPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-slate-800 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Dupla Confirmação de NCM &amp; Auditoria TIPI (Motor NVE)
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              NCM (`0000.00.00`, capítulos 01–97) exige duas confirmações por usuários `fiscal_approver` distintos (`second_review_by &lt;&gt; first_review_by`) e nota obrigatória de consulta à TIPI.
            </p>
          </div>
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
            Papel exigido: fiscal_approver (2 revisores distintos)
          </span>
        </div>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-base font-semibold text-white">
            Fluxo de Dupla Confirmação (`ncm_manual_suggestions`)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Endpoint: `POST /api/fiscal/ncm/:suggestionId/confirm`
          </p>
          <ol className="mt-4 space-y-3 text-sm text-slate-300">
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>1ª Revisão (`pending_first &rarr; pending_second`)</strong>: Primeiro usuário `fiscal_approver` valida a posição fiscal e registra `first_review_by` e `first_review_note`.
            </li>
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>Trava de Segregação (`CHECK second_review_by &lt;&gt; first_review_by`)</strong>: O mesmo usuário que fez a 1ª revisão é bloqueado (`HTTP 409`) se tentar confirmar a 2ª etapa.
            </li>
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>2ª Revisão + Nota TIPI (`pending_second &rarr; approved`)</strong>: Segundo usuário `fiscal_approver` registra a nota de consulta à TIPI, atualiza `master_products.ncm` e grava linha imutável em `ncm_audit_log`.
            </li>
          </ol>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-base font-semibold text-white">
            Conflito entre Variantes &amp; Auditoria Imutável (`ncm_audit_log`)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Retenção operacional de 18 meses + arquivo imutável por 5 anos (`ncm_audit_log_archive`)
          </p>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="rounded border border-rose-500/20 bg-rose-500/5 p-3">
              <strong className="text-rose-400">Regra de Conflito (`ncm_status = conflict`)</strong>: Quando variantes ativas do mesmo pai trazem NCMs válidos diferentes, o pai entra em `conflict`, bloqueia `CONTENT`/`CREATE` e nenhum código em conflito vira sugestão.
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>Trilha Imutável</strong>: protegida por trigger `trg_ncm_audit_immutable` no PostgreSQL (proíbe `UPDATE` e `DELETE`).
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
