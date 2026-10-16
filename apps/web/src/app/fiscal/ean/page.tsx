import React from 'react';

export default function FiscalEanPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-slate-800 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Fila Fiscal de EAN / GTIN (Motor GVE)
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Validação humana obrigatória para códigos EAN-8/12/13/14 vindos dos canais quando o Bling está vazio. Nunca preenche automaticamente.
            </p>
          </div>
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
            Papel exigido: fiscal_approver
          </span>
        </div>
      </header>

      <section className="mt-8 rounded-lg border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-base font-semibold text-white">
          Propostas Pendentes (`ean_pending_validation`)
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Listagem: `GET /api/fiscal/ean/pending` &middot; Decisão: `POST /api/fiscal/ean/:id/review`
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-sm font-semibold text-emerald-400">
              Aprovar EAN (`decision = approve`)
            </h3>
            <p className="mt-1 text-xs text-slate-300">
              Confere dígito verificador GS1 (pesos 3/1 módulo 10), grava em `product_variants.ean` com `ean_status = valid`, registra `ean_validated_by` (`uuid` do aprovador) e adiciona linha em `ean_validation_history`.
            </p>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-sm font-semibold text-rose-400">
              Rejeitar EAN (`decision = reject`)
            </h3>
            <p className="mt-1 text-xs text-slate-300">
              Marca a proposta como `rejected` com o motivo informado, preserva o Bling sem alteração e registra a recusa em `ean_validation_history`.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
