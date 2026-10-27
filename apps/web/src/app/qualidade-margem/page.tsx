'use client';

import React, { useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';

interface MarginRow {
  sku: string;
  productName: string;
  channel: 'Mercado Livre' | 'Nuvemshop';
  salePrice: number;
  costPrice: number | null;
  stockSeller: number;
  scoreBling: number;
  scoreChannel: number;
}

const MARGIN_ITEMS: MarginRow[] = [
  {
    sku: 'DPS-VCL-275V',
    productName: 'DPS CLAMPER VCL SLIM 275V',
    channel: 'Nuvemshop',
    salePrice: 34.9,
    costPrice: 39.5,
    stockSeller: 12,
    scoreBling: 92,
    scoreChannel: 64,
  },
  {
    sku: '13621',
    productName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un.',
    channel: 'Nuvemshop',
    salePrice: 142.0,
    costPrice: 89.0,
    stockSeller: 18,
    scoreBling: 99,
    scoreChannel: 52,
  },
  {
    sku: 'Mercurio 400w e40',
    productName: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    channel: 'Mercado Livre',
    salePrice: 89.9,
    costPrice: 52.0,
    stockSeller: 24,
    scoreBling: 99,
    scoreChannel: 38,
  },
  {
    sku: 'BOT-34-209R',
    productName: 'BOTOEIRA 34-209R CAIXA ALTA- 9 FUROS (3X3) 22 MM',
    channel: 'Mercado Livre',
    salePrice: 118.0,
    costPrice: null,
    stockSeller: 5,
    scoreBling: 84,
    scoreChannel: 48,
  },
];

export default function QualidadeMargemPage() {
  const [channelFilter, setChannelFilter] = useState<string>('all');

  const filtered = MARGIN_ITEMS.filter(
    (m) => channelFilter === 'all' || m.channel === channelFilter
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">
              Proteção Comercial, Margem &amp; Qualidade de Prontidão
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Monitora preço contra custo cadastrado no Bling e explica os fatores que reduzem a nota de prontidão em cada canal.
          </p>
        </div>

        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
        >
          <option value="all">Todos os canais</option>
          <option value="Mercado Livre">Mercado Livre</option>
          <option value="Nuvemshop">Nuvemshop</option>
        </select>
      </header>

      {/* Regra Formal de Cálculo de Margem (Seção 5.5) */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <strong className="text-white">
              Regra de Transparência Financeira (Margem Bruta Simplificada):
            </strong>{' '}
            Como comissões variáveis e frete por venda pertencem ao fechamento do pedido no canal, este painel apresenta a{' '}
            <strong>Margem Bruta Simplificada</strong>{' '}
            <code className="text-emerald-300">((Preço de Venda - Custo Bling) / Preço de Venda × 100)</code>. Custos não preenchidos no Bling são exibidos como{' '}
            <strong className="text-amber-300">Custo ausente</strong> (jamais presumidos como zero). Preço abaixo do custo dispara alerta crítico imediato, mas não bloqueia estoque nem pausa.
          </div>
        </div>
      </section>

      {/* Tabela de Proteção Comercial */}
      <section className="mt-6 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/90 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3.5">SKU / Produto</th>
                <th className="px-4 py-3.5">Canal</th>
                <th className="px-4 py-3.5">Preço Venda</th>
                <th className="px-4 py-3.5">Custo Bling</th>
                <th className="px-4 py-3.5">Margem Bruta Simplificada</th>
                <th className="px-4 py-3.5">Nota de Prontidão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filtered.map((row) => {
                const hasCost = row.costPrice !== null;
                const belowCost =
                  hasCost && row.salePrice < (row.costPrice ?? 0);
                const grossMarginPct = hasCost
                  ? ((row.salePrice - (row.costPrice ?? 0)) / row.salePrice) *
                    100
                  : null;

                return (
                  <tr
                    key={`${row.sku}-${row.channel}`}
                    className={
                      belowCost
                        ? 'bg-rose-950/20 hover:bg-rose-950/30'
                        : 'hover:bg-zinc-900/80'
                    }
                  >
                    <td className="px-4 py-4">
                      <div className="font-mono text-xs font-semibold text-emerald-400">
                        {row.sku}
                      </div>
                      <div className="mt-0.5 text-xs text-white">
                        {row.productName}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-zinc-300">
                      {row.channel}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-bold text-white">
                      R$ {row.salePrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {hasCost ? (
                        <span className="text-zinc-200">
                          R$ {row.costPrice!.toFixed(2)}
                        </span>
                      ) : (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                          Custo ausente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs">
                      {grossMarginPct === null ? (
                        <span className="text-zinc-400">
                          Indisponível (cadastrar custo no Bling)
                        </span>
                      ) : belowCost ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 font-bold text-rose-300">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {grossMarginPct.toFixed(1)}% (Preço &lt; Custo)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />+
                          {grossMarginPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs">
                      <span className="text-zinc-300">
                        Bling: <strong>{row.scoreBling}</strong> · Canal:{' '}
                        <strong
                          className={
                            row.scoreChannel >= 50
                              ? 'text-emerald-400'
                              : 'text-amber-300'
                          }
                        >
                          {row.scoreChannel}/100
                        </strong>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
