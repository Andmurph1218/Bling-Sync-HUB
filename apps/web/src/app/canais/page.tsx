'use client';

import React from 'react';
import {
  Sliders,
  Warehouse,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export default function CanaisConfiguracoesPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="border-b border-zinc-800 pb-6">
        <div className="flex items-center gap-2">
          <Sliders className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">
            Canais, Integrações Nativas &amp; Depósitos
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Monitora quem é responsável por estoque/preço e conteúdo em cada canal, evitando conflito entre o HUB e a integração nativa do Bling.
        </p>
      </header>

      {/* 5.4 Monitoramento das Integrações Nativas */}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Card Mercado Livre */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">
                Mercado Livre · JHS SHOPPING ML
              </h2>
              <p className="text-xs text-zinc-400">
                Loja Bling ID: <code className="text-emerald-400">204990471</code> · Seller ID: <code className="text-emerald-400">184060242</code>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              OAuth Conectado
            </span>
          </div>

          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <span className="text-zinc-400">Responsável por Preço e Estoque:</span>
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300">
                Integração Nativa do Bling (bling_native)
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <span className="text-zinc-400">Responsável por Conteúdo e Imagens:</span>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
                Bling Sync HUB (Modo Shadow · máx 25/exec)
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
              <strong className="text-white">Operações bloqueadas por responsabilidade:</strong>{' '}
              Escrita de estoque e preço em anúncios já publicados e qualquer escrita em localização Full (<code className="text-emerald-300">meli_facility</code>).
            </div>
          </div>
        </div>

        {/* Card Nuvemshop */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">
                Nuvemshop · Loja Oficial JHS
              </h2>
              <p className="text-xs text-zinc-400">
                Loja Bling ID: <code className="text-emerald-400">205681549</code> · Store ID: <code className="text-emerald-400">6667412</code>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              OAuth + 3 Webhooks Ativos
            </span>
          </div>

          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <span className="text-zinc-400">Responsável por Preço e Estoque:</span>
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300">
                Integração Nativa do Bling (bling_native)
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <span className="text-zinc-400">Responsável por Conteúdo, SEO e Medidas:</span>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-300">
                Bling Sync HUB (Modo Shadow · máx 25/exec)
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
              <strong className="text-white">Webhooks registrados:</strong>{' '}
              <code className="text-zinc-200">product/created</code> (#40454738),{' '}
              <code className="text-zinc-200">product/updated</code> (#40454739),{' '}
              <code className="text-zinc-200">product/deleted</code> (#40454740).
            </div>
          </div>
        </div>
      </section>

      {/* Depósitos Elegíveis para Estoque Publicado */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-sky-400" />
          <h2 className="text-base font-bold text-white">
            Depósitos do Bling e Regra de Soma de Estoque (`stock_warehouses`)
          </h2>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          O estoque publicado soma exclusivamente o <code className="text-zinc-300">saldo_virtual</code> dos depósitos classificados como <code className="text-zinc-300">role = seller</code> com <code className="text-zinc-300">include_in_push = true</code>.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-400">
              <tr>
                <th className="py-2.5 pr-4">ID no Bling</th>
                <th className="py-2.5 px-4">Nome do Depósito</th>
                <th className="py-2.5 px-4">Classificação (role)</th>
                <th className="py-2.5 pl-4">Entra na soma publicada?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              <tr>
                <td className="py-3 pr-4 font-mono font-bold text-emerald-400">
                  14886768228
                </td>
                <td className="py-3 px-4 font-semibold text-white">Geral</td>
                <td className="py-3 px-4">
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                    seller (Depósito próprio)
                  </span>
                </td>
                <td className="py-3 pl-4 font-semibold text-emerald-400">
                  Sim (include_in_push = true)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <strong>Regra de Ouro ao desligar sincronização nativa no futuro:</strong>{' '}
            desligar apenas a exportação nativa de estoque/preço no Bling, mantendo obrigatoriamente ligada a importação de pedidos para que o saldo continue baixando.
          </span>
        </div>
      </section>
    </main>
  );
}
