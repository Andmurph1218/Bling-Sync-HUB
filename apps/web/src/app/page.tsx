import React from 'react';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Visão Geral do Catálogo &amp; Operação
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Monitoramento de conexões OAuth, pior score de prontidão (CRE), alertas fiscais e preço abaixo do custo.
        </p>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Conexões OAuth
          </h2>
          <p className="mt-2 text-2xl font-bold text-emerald-400">3 / 3</p>
          <p className="mt-1 text-xs text-slate-400">
            Bling v3 · Mercado Livre · Nuvemshop (AES-256-GCM + Single-Flight)
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Pior Score (KPI CRE)
          </h2>
          <p className="mt-2 text-2xl font-bold text-amber-400">Variante Ativa</p>
          <p className="mt-1 text-xs text-slate-400">
            Estoque e pausa nunca dependem nem leem o score do CRE
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Alertas Fiscais (GVE / NVE)
          </h2>
          <p className="mt-2 text-2xl font-bold text-rose-400">Bloqueio CONTENT/CREATE</p>
          <p className="mt-1 text-xs text-slate-400">
            EAN duplicate e NCM conflict bloqueiam publicação de conteúdo
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Preço &lt; Custo
          </h2>
          <p className="mt-2 text-2xl font-bold text-orange-400">Alerta Crítico</p>
          <p className="mt-1 text-xs text-slate-400">
            Alerta imediato sem bloquear estoque, pausa nem passo de preço
          </p>
        </div>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-3">
        <Link
          href="/matching"
          className="block rounded-lg border border-slate-800 bg-slate-900/40 p-6 transition hover:border-slate-700"
        >
          <h3 className="text-base font-semibold text-white">
            1. Fila de Matching (`/matching`)
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Sugestões multi-sinal, quarentena de EAN compartilhado ou família User Product em conflito, recusas permanentes (`match_rejections`) e lacunas da matriz (`missing_ml` / `extra_ml`).
          </p>
        </Link>

        <Link
          href="/fiscal/ean"
          className="block rounded-lg border border-slate-800 bg-slate-900/40 p-6 transition hover:border-slate-700"
        >
          <h3 className="text-base font-semibold text-white">
            2. Fila Fiscal de EAN (`/fiscal/ean`)
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Aprovação ou rejeição humana de códigos GTIN/EAN válidos vindos dos marketplaces quando o Bling está vazio (nunca auto-preenche).
          </p>
        </Link>

        <Link
          href="/fiscal/ncm"
          className="block rounded-lg border border-slate-800 bg-slate-900/40 p-6 transition hover:border-slate-700"
        >
          <h3 className="text-base font-semibold text-white">
            3. Dupla Confirmação de NCM (`/fiscal/ncm`)
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Aprovação em duas etapas por dois usuários `fiscal_approver` distintos com nota obrigatória de consulta à TIPI e registro imutável em `ncm_audit_log`.
          </p>
        </Link>
      </section>
    </main>
  );
}
