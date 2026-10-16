import React from 'react';

export default function MatchingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-slate-800 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Matching de Produtos &amp; Variantes (PIRE / VIR)
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Auto-vínculo exige 2 sinais fortes concordantes (score 95). Sinal único fica em sugestão (&le; 80). Conflitos e EAN compartilhado ficam em quarentena sem expirar.
            </p>
          </div>
          <span className="rounded border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
            Papel exigido: operator / admin
          </span>
        </div>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-base font-semibold text-white">
            Fila de Decisão Humana (`matching_queue`)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Endpoint: `GET /api/matching/queue` &middot; Resolução: `POST /api/matching/resolve`
          </p>
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>Confirmar vínculo (`confirm`)</strong>: grava `platform_links` com `match_confidence = 100` e libera o item como `linked`.
            </li>
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>Recusar candidato (`reject_candidate`)</strong>: grava par permanente em `match_rejections` (cache negativo do PIRE sem TTL) e mantém o anúncio aberto para outros candidatos.
            </li>
            <li className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <strong>Ignorar / Produto Novo (`dismiss` / `new_product`)</strong>: encerra a fila sem `master_product_id` e define `expires_at` de 60 dias para limpeza do payload pelo DLM.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-base font-semibold text-white">
            Lacunas da Matriz de Variantes (`variant_matrix_analysis`)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Comparação por `comboKey` normalizado via `attribute_value_aliases`
          </p>
          <ul className="mt-4 space-y-3 text-sm text-slate-300">
            <li className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
              <strong className="text-amber-400">missing_ml / missing_ns</strong>: Variante ativa existe no Bling e falta no canal (candidata a `CREATE` confirmado por humano).
            </li>
            <li className="rounded border border-rose-500/20 bg-rose-500/5 p-3">
              <strong className="text-rose-400">extra_ml / extra_ns</strong>: Variante publicada no canal sem produto/variante ativa no Bling (alerta crítico: venda sem lastro de estoque e de NF-e).
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
