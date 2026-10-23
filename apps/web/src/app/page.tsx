'use client';

import React from 'react';
import Link from 'next/link';
import {
  Shield,
  Gauge,
  FileWarning,
  AlertTriangle,
  ArrowRight,
  GitCompare,
  Barcode,
  FileCheck2,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { TechTooltip } from '../components/tech-tooltip';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Visão Geral do Catálogo &amp; Operação
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Monitoramento em tempo real de conexões OAuth, prontidão (<TechTooltip term="CRE" />), bloqueios fiscais (<TechTooltip term="GVE" /> / <TechTooltip term="NVE" />) e proteção de margem.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300">
          <Clock className="h-4 w-4 text-emerald-400" />
          <span>Última sync shadow: há 4 min · 15 produtos</span>
        </div>
      </header>

      {/* A. Grid de KPIs (Topo) */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Conexões OAuth */}
        <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Conexões OAuth
            </h2>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-400">
              <Shield className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold text-emerald-400">3 / 3</p>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                AES-256-GCM
              </span>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Bling v3 · Mercado Livre · Nuvemshop com renovação Single-Flight em <code className="text-zinc-300">oauth_tokens</code>.
            </p>
          </div>
        </div>

        {/* Card 2: Pior Score (CRE) com Barra de Progresso */}
        <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Prontidão (<TechTooltip term="CRE" />)
            </h2>
            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-400">
              <Gauge className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold text-white">
                Média: <span className="text-amber-400">68</span>
                <span className="text-sm font-normal text-zinc-500">/100</span>
              </p>
              <span className="text-xs font-medium text-amber-400">
                12 abaixo do threshold
              </span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-400"
                style={{ width: '68%' }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              12 produtos abaixo do threshold. Estoque e pausa nunca dependem do CRE.
            </p>
          </div>
        </div>

        {/* Card 3: Alertas Fiscais (GVE / NVE) */}
        <div className="flex flex-col justify-between rounded-xl border border-rose-500/30 bg-zinc-900/60 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Alertas Fiscais (<TechTooltip term="GVE" /> / <TechTooltip term="NVE" />)
            </h2>
            <span className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400">
              <FileWarning className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-bold text-rose-400">8 Bloqueios Ativos</p>
            <p className="mt-1.5 text-xs text-zinc-400">
              EAN duplicado e NCM em conflito bloqueiam publicação de conteúdo (<code className="text-zinc-300">CONTENT</code> / <code className="text-zinc-300">CREATE</code>).
            </p>
            <div className="mt-3">
              <Link
                href="/fiscal/ean"
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
              >
                <span>Ver Fila</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Card 4: Preço < Custo */}
        <div className="flex flex-col justify-between rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Preço &lt; Custo
            </h2>
            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-bold text-amber-400">3 Alertas Críticos</p>
            <p className="mt-1.5 text-xs text-zinc-400">
              Alerta imediato de margem negativa sem bloquear estoque, pausa nem passo de preço (<TechTooltip term="APE" />).
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-300/90">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Estoque Full (<TechTooltip term="meli_facility" />) isolado</span>
            </div>
          </div>
        </div>
      </section>

      {/* B. Filas de Trabalho Prioritárias */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              Filas de Trabalho Prioritárias
            </h2>
            <p className="text-xs text-zinc-400">
              Decisões humanas auditadas para identidade de catálogo e conformidade fiscal.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          {/* Widget 1: Matching (PIRE / VIR) */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition hover:border-zinc-700">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <GitCompare className="h-4 w-4 text-sky-400" />
                  Matching (<TechTooltip term="PIRE" /> / <TechTooltip term="VIR" />)
                </span>
                <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                  Operador
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                Sugestões multi-sinal e conflitos de família.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <span className="block text-xl font-bold text-amber-400">14</span>
                  <span className="text-xs text-zinc-400">Sugestões</span>
                </div>
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                  <span className="block text-xl font-bold text-rose-400">2</span>
                  <span className="text-xs text-zinc-400">Quarentena</span>
                </div>
              </div>
            </div>

            <Link
              href="/matching"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
            >
              <span>Abrir Fila</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Widget 2: Fiscal EAN (GVE) */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition hover:border-zinc-700">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <Barcode className="h-4 w-4 text-emerald-400" />
                  Fiscal EAN (<TechTooltip term="GVE" />)
                </span>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                  Fiscal
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                Aprovação de GTIN/EAN externos.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <span className="block text-xl font-bold text-amber-400">5</span>
                  <span className="text-xs text-zinc-400">Pendentes</span>
                </div>
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                  <span className="block text-xl font-bold text-rose-400">1</span>
                  <span className="text-xs text-zinc-400">Duplicado no Produto</span>
                </div>
              </div>
            </div>

            <Link
              href="/fiscal/ean"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
            >
              <span>Abrir Fila</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Widget 3: Fiscal NCM (NVE) */}
          <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition hover:border-zinc-700">
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <FileCheck2 className="h-4 w-4 text-amber-400" />
                  Fiscal NCM (<TechTooltip term="NVE" />)
                </span>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                  2 Aprovadores
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                Dupla confirmação de NCM.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                  <span className="block text-xl font-bold text-amber-400">2</span>
                  <span className="text-xs text-zinc-400">Aguardando 1ª Aprovação</span>
                </div>
                <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                  <span className="block text-xl font-bold text-sky-400">1</span>
                  <span className="text-xs text-zinc-400">Aguardando 2ª Aprovação</span>
                </div>
              </div>
            </div>

            <Link
              href="/fiscal/ncm"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
            >
              <span>Abrir Fila</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
