'use client';

import React, { useEffect, useState } from 'react';
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
import { translateBlockerToPlainPortuguese } from '../../../utils/operational-state';
import { apiFetch, ApiError } from '../../../utils/api-client';

interface PushAttemptRow {
  id: string;
  productName: string;
  channel: string;
  operationType: string;
  state: string;
  createdAt: string;
  completedSteps: string[];
  failedStep: string | null;
  failureReason: string | null;
}

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

interface ProductDetailPayload {
  product: {
    id: string;
    bling_id: string;
    bling_sku: string;
    ncm: string | null;
    cest: string | null;
    tax_origin: number | null;
    unit: string | null;
    requires_cest: boolean;
    ncm_status: string;
    ncm_fiscal_risk: boolean;
    bling_tipo: string;
    bling_formato: string;
    name: string | null;
    description: string | null;
    short_description: string | null;
    brand: string | null;
    category: string | null;
    catalog_status: string;
    last_bling_sync: string | null;
  };
  variants: Array<{
    id: string;
    bling_sku: string;
    is_default: boolean;
    bling_formato: string;
    price: string | null;
    cost_price: string | null;
    stock: string | null;
    net_weight: string | null;
    gross_weight: string | null;
    width: string | null;
    height: string | null;
    depth: string | null;
    ean: string | null;
    ean_status: string;
    fiscal_risk_flag: boolean;
    is_active: boolean;
  }>;
  stockBalances: Array<{
    variant_id: string;
    bling_warehouse_id: string;
    saldo_fisico: string;
    saldo_virtual: string;
  }>;
  platformLinks: Array<{
    platform: string;
    platform_product_id: string;
    match_confidence: number;
    sync_status: string;
  }>;
  readiness: Array<{
    variant_id: string;
    score_bling: number;
    score_ml: number;
    score_ns: number;
    publishable_bling: boolean;
    publishable_ml: boolean;
    publishable_ns: boolean;
    blockers: string[];
    top_improvements: Array<{
      channel: string;
      code: string;
      description: string;
      potentialGain: number;
    }>;
  }>;
  channelOverrides: Array<{
    platform: string;
    field: string;
    value: string;
    source: string;
    status: string;
  }>;
  qualityHistory: Array<{
    field_name: string;
    old_value: string | null;
    new_value: string | null;
    decision: string;
    source: string;
    mode: string;
    applied: boolean;
    created_at: string;
  }>;
}

export default function FichaUnicaProdutoPage({
  params,
}: {
  params: { id: string };
}) {
  const [activeTab, setActiveTab] = useState<ProductTab>('resumo');
  const [detail, setDetail] = useState<ProductDetailPayload | null>(null);
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [pushAttempts, setPushAttempts] = useState<PushAttemptRow[]>([]);
  const blingId = params.id;

  useEffect(() => {
    void (async () => {
      setLoadState('loading');
      try {
        const [json, push] = await Promise.all([
          apiFetch<ProductDetailPayload>(`/api/dashboard/products/${encodeURIComponent(blingId)}`),
          apiFetch<{ attempts: PushAttemptRow[] }>('/api/dashboard/push-attempts').catch(() => ({ attempts: [] })),
        ]);
        setDetail(json);
        setPushAttempts(push.attempts.filter((a) => a.productName === json.product.name));
        setLiveFromDb(true);
        setLoadState('ok');
      } catch (err) {
        setLiveFromDb(false);
        setLoadState(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error');
      }
    })();
  }, [blingId]);

  if (loadState !== 'ok' || !detail) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o Catálogo de Produtos
        </Link>
        <div
          role={loadState === 'loading' ? 'status' : 'alert'}
          className={`mt-6 rounded-xl border p-6 text-sm ${
            loadState === 'loading'
              ? 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {loadState === 'loading' && 'Carregando ficha do produto...'}
          {loadState === 'notfound' && `Produto Bling #${blingId} não encontrado no catálogo do HUB. Execute uma sincronização ou confira o ID.`}
          {loadState === 'error' && 'Não foi possível carregar a ficha do produto. Verifique se a API local está em execução.'}
        </div>
      </main>
    );
  }

  const prod = detail.product;
  const mainVar = detail.variants[0];
  const mainReadiness = detail.readiness[0];

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
              Bling ID #{prod?.bling_id ?? blingId}
            </span>
            <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 font-mono text-xs text-zinc-200">
              SKU: {prod?.bling_sku || '(Sem SKU cadastrado)'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {liveFromDb
                ? 'Dados reais lidos do PostgreSQL 16'
                : 'Fonte Soberana: Bling ERP v3'}
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-white">
            {prod.name ?? `Produto Bling #${prod.bling_id}`}
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Ficha Única comparando Bling, Mercado Livre e Nuvemshop. Explica por que cada valor foi escolhido antes de qualquer escrita.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={buildBlingProductUrl(prod?.bling_id ?? blingId)}
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
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-500/30 bg-zinc-900/60 p-5">
                <span className="text-xs font-semibold uppercase text-emerald-400">
                  Bling ERP v3 (Soberano)
                </span>
                <p className="mt-2 text-2xl font-bold text-white">
                  Nota {mainReadiness?.score_bling ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Estoque seller publicado:{' '}
                  <strong>
                    {mainVar?.stock !== null && mainVar?.stock !== undefined
                      ? Math.floor(Number(mainVar.stock))
                      : 'Aguardando leitura'}{' '}
                    un.
                  </strong>{' '}
                  (Depósito Geral 14886768228).
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5">
                <span className="text-xs font-semibold uppercase text-amber-400">
                  Mercado Livre (JHS SHOPPING)
                </span>
                <p className="mt-2 text-2xl font-bold text-amber-300">
                  Nota {mainReadiness?.score_ml ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {mainReadiness?.publishable_ml
                    ? 'Apto para publicar conteúdo no Mercado Livre.'
                    : 'Pendente de categoria verificada ou expansão de descrição técnica.'}
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-zinc-900/60 p-5">
                <span className="text-xs font-semibold uppercase text-amber-400">
                  Nuvemshop (Loja 6667412)
                </span>
                <p className="mt-2 text-2xl font-bold text-amber-300">
                  Nota {mainReadiness?.score_ns ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {mainReadiness?.publishable_ns
                    ? 'Apto para publicar conteúdo na Nuvemshop.'
                    : 'Pendente de enriquecimento de SEO (keywords, meta_description e seo_slug).'}
                </p>
              </div>
            </div>

            {mainReadiness?.blockers && mainReadiness.blockers.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="text-sm font-bold text-white">
                  Requisitos Pendentes Explicados para o Operador
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {mainReadiness.blockers.map((b) => {
                    const tr = translateBlockerToPlainPortuguese(b);
                    return (
                      <div
                        key={b}
                        className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 text-xs"
                      >
                        <p className="font-semibold text-amber-300">{tr.title}</p>
                        <p className="mt-1 text-zinc-300">
                          <strong>Próximo passo:</strong> {tr.nextStep}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Preço de Cadastro</span>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {mainVar?.price ? `R$ ${mainVar.price}` : 'Sem preço'}
                </p>
                <span className="text-[11px] text-emerald-400">Origem: Bling v3</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Preço de Custo</span>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {mainVar?.cost_price ? `R$ ${mainVar.cost_price}` : 'Custo ausente'}
                </p>
                <span className="text-[11px] text-zinc-400">Nunca presumido como zero</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Estoque Publicável (Seller)</span>
                <p className="mt-1 font-mono text-base font-bold text-emerald-400">
                  {mainVar?.stock !== null && mainVar?.stock !== undefined
                    ? Math.floor(Number(mainVar.stock))
                      : 'Aguardando leitura'}{' '}
                  un.
                </p>
                <span className="text-[11px] text-zinc-400">Soma apenas depósitos seller</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <span className="text-[11px] uppercase text-zinc-400">Marca / Formato</span>
                <p className="mt-1 text-sm font-bold text-white">
                  {prod?.brand || 'Sem marca'} · Formato {prod?.bling_formato ?? 'S'}
                </p>
                <span className="text-[11px] text-zinc-400">Unidade: {prod?.unit ?? 'UN'}</span>
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
                    <th className="py-2.5 px-4">Valor no Bling ERP</th>
                    <th className="py-2.5 pl-4">Regra Aplicada pelo HUB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-white">Título Mestre</td>
                    <td className="py-3 px-4 text-zinc-200">{prod?.name}</td>
                    <td className="py-3 pl-4 text-emerald-400 font-medium">
                      KEEP — Protegido (nunca recebe texto de marketplace)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-white">Peso Líquido / Bruto</td>
                    <td className="py-3 px-4 font-mono text-zinc-200">
                      {mainVar?.net_weight ?? '—'} kg / {mainVar?.gross_weight ?? '—'} kg
                    </td>
                    <td className="py-3 pl-4 text-zinc-300">
                      Grupo B (CQS) — enriquecível apenas se o Bling estiver vazio ou com sentinela
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-white">Dimensões (L × A × P)</td>
                    <td className="py-3 px-4 font-mono text-zinc-200">
                      {mainVar?.width ?? '—'} × {mainVar?.height ?? '—'} × {mainVar?.depth ?? '—'} cm
                    </td>
                    <td className="py-3 pl-4 text-zinc-300">
                      Enviadas no passo isolado <code>measures</code> na Nuvemshop (sem preço/estoque)
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
              <h2>Variações e Saldos por Depósito (`variant_stock_balances`)</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
              {(detail?.stockBalances ?? []).map((bal) => (
                <div
                  key={`${bal.variant_id}-${bal.bling_warehouse_id}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5"
                >
                  <span className="font-mono font-bold text-emerald-400">
                    Depósito #{bal.bling_warehouse_id}
                  </span>
                  <p className="mt-1 text-zinc-200">
                    Saldo Físico: <strong>{Math.floor(Number(bal.saldo_fisico))}</strong> · Saldo Virtual:{' '}
                    <strong>{Math.floor(Number(bal.saldo_virtual))}</strong>
                  </p>
                </div>
              ))}
            </div>
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
                <p className="mt-1 font-mono font-bold text-emerald-400">
                  {mainVar?.ean || 'Ausente'}
                </p>
                <span className="text-[11px] text-zinc-400">
                  Status GVE: {mainVar?.ean_status ?? 'sem variante'}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">NCM (master_products)</span>
                <p className="mt-1 font-mono font-bold text-white">
                  {prod?.ncm || 'Ausente'}
                </p>
                <span className="text-[11px] text-emerald-400">
                  Status NVE: {prod.ncm_status}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">CEST (Espelho Bling)</span>
                <p className="mt-1 font-mono font-bold text-zinc-200">
                  {prod?.cest || 'Não informado'}
                </p>
                <span className="text-[11px] text-zinc-500">Informativo (não bloqueia push)</span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <span className="text-zinc-400">Origem Fiscal</span>
                <p className="mt-1 font-bold text-zinc-200">
                  {prod.tax_origin === null ? 'Não informada' : prod.tax_origin === 0 ? '0 — Nacional' : `${prod.tax_origin} — ver tabela de origem`}
                </p>
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
            {pushAttempts.length === 0 ? (
              <div className="mt-4 flex items-center gap-3 text-xs text-zinc-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Nenhuma tentativa de publicação registrada para este produto (modo shadow).</span>
              </div>
            ) : (
              <ul className="mt-4 space-y-2 text-xs">
                {pushAttempts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{a.channel} · {a.operationType}</span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-200">{a.state}</span>
                      <span className="text-zinc-500">{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    {a.completedSteps.length > 0 && (
                      <p className="mt-1 text-emerald-300">Passos confirmados: {a.completedSteps.join(' → ')}</p>
                    )}
                    {a.failureReason && (
                      <p className="mt-1 text-amber-300">
                        {a.failedStep ? `Passo ${a.failedStep}: ` : ''}{a.failureReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
                <strong>
                  {prod.last_bling_sync
                    ? new Date(prod.last_bling_sync).toLocaleString('pt-BR')
                    : 'Sem leitura registrada'}
                </strong>{' '}
                · Última leitura do cadastro no Bling v3 · Origem: <code className="text-zinc-200">system</code>
              </div>
              {detail.qualityHistory.length === 0 ? (
                <p className="text-zinc-500">Nenhuma alteração de conteúdo proposta ou aplicada pelo motor de qualidade.</p>
              ) : (
                detail.qualityHistory.map((h, idx) => (
                  <div key={`${h.field_name}-${idx}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <strong>{new Date(h.created_at).toLocaleString('pt-BR')}</strong> · Campo <code>{h.field_name}</code> · Decisão{' '}
                    <strong>{h.decision}</strong> ({h.mode === 'shadow' ? 'simulação, não aplicada' : h.applied ? 'aplicada' : 'não aplicada'})
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <span className="text-zinc-400">Anterior: {h.old_value ?? '(vazio)'}</span>
                      <span className="text-emerald-300">Proposto: {h.new_value ?? '(vazio)'}</span>
                    </div>
                    <span className="text-zinc-500">Origem: {h.source}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
