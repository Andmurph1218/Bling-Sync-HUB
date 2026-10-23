'use client';

import React, { useState } from 'react';
import { Check, X, ShieldAlert, CheckCircle2, Ban } from 'lucide-react';
import { TechTooltip } from '../../components/tech-tooltip';

interface MatchingRow {
  id: string;
  blingSku: string;
  blingName: string;
  channelId: string;
  platform: 'Mercado Livre' | 'Nuvemshop';
  pireScore: number;
  strongSignals: string[];
  status: 'Sugestão' | 'Quarentena';
  quarantineReason?: string;
  resolution?: 'confirmed' | 'rejected';
}

const INITIAL_MATCHING_ROWS: MatchingRow[] = [
  {
    id: 'mq-1',
    blingSku: 'Mercurio 400w e40',
    blingName: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    channelId: 'MLB3948172610',
    platform: 'Mercado Livre',
    pireScore: 80,
    strongSignals: ['name_jw_92'],
    status: 'Sugestão',
  },
  {
    id: 'mq-2',
    blingSku: '13621',
    blingName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un.',
    channelId: 'NS-314517886',
    platform: 'Nuvemshop',
    pireScore: 78,
    strongSignals: ['sku_exact'],
    status: 'Sugestão',
  },
  {
    id: 'mq-3',
    blingSku: 'Infra Ray 220V 250W - Kit 5',
    blingName: 'Kit 5 un. Lâmpada Infravermelha 220V Aquecimento Secagem 250W',
    channelId: 'MLBU-FAM-882910',
    platform: 'Mercado Livre',
    pireScore: 45,
    strongSignals: ['ean_shared_conflict'],
    status: 'Quarentena',
    quarantineReason: 'Família User Product com itens apontando para 2 pais distintos no Bling',
  },
  {
    id: 'mq-4',
    blingSku: 'Infra Ray 127V 250W',
    blingName: 'Lâmpada Infravermelha 127V Aquecimento Secagem 250W',
    channelId: 'NS-314532102',
    platform: 'Nuvemshop',
    pireScore: 76,
    strongSignals: ['name_jw_90'],
    status: 'Sugestão',
  },
  {
    id: 'mq-5',
    blingSku: 'CONT-AUX-2NA2NF',
    blingName: 'CONTATOR AUXILIAR 2NA+2NF',
    channelId: 'MLB4019283711',
    platform: 'Mercado Livre',
    pireScore: 40,
    strongSignals: ['ean_7891234567895_shared'],
    status: 'Quarentena',
    quarantineReason: 'EAN compartilhado entre dois master_products distintos no Bling',
  },
];

export default function MatchingPage() {
  const [rows, setRows] = useState<MatchingRow[]>(INITIAL_MATCHING_ROWS);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleConfirm = (row: MatchingRow) => {
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, resolution: 'confirmed' } : r))
    );
    setFeedback(
      `Vínculo confirmado (match_confidence = 100): ${row.blingSku} ↔ ${row.channelId} gravado em platform_links.`
    );
  };

  const handleReject = (row: MatchingRow) => {
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, resolution: 'rejected' } : r))
    );
    setFeedback(
      `Par rejeitado permanentemente: (${row.blingSku}, ${row.channelId}) gravado em match_rejections (sem TTL).`
    );
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Fila de Matching (<TechTooltip term="PIRE" /> / <TechTooltip term="VIR" />)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Auto-vínculo exige 2 sinais fortes concordantes (score 95). Sinal único fica em sugestão (&le; 80). Recusas gravam em{' '}
            <TechTooltip term="match_rejections" />.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-medium text-amber-300">
            14 Sugestões
          </span>
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 font-medium text-rose-300">
            2 em Quarentena
          </span>
        </div>
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
                <th className="px-4 py-3.5">Produto Bling (SKU / Nome)</th>
                <th className="px-4 py-3.5">Anúncio no Canal</th>
                <th className="px-4 py-3.5">
                  Score <TechTooltip term="PIRE" />
                </th>
                <th className="px-4 py-3.5">Sinais Fortes</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-900/80">
                  <td className="px-4 py-4">
                    <div className="font-mono text-xs font-semibold text-emerald-400">
                      {row.blingSku}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-200">
                      {row.blingName}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-mono text-xs font-medium text-white">
                      {row.channelId}
                    </div>
                    <span className="mt-0.5 inline-block rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {row.platform}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold ${
                        row.pireScore >= 75
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      }`}
                    >
                      {row.pireScore} / 100
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {row.strongSignals.map((sig) => (
                        <span
                          key={sig}
                          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
                        >
                          {sig}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {row.status === 'Sugestão' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                        Sugestão
                      </span>
                    ) : (
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                          <ShieldAlert className="h-3 w-3" />
                          Quarentena
                        </span>
                        {row.quarantineReason && (
                          <p className="mt-1 max-w-xs text-[11px] text-zinc-400">
                            {row.quarantineReason}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {row.resolution === 'confirmed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Vínculo Confirmado
                      </span>
                    ) : row.resolution === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                        <Ban className="h-4 w-4" />
                        Gravado em match_rejections
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirm(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Confirmar Vínculo
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/25"
                        >
                          <X className="h-3.5 w-3.5" />
                          Rejeitar Par
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
