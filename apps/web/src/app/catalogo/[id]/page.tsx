'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { EmptySkuNotice, isBlankSku } from '../../../components/empty-sku-notice';
import { MERCADO_LIVRE_ACTIVE } from '../../../config/channels';

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

type ProductTab = 'geral' | 'variacoes' | 'imagens' | 'atributos' | 'canais' | 'fiscal';

const TABS: Array<{ id: ProductTab; label: string }> = [
  { id: 'geral', label: 'Geral' },
  { id: 'variacoes', label: 'Variações' },
  { id: 'imagens', label: 'Imagens' },
  { id: 'atributos', label: 'Atributos' },
  { id: 'canais', label: 'Canais' },
  { id: 'fiscal', label: 'Fiscal' },
];

interface CatalogSheet {
  item: {
    id: string;
    name: string | null;
    brand: string | null;
    checklist: { percent: number; items: Array<{ code: string; ok: boolean; title: string; fixHref: string }> };
    integrations?: Array<{
      platform: string;
      label: string;
      percent: number;
      ready: boolean;
      blockers: Array<{ code: string; title: string; fixHref: string; where: 'erp' | 'hub' }>;
    }>;
  };
  images: Array<{ url_normalized: string; is_cover_eligible: boolean; rights_status: string; position_ml: number | null; position_ns: number | null }>;
  storePrices: Array<{ platform: string; store_price: string | null; store_promotional_price: string | null }>;
  category: { id: string; name: string } | null;
}

interface HubCategoryOption {
  id: string;
  name: string;
}

interface ProductDetailPayload {
  product: {
    id: string;
    erp_id: string;
    erp_sku: string;
    ncm: string | null;
    cest: string | null;
    tax_origin: number | null;
    unit: string | null;
    requires_cest: boolean;
    ncm_status: string;
    ncm_fiscal_risk: boolean;
    bling_tipo: string;
    product_format: string;
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
    erp_sku: string;
    is_default: boolean;
    product_format: string;
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

function FichaUnicaProdutoPage({
  params,
}: {
  params: { id: string };
}) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('aba');
  const initialTab: ProductTab =
    requested === 'variacoes' || requested === 'imagens' || requested === 'atributos' || requested === 'canais' || requested === 'fiscal'
      ? requested
      : 'geral';
  const [activeTab, setActiveTab] = useState<ProductTab>(initialTab);
  const [detail, setDetail] = useState<ProductDetailPayload | null>(null);
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [pushAttempts, setPushAttempts] = useState<PushAttemptRow[]>([]);
  const [sheet, setSheet] = useState<CatalogSheet | null>(null);
  const [categories, setCategories] = useState<HubCategoryOption[]>([]);
  const erpId = params.id;

  useEffect(() => {
    void (async () => {
      setLoadState('loading');
      try {
        const [json, push, sheetPayload, categoryPayload] = await Promise.all([
          apiFetch<ProductDetailPayload>(`/api/dashboard/products/${encodeURIComponent(erpId)}`),
          apiFetch<{ attempts: PushAttemptRow[] }>('/api/dashboard/push-attempts').catch(() => ({ attempts: [] })),
          apiFetch<CatalogSheet>(`/api/catalog/products/${encodeURIComponent(erpId)}/sheet`).catch(() => null),
          apiFetch<{ categories: HubCategoryOption[] }>('/api/catalog/categories').catch(() => ({ categories: [] })),
        ]);
        setDetail(json);
        setSheet(sheetPayload);
        setCategories(categoryPayload.categories);
        setPushAttempts(push.attempts.filter((a) => a.productName === json.product.name));
        setLiveFromDb(true);
        setLoadState('ok');
      } catch (err) {
        setLiveFromDb(false);
        setLoadState(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error');
      }
    })();
  }, [erpId]);

  if (loadState !== 'ok' || !detail) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o Catálogo de Produtos
        </Link>
        <div
          role={loadState === 'loading' ? 'status' : 'alert'}
          className={`mt-6 rounded-xl border p-6 text-sm ${
            loadState === 'loading'
              ? 'border-border-color bg-bg-surface/60 text-text-muted'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {loadState === 'loading' && 'Carregando ficha do produto...'}
          {loadState === 'notfound' && `Produto Bling #${erpId} não encontrado no catálogo do HUB. Execute uma sincronização ou confira o ID.`}
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
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o Catálogo de Produtos
        </Link>
      </div>

      {/* Cabeçalho da Ficha Única */}
      <header className="flex flex-col justify-between gap-4 rounded-xl border border-border-color bg-bg-surface/60 p-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-300">
              Bling ID #{prod?.erp_id ?? erpId}
            </span>
            {isBlankSku(prod?.erp_sku) ? (
              <EmptySkuNotice />
            ) : (
              <span className="rounded-md border border-border-color bg-bg-surface px-2.5 py-0.5 font-mono text-xs text-text-primary">
                SKU: {prod?.erp_sku}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {liveFromDb
                ? 'Dados reais lidos do PostgreSQL 16'
                : 'Fonte Soberana: Bling ERP v3'}
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold text-text-primary">
            {prod.name ?? `Produto Bling #${prod.erp_id}`}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            Ficha Única comparando Bling, Mercado Livre e Nuvemshop. Explica por que cada valor foi escolhido antes de qualquer escrita.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={buildBlingProductUrl(prod?.erp_id ?? erpId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-3.5 py-2 text-xs font-medium text-text-primary hover:bg-bg-base"
          >
            <span>Abrir no Bling</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {isBlankSku(prod?.erp_sku) ? (
            <span
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200"
              title="Produto sem SKU não entra na lista de envio"
            >
              <Send className="h-3.5 w-3.5" />
              Não entra na lista de envio
            </span>
          ) : (
            <Link
              href="/publicacoes"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-text-primary hover:bg-emerald-500"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Simular sincronização</span>
            </Link>
          )}
        </div>
      </header>

      {/* Navegação das 7 Abas */}
      <div className="mt-6 flex flex-wrap gap-1.5 border-b border-border-color pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border border-transparent bg-bg-surface/60 text-text-muted hover:bg-bg-surface hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da Aba Selecionada */}
      <section className="mt-6">
        {activeTab === 'geral' && (
          <div className="space-y-6">
            <div className={`grid gap-4 ${MERCADO_LIVRE_ACTIVE ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <div className="rounded-xl border border-emerald-500/30 bg-bg-surface/60 p-5">
                <span className="text-xs font-semibold uppercase text-emerald-400">
                  Bling ERP v3 (Soberano)
                </span>
                <p className="mt-2 text-2xl font-bold text-text-primary">
                  Nota {mainReadiness?.score_bling ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-text-muted">
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

              {MERCADO_LIVRE_ACTIVE && (
              <div className="rounded-xl border border-amber-500/30 bg-bg-surface/60 p-5">
                <span className="text-xs font-semibold uppercase text-amber-400">
                  Mercado Livre (JHS SHOPPING)
                </span>
                <p className="mt-2 text-2xl font-bold text-amber-300">
                  Nota {mainReadiness?.score_ml ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {mainReadiness?.publishable_ml
                    ? 'Apto para publicar conteúdo no Mercado Livre.'
                    : 'Pendente de categoria verificada ou expansão de descrição técnica.'}
                </p>
              </div>
              )}

              <div className="rounded-xl border border-amber-500/30 bg-bg-surface/60 p-5">
                <span className="text-xs font-semibold uppercase text-amber-400">
                  Nuvemshop (Loja 6667412)
                </span>
                <p className="mt-2 text-2xl font-bold text-amber-300">
                  Nota {mainReadiness?.score_ns ?? '—'} / 100
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {mainReadiness?.publishable_ns
                    ? 'Apto para publicar conteúdo na Nuvemshop.'
                    : 'Pendente de enriquecimento de SEO (keywords, meta_description e seo_slug).'}
                </p>
              </div>
            </div>

            <section className="rounded-xl border border-border-color bg-bg-surface/50 p-5">
              <h2 className="text-sm font-bold text-text-primary">Prontidão para Canais</h2>
              <p className="mt-1 text-xs text-text-muted">Só entram os canais ativos. O Mercado Livre permanece desligado.</p>
              <div className="mt-4 space-y-4">
                {(sheet?.item.integrations ?? []).filter((channel) => MERCADO_LIVRE_ACTIVE || channel.platform !== 'mercadolivre').map((channel) => (
                  <div key={channel.platform}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{channel.platform === 'nuvemshop' ? 'Nuvemshop' : channel.platform}</span>
                      <span>{channel.percent}% pronto</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg-base">
                      <div className="h-full bg-emerald-600" style={{ width: `${channel.percent}%` }} />
                    </div>
                    {channel.blockers.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {channel.blockers.map((blocker) => (
                          <li key={blocker.code} className="text-xs text-rose-700 dark:text-rose-300">
                            {blocker.title}
                            {blocker.where === 'erp' ? (
                              <a href={buildBlingProductUrl(prod.erp_id)} target="_blank" rel="noreferrer" className="ml-2 font-semibold underline">Corrigir no ERP</a>
                            ) : (
                              <Link href={blocker.fixHref} className="ml-2 font-semibold underline">Resolver no HUB</Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {(sheet?.item.integrations ?? []).length === 0 && (
                  <p className="text-xs text-text-muted">A prontidão aparece depois da leitura do catálogo.</p>
                )}
              </div>
            </section>

            {mainReadiness?.blockers && mainReadiness.blockers.length > 0 && (
              <div className="rounded-xl border border-border-color bg-bg-surface/50 p-5">
                <h2 className="text-sm font-bold text-text-primary">
                  Requisitos Pendentes Explicados para o Operador
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {mainReadiness.blockers.map((b) => {
                    const tr = translateBlockerToPlainPortuguese(b);
                    return (
                      <div
                        key={b}
                        className="rounded-lg border border-border-color bg-bg-base p-3.5 text-xs"
                      >
                        <p className="font-semibold text-amber-300">{tr.title}</p>
                        <p className="mt-1 text-text-muted">
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

        {activeTab === 'geral' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <Database className="h-4 w-4 text-emerald-400" />
              <h2>Campos Protegidos (Grupo A — Soberania Absoluta do Bling)</h2>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Estes valores jamais são sobrescritos por dados vindos do Mercado Livre ou da Nuvemshop.
            </p>

            <p className="mt-1 text-xs text-text-muted">
              Nome do ERP, somente leitura: <strong className="text-text-primary">{prod.name ?? 'Sem nome'}</strong>
              {' '}· Marca: {prod.brand || sheet?.item.brand || 'Sem marca'}
            </p>
            <label className="mt-3 block text-xs text-text-muted">
              Categoria do catálogo
              <select
                value={sheet?.category?.id ?? ''}
                onChange={(event) => {
                  const hubCategoryId = event.target.value || null;
                  void apiFetch(`/api/catalog/products/${prod.id}/category`, {
                    method: 'PUT',
                    json: { hubCategoryId },
                  }).then(() => {
                    const selected = categories.find((category) => category.id === hubCategoryId) ?? null;
                    setSheet((current) => current ? { ...current, category: selected } : current);
                  });
                }}
                className="mt-1 rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              >
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            {sheet && (
              <ul className="mt-4 space-y-1 text-xs">
                {sheet.item.checklist.items.map((item) => (
                  <li key={item.code} className={item.ok ? 'text-emerald-300' : 'text-amber-200'}>
                    {item.title}
                    {!item.ok && (
                      <Link href={item.fixHref} className="ml-2 underline">Corrigir</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border-color bg-bg-base p-4">
                <span className="text-[11px] uppercase text-text-muted">Preço de Cadastro</span>
                <p className="mt-1 font-mono text-base font-bold text-text-primary">
                  {mainVar?.price ? `R$ ${mainVar.price}` : 'Sem preço'}
                </p>
                <span className="text-[11px] text-emerald-400">Origem: Bling v3</span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-4">
                <span className="text-[11px] uppercase text-text-muted">Preço de Custo</span>
                <p className="mt-1 font-mono text-base font-bold text-text-primary">
                  {mainVar?.cost_price ? `R$ ${mainVar.cost_price}` : 'Custo ausente'}
                </p>
                <span className="text-[11px] text-text-muted">Nunca presumido como zero</span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-4">
                <span className="text-[11px] uppercase text-text-muted">Estoque Publicável (Seller)</span>
                <p className="mt-1 font-mono text-base font-bold text-emerald-400">
                  {mainVar?.stock !== null && mainVar?.stock !== undefined
                    ? Math.floor(Number(mainVar.stock))
                      : 'Aguardando leitura'}{' '}
                  un.
                </p>
                <span className="text-[11px] text-text-muted">Soma apenas depósitos seller</span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-4">
                <span className="text-[11px] uppercase text-text-muted">Marca / Formato</span>
                <p className="mt-1 text-sm font-bold text-text-primary">
                  {prod?.brand || 'Sem marca'} · Formato {prod?.product_format ?? 'S'}
                </p>
                <span className="text-[11px] text-text-muted">Unidade: {prod?.unit ?? 'UN'}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'imagens' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <FileText className="h-4 w-4 text-sky-400" />
              <h2>Comparação de Conteúdo por Fonte (Bling vs Marketplaces)</h2>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Nome e descrição do Bling permanecem intocáveis; títulos e descrições específicos por canal ficam em <code className="text-text-muted">channel_content_overrides</code>.
            </p>

            <div className="mt-4 overflow-x-auto">
              {(sheet?.images.length ?? 0) === 0 && (
                <p className="mb-3 text-xs text-text-muted">Nenhuma imagem elegível no banco.</p>
              )}
              <ul className="mb-4 space-y-1 text-xs text-text-muted">
                {sheet?.images.map((image) => (
                  <li key={image.url_normalized}>
                    {image.is_cover_eligible ? 'Capa' : 'Imagem'} · ML {image.position_ml ?? '—'} · NS {image.position_ns ?? '—'} · {image.rights_status}
                  </li>
                ))}
              </ul>
              <form
                className="mb-4 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const url = String(new FormData(form).get('url') ?? '').trim();
                  if (!sheet || url.length < 8) return;
                  void apiFetch<{ checklist: CatalogSheet['item']['checklist'] }>(
                    `/api/catalog/products/${sheet.item.id}/cover`,
                    { method: 'POST', json: { url } }
                  ).then((result) => {
                    setSheet((current) => current ? {
                      ...current,
                      images: [
                        { url_normalized: url, is_cover_eligible: true, rights_status: 'owned', position_ml: null, position_ns: null },
                        ...current.images.filter((image) => image.url_normalized !== url),
                      ],
                      item: { ...current.item, checklist: result.checklist },
                    } : current);
                    form.reset();
                  });
                }}
              >
                <label className="text-[11px] text-text-muted">
                  URL da capa
                  <input name="url" className="mt-1 block w-72 rounded border border-border-color bg-bg-base px-2 py-1 text-xs text-text-primary" />
                </label>
                <button type="submit" className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-text-primary">
                  Salvar capa
                </button>
              </form>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border-color text-[11px] uppercase text-text-muted">
                  <tr>
                    <th className="py-2.5 pr-4">Campo</th>
                    <th className="py-2.5 px-4">Valor no Bling ERP</th>
                    <th className="py-2.5 pl-4">Regra Aplicada pelo HUB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-color">
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-text-primary">Título Mestre</td>
                    <td className="py-3 px-4 text-text-primary">{prod?.name}</td>
                    <td className="py-3 pl-4 text-emerald-400 font-medium">
                      KEEP — Protegido (nunca recebe texto de marketplace)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-text-primary">Peso Líquido / Bruto</td>
                    <td className="py-3 px-4 font-mono text-text-primary">
                      {mainVar?.net_weight ?? '—'} kg / {mainVar?.gross_weight ?? '—'} kg
                    </td>
                    <td className="py-3 pl-4 text-text-muted">
                      Peso — só enriquece se o Bling estiver vazio ou com valor sentinela
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-semibold text-text-primary">Dimensões (L × A × P)</td>
                    <td className="py-3 px-4 font-mono text-text-primary">
                      {mainVar?.width ?? '—'} × {mainVar?.height ?? '—'} × {mainVar?.depth ?? '—'} cm
                    </td>
                    <td className="py-3 pl-4 text-text-muted">
                      Enviadas no passo isolado <code>measures</code> na Nuvemshop (sem preço/estoque)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'variacoes' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <Layers className="h-4 w-4 text-emerald-400" />
              <h2>Variações e Saldos por Depósito (`variant_stock_balances`)</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
              {(detail?.stockBalances ?? []).map((bal) => (
                <div
                  key={`${bal.variant_id}-${bal.bling_warehouse_id}`}
                  className="rounded-lg border border-border-color bg-bg-base p-3.5"
                >
                  <span className="font-mono font-bold text-emerald-400">
                    Depósito #{bal.bling_warehouse_id}
                  </span>
                  <p className="mt-1 text-text-primary">
                    Saldo Físico: <strong>{Math.floor(Number(bal.saldo_fisico))}</strong> · Saldo Virtual:{' '}
                    <strong>{Math.floor(Number(bal.saldo_virtual))}</strong>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'atributos' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6 text-sm text-text-primary">
            <h2 className="font-bold text-text-primary">Atributos usados no mapeamento</h2>
            <p className="mt-2 text-xs text-text-muted">
              Marca: {prod.brand || 'sem marca'}. Os mapas por categoria ficam em Atributos.
            </p>
            <Link href="/atributos" className="mt-3 inline-block text-xs font-semibold text-emerald-300 underline">
              Abrir mapas da categoria
            </Link>
          </div>
        )}

        {activeTab === 'fiscal' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <Lock className="h-4 w-4 text-amber-400" />
              <h2>Conformidade Fiscal (EAN, NCM, CEST e Origem)</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-border-color bg-bg-base p-3.5">
                <span className="text-text-muted">EAN / GTIN</span>
                <p className="mt-1 font-mono font-bold text-emerald-400">
                  {mainVar?.ean || 'Ausente'}
                </p>
                <span className="text-[11px] text-text-muted">
                  Situação: {mainVar?.ean_status ?? 'sem variante'}
                </span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-3.5">
                <span className="text-text-muted">NCM (master_products)</span>
                <p className="mt-1 font-mono font-bold text-text-primary">
                  {prod?.ncm || 'Ausente'}
                </p>
                <span className="text-[11px] text-emerald-400">
                  Situação: {prod.ncm_status}
                </span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-3.5">
                <span className="text-text-muted">CEST (Espelho Bling)</span>
                <p className="mt-1 font-mono font-bold text-text-primary">
                  {prod?.cest || 'Não informado'}
                </p>
                <span className="text-[11px] text-text-muted">Informativo (não bloqueia push)</span>
              </div>
              <div className="rounded-lg border border-border-color bg-bg-base p-3.5">
                <span className="text-text-muted">Origem Fiscal</span>
                <p className="mt-1 font-bold text-text-primary">
                  {prod.tax_origin === null ? 'Não informada' : prod.tax_origin === 0 ? '0 — Nacional' : `${prod.tax_origin} — ver tabela de origem`}
                </p>
                <span className="text-[11px] text-text-muted">Emitido na NF-e pelo Bling</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'canais' && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6">
            <h2 className="text-sm font-bold text-text-primary">
              Estado de publicação por passo
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Enquanto <code className="text-text-muted">stock_price = bling_native</code>, passos de estoque e preço permanecem sob controle nativo do Bling.
            </p>
            <ul className="mt-3 space-y-1 text-xs text-text-muted">
              {(sheet?.storePrices.length ?? 0) === 0 && <li>Nenhum preço de loja lido para a variante padrão.</li>}
              {sheet?.storePrices.map((price) => (
                <li key={price.platform}>
                  {price.platform === 'mercadolivre' ? 'Mercado Livre' : 'Nuvemshop'}: loja {price.store_price ?? '—'} · promo {price.store_promotional_price ?? '—'}
                </li>
              ))}
            </ul>
            {pushAttempts.length === 0 ? (
              <div className="mt-4 flex items-center gap-3 text-xs text-text-muted">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Nenhuma tentativa de publicação registrada para este produto (modo shadow).</span>
              </div>
            ) : (
              <ul className="mt-4 space-y-2 text-xs">
                {pushAttempts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-border-color bg-bg-base p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text-primary">{a.channel} · {a.operationType}</span>
                      <span className="rounded-full border border-border-color px-2 py-0.5 text-text-primary">{a.state}</span>
                      <span className="text-text-muted">{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
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

        {activeTab === 'canais' && detail.qualityHistory.length > 0 && (
          <div className="rounded-xl border border-border-color bg-bg-surface/50 p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <History className="h-4 w-4 text-text-muted" />
              <h2>Histórico Auditado de Alterações</h2>
            </div>
            <div className="mt-3 space-y-2 text-xs text-text-muted">
              <div className="rounded-lg border border-border-color bg-bg-base p-3">
                <strong>
                  {prod.last_bling_sync
                    ? new Date(prod.last_bling_sync).toLocaleString('pt-BR')
                    : 'Sem leitura registrada'}
                </strong>{' '}
                · Última leitura do cadastro no Bling v3 · Origem: <code className="text-text-primary">system</code>
              </div>
              {detail.qualityHistory.length === 0 ? (
                <p className="text-text-muted">Nenhuma alteração de conteúdo proposta ou aplicada pelo motor de qualidade.</p>
              ) : (
                detail.qualityHistory.map((h, idx) => (
                  <div key={`${h.field_name}-${idx}`} className="rounded-lg border border-border-color bg-bg-base p-3">
                    <strong>{new Date(h.created_at).toLocaleString('pt-BR')}</strong> · Campo <code>{h.field_name}</code> · Decisão{' '}
                    <strong>{h.decision}</strong> ({h.mode === 'shadow' ? 'simulação, não aplicada' : h.applied ? 'aplicada' : 'não aplicada'})
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <span className="text-text-muted">Anterior: {h.old_value ?? '(vazio)'}</span>
                      <span className="text-emerald-300">Proposto: {h.new_value ?? '(vazio)'}</span>
                    </div>
                    <span className="text-text-muted">Origem: {h.source}</span>
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

export default function Page(props: { params: { id: string } }) {
  return (
    <React.Suspense fallback={<main className="px-6 py-8 text-sm text-text-muted">Carregando ficha...</main>}>
      <FichaUnicaProdutoPage {...props} />
    </React.Suspense>
  );
}
