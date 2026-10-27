'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Lock,
  ExternalLink,
  Layers,
  FileText,
  Send,
  History,
  Database,
} from 'lucide-react';
import { buildBlingProductUrl } from '../../../utils/matching-signals';

type ProductTab =
  | 'resumo'
  | 'dados_mestres'
  | 'conteudo'
  | 'variacoes'
  | 'fiscal'
  | 'publicacao'
  | 'historico';

const TABS: Array<{ id: ProductTab; label: string }> = [
  { id: 'resumo', label: '1. Resumo' },
  { id: 'dados_mestres', label: '2. Dados Mestres (Bling)' },
  { id: 'conteudo', label: '3. Conteúdo & Imagens' },
  { id: 'variacoes', label: '4. Variações' },
  { id: 'fiscal', label: '5. Fiscal (EAN / NCM / CEST)' },
  { id: 'publicacao', label: '6. Publicação' },
  { id: 'historico', label: '7. Histórico' },
];

export default function FichaUnicaProdutoPage({
  params,
}: {
  params: { id: string };
}) {
  const [activeTab, setActiveTab] = useState<ProductTab>('resumo');
  const blingId = params.id || '16723377536';

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4">
        <Link
          href="/catalogo"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o Catálogo de Produtos
        </Link>
      </div>

      {/* Cabeçalho da Ficha Única */}
      <header className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-300">
              Bling ID #{blingId}
            </span>
            <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 font-mono text-xs text-zinc-200">
              SKU: Mercurio 400w e40
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Fonte Soberana: Bling ERP v3
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-white">
            Lâmpada Vapor Mercúrio 400w Hpl E40 Cor Da Luz Branco-neutro
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Ficha Única comparando Bling, Mercado Livre e Nuvemshop. Explica por que cada valor foi escolhido antes de qualquer escrita.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={buildBlingProductUrl(blingId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <span>Abrir no Bling</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link
            href="/publicacoes"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Simular Sincronização</span>
          </Link>
        </div>
      </header>

      {/* Navegação das 7 Abas */}
      <div className="mt-6 flex flex-wrap gap-1.5 border-b border-zinc-800 pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border border-transparent bg-zinc-900/60 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da Aba Selecionada */}
      <section className="mt-6">
        {activeTab === 'resumo' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-zinc-900/60 p-5">
              <span className="text-xs font-semibold uppercase text-emerald-400">
                Bling ERP v3 (Soberano)
              </span>
              <p className="mt-2 text-2xl font-bold text-white">Nota 99 / 100</p>
              <p className="mt-1 text-xs text-zinc-400">
                Cadastro fiscal e operacional completo. Estoque seller publicado: <strong>24 un.</strong> (Depósito Geral 14886768228).
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5">
              <span className="text-xs font-semibold uppercase text-amber-400">
                Mercado Livre (JHS SHOPPING)
              </span>
              <p className="mt-2 text-2xl font-bold text-amber-300">Nota 38 / 100</p>
              <p className="mt-1 text-xs text-zinc-400">
                Bloqueado para publicação de conteúdo: falta mapear categoria oficial e expandir descrição técnica (&ge; 180 caracteres).
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5">
              <span className="text-xs font-semibold uppercase text-amber-400">
                Nuvemshop (Loja 6667412)
              </span>
              <p className="mt-2 text-2xl font-bold text-amber-300">Nota 34 / 100</p>
              <p className="mt-1 text-xs text-zinc-400">
                Pendente de enriquecimento de SEO (keywords, meta_description e seo_slug) antes da publicação.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'dados_mestres' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Database className="h-4 w-4 text-emerald-400" />
              <h2>Campos Protegidos (Grupo A — Soberania Absoluta do Bling)</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Estes valores jamais são sobrescritos por dados vindos do Mercado Livre ou da Nuvemshop.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Preço de Cadastro / Loja</span>
                <p className="mt-1 font-mono text-base font-bold text-white">R$ 89,90</p>
                <span className="text-[11px] text-emerald-400">Origem: Bling GET /produtos/lojas</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Preço de Custo</span>
                <p className="mt-1 font-mono text-base font-bold text-white">R$ 52,00</p>
                <span className="text-[11px] text-emerald-400">Margem bruta simplificada: +42,1%</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Estoque Publicável (Seller)</span>
                <p className="mt-1 font-mono text-base font-bold text-emerald-400">24 unidades</p>
                <span className="text-[11px] text-zinc-400">Soma apenas depósitos seller (exclui Full)</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'conteudo' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <FileText className="h-4 w-4 text-sky-400" />
              <h2>Comparação de Conteúdo por Fonte (Bling vs Marketplaces)</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              Nome e descrição do Bling permanecem intocáveis; títulos e descrições específicos por canal ficam em <code className="text-zinc-300">channel_content_overrides</code>.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-400">
                  <tr>
                    <th className="py-2.5 pr-4">Campo</th>
                    <th className="py-2.5 px-4">Bling ERP (Nota)</th>
                    <th className="py-2.5 px-4">Mercado Livre</th>
                    <th className="py-2.5 px-4">Nuvemshop</th>
                    <th className="py-2.5 pl-4">Decisão do HUB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-white">Título</td>
                    <td className="py-3 px-4 text-zinc-200">
                      Lampada Vapor Mercúrio 400w Hpl E40 (Grade A · 92)
                    </td>
                    <td className="py-3 px-4 text-zinc-300">
                      Lâmpada Vapor Mercúrio 400W E40 Industrial
                    </td>
                    <td className="py-3 px-4 text-zinc-300">
                      Lâmpada Vapor Mercúrio 400W HPL E40
                    </td>
                    <td className="py-3 pl-4 text-emerald-400 font-medium">
                      KEEP (Grade A/B no Bling nunca sofre substituição)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-white">Peso Líquido</td>
                    <td className="py-3 px-4 text-amber-300">0.001 kg (Sentinela · Grade F)</td>
                    <td className="py-3 px-4 text-emerald-300">0.285 kg (Grade A)</td>
                    <td className="py-3 px-4 text-zinc-400">0.280 kg</td>
                    <td className="py-3 pl-4 text-amber-300 font-medium">
                      Sugestão em Shadow: atualizar peso para 0.285 kg (origem ML)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'variacoes' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Layers className="h-4 w-4 text-emerald-400" />
              <h2>Árvore de Variações e Condições de Venda</h2>
            </div>
            <p className="mt-2 text-xs text-zinc-300">
              Variante Padrão (<code className="text-emerald-400">is_default = true</code>) · Formato Simples (`S`) · Sem lacunas (`missing_ml` / `extra_ml`) detectadas na matriz.
            </p>
          </div>
        )}

        {activeTab === 'fiscal' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Lock className="h-4 w-4 text-amber-400" />
              <h2>Conformidade Fiscal (EAN, NCM, CEST e Origem)</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">EAN / GTIN</span>
                <p className="mt-1 font-mono font-bold text-emerald-400">7891234567895</p>
                <span className="text-[11px] text-zinc-400">GS1 Brasil (789) · Válido</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">NCM (master_products)</span>
                <p className="mt-1 font-mono font-bold text-white">8539.32.00</p>
                <span className="text-[11px] text-emerald-400">Capítulo 85 TIPI válido</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">CEST (Espelho Bling)</span>
                <p className="mt-1 font-mono font-bold text-zinc-200">09.003.00</p>
                <span className="text-[11px] text-zinc-500">Informativo (não bloqueia push)</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">Origem Fiscal</span>
                <p className="mt-1 font-bold text-zinc-200">0 — Nacional</p>
                <span className="text-[11px] text-zinc-500">Emitido na NF-e pelo Bling</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'publicacao' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-sm font-bold text-white">
              Estado de Publicação por Passo (APE)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Enquanto <code className="text-zinc-300">stock_price = bling_native</code>, passos de estoque e preço permanecem sob controle nativo do Bling.
            </p>
            <div className="mt-4 flex items-center gap-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <span>Nenhuma falha de publicação registrada para este SKU.</span>
            </div>
          </div>
        )}

        {activeTab === 'historico' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <History className="h-4 w-4 text-zinc-300" />
              <h2>Histórico Auditado de Alterações</h2>
            </div>
            <div className="mt-3 space-y-2 text-xs text-zinc-300">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <strong>22/10/2026 22:48</strong> · Importação inicial via <code className="text-emerald-400">shadow-sync.ts</code> · Origem: <code className="text-zinc-200">system</code> · Saldo depósito Geral atualizado para 24 un.
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
