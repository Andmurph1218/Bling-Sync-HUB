'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Archive, Copy, PackageOpen, Pencil, Plus, Search, Warehouse } from 'lucide-react';
import { ApiError, apiFetch, API_BASE_URL } from '../utils/api-client';
import { EmptySkuNotice, isBlankSku } from './empty-sku-notice';
import { Toaster, ToastMessage } from './toaster';

type CatalogTab = 'todos' | 'publicados' | 'completude' | 'rejeitados' | 'arquivados' | 'ready';
type TopView = 'produtos' | 'envio' | 'importacoes' | 'exportacoes';

interface ExistsProduct {
  id: string;
  blingId: string;
  sku: string;
  name: string | null;
  ean: string | null;
}

interface ImportLine {
  line: number;
  sku: string;
  status: 'sucesso' | 'erro';
  message: string;
}

interface ChecklistItem {
  code: string;
  ok: boolean;
  title: string;
  fixHref: string;
}

interface CatalogItem {
  id: string;
  blingId: string;
  sku: string;
  name: string | null;
  brand: string | null;
  typeLabel: string;
  stock: number | null;
  price: number | null;
  promotionalPrice: number | null;
  coverUrl: string | null;
  channels: Array<{ platform: 'mercadolivre' | 'nuvemshop'; state: 'published' | 'pending' | 'rejected' | 'absent' }>;
  checklist: { percent: number; ready: boolean; tone: 'green' | 'amber' | 'red'; items: ChecklistItem[] };
  archived: boolean;
}

interface CatalogPayload {
  items: CatalogItem[];
  total: number;
  counts: Record<CatalogTab, number>;
}

interface SendListItem {
  id: string;
  channel: string;
  status: string;
  error_message: string | null;
  sku: string;
  name: string | null;
  bling_id: string;
}

interface PublishPreview {
  published: false;
  payload: Record<string, unknown>;
  attributesComplete: boolean;
  missingAttributes: string[];
}

interface SimulationEntry {
  sku: string;
  payload: Record<string, unknown>;
  missingAttributes: string[];
  attributesComplete: boolean;
}

const QUEUE_STATUS: Record<string, string> = {
  pending: 'Aguardando',
  processing: 'Processando',
  success: 'Concluído',
  failed: 'Falhou',
};

function HighlightedJson({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const tokens = text.split(/("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <pre className="mt-3 overflow-auto rounded-lg bg-bg-surface p-3 font-mono text-[11px] leading-relaxed text-text-muted">
      {tokens.map((token, index) => {
        if (!token) return null;
        if (token.startsWith('"')) {
          const key = /^\s*:/.test(tokens[index + 1] ?? '');
          return (
            <span key={index} className={key ? 'text-sky-300' : 'text-emerald-300'}>
              {token}
            </span>
          );
        }
        if (token === 'true' || token === 'false' || token === 'null') {
          return (
            <span key={index} className="text-violet-300">
              {token}
            </span>
          );
        }
        if (/^-?\d/.test(token)) {
          return (
            <span key={index} className="text-amber-300">
              {token}
            </span>
          );
        }
        return <span key={index}>{token}</span>;
      })}
    </pre>
  );
}

interface VariantRow {
  id: string;
  sku: string;
  price: string | null;
  stock: number | null;
  ean: string | null;
}

const TABS: Array<{ id: CatalogTab; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'publicados', label: 'Publicados' },
  { id: 'completude', label: 'Completude' },
  { id: 'rejeitados', label: 'Rejeitados' },
  { id: 'arquivados', label: 'Arquivados' },
];

const GAP_LABEL: Record<string, string> = {
  sku: 'sem SKU',
  cover: 'sem imagem',
  hub_category: 'sem categoria',
  channel_category: 'sem categoria no canal',
  attributes: 'com atributos pendentes',
  ean: 'sem EAN',
  ncm: 'sem NCM válido',
  price: 'sem preço',
  duplicate: 'com possível duplicata',
  stock: 'sem leitura de estoque',
};

const CHANNEL_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
};

const STATE_LABEL: Record<string, string> = {
  published: 'publicado',
  pending: 'aguardando',
  rejected: 'rejeitado',
  absent: 'não está no canal',
};

function money(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SHORT_REASON: Record<string, string> = {
  'Falta imagem de capa elegível': 'Falta imagem',
  'Sem categoria': 'Sem categoria',
  'Categoria do canal ainda não está verde': 'Sem categoria no canal',
  'Atributos obrigatórios do canal ainda não resolvidos': 'Atributos pendentes',
  'Código de barras ausente ou inválido para este canal': 'EAN ausente ou inválido',
  'NCM ausente ou inválido': 'NCM ausente ou inválido',
  'NCM em conflito entre variações': 'NCM em conflito',
  'Preço ausente ou zero': 'Sem preço',
  'Sem SKU — não sincroniza': 'Sem SKU',
  'Possível duplicata por SKU ou EAN — vincule em vez de criar': 'Possível duplicata',
  'Produto não encontrado.': 'Produto não encontrado',
  'Checklist incompleto.': 'Cadastro incompleto',
};

function checklistReasons(reason: string): string[] {
  const parts = reason
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => SHORT_REASON[part] ?? part);
  return parts.length > 0 ? parts : ['Cadastro incompleto'];
}

function toneClass(tone: CatalogItem['checklist']['tone']): string {
  if (tone === 'green') return 'text-emerald-300';
  if (tone === 'amber') return 'text-amber-300';
  return 'text-rose-300';
}

function channelClass(state: string): string {
  if (state === 'published') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (state === 'rejected') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  if (state === 'pending') return 'border-border-color bg-bg-surface text-text-muted';
  return 'border-border-color bg-transparent text-text-muted';
}

export function CatalogScreen({ lockedTab }: { lockedTab?: 'completude' }) {
  const search = useSearchParams();
  const initialTab = lockedTab ?? (search.get('status') === 'completude' ? 'completude' : search.get('status') === 'ready' ? 'ready' : 'todos');
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const [gap, setGap] = useState(search.get('pendencia') ?? '');
  const [view, setView] = useState<TopView>(search.get('aba') === 'envio' ? 'envio' : 'produtos');
  const initialSku = search.get('sku') ?? '';
  const [sku, setSku] = useState(initialSku);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [applied, setApplied] = useState({ sku: initialSku, name: '', brand: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState('arquivar');
  const [notice, setNotice] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [openVariants, setOpenVariants] = useState<Record<string, VariantRow[] | 'loading'>>({});
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupSku, setLookupSku] = useState('');
  const [lookupHit, setLookupHit] = useState<ExistsProduct | null | 'free'>(null);
  const [createName, setCreateName] = useState('');
  const [createPrice, setCreatePrice] = useState('');
  const [createStock, setCreateStock] = useState('');
  const [createImageUrl, setCreateImageUrl] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [createdBlingId, setCreatedBlingId] = useState<string | null>(null);
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const [draftFor, setDraftFor] = useState<CatalogItem | null>(null);
  const [draftSku, setDraftSku] = useState('');
  const [draftResult, setDraftResult] = useState<string | null>(null);
  const [sendItems, setSendItems] = useState<SendListItem[]>([]);
  const [simulation, setSimulation] = useState<{
    loading: boolean;
    error: string | null;
    entries: SimulationEntry[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: tab,
        sku: applied.sku,
        name: applied.name,
        brand: applied.brand,
        page: String(page),
        pageSize: '50',
        pendencia: gap,
      });
      const payload = await apiFetch<CatalogPayload>(`/api/catalog/products?${params.toString()}`);
      setData(payload);
      setError(null);
    } catch {
      setData(null);
      setError('Não foi possível ler o catálogo. Nenhum produto de exemplo é exibido.');
    } finally {
      setLoading(false);
    }
  }, [applied.brand, applied.name, applied.sku, gap, page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const nextGap = search.get('pendencia') ?? '';
    const nextStatus = search.get('status');
    setGap(nextGap);
    if (!lockedTab && (nextStatus === 'completude' || nextStatus === 'ready')) {
      setTab(nextStatus);
    }
    if (search.get('aba') === 'envio') setView('envio');
    const skuParam = search.get('sku');
    if (skuParam) {
      setSku(skuParam);
      setApplied((current) => ({ ...current, sku: skuParam }));
    }
  }, [lockedTab, search]);

  useEffect(() => {
    if (view !== 'envio') return;
    void loadSendList().catch(() => setNotice('Não foi possível ler a lista de envio.'));
    const timer = window.setInterval(() => {
      void loadSendList().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [view]);

  const toggleVariants = async (item: CatalogItem) => {
    if (openVariants[item.blingId]) {
      setOpenVariants((prev) => {
        const next = { ...prev };
        delete next[item.blingId];
        return next;
      });
      return;
    }
    setOpenVariants((prev) => ({ ...prev, [item.blingId]: 'loading' }));
    try {
      const payload = await apiFetch<{ variants: VariantRow[] }>(
        `/api/catalog/products/${encodeURIComponent(item.blingId)}/variants`
      );
      setOpenVariants((prev) => ({ ...prev, [item.blingId]: payload.variants }));
    } catch {
      setOpenVariants((prev) => ({ ...prev, [item.blingId]: [] }));
    }
  };

  const archiveIds = async (ids: string[], archived: boolean) => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const path = archived ? 'archive' : 'unarchive';
      await apiFetch(`/api/catalog/products/${ids[0]}/${path}`, { method: 'POST' });
    } else {
      await apiFetch('/api/catalog/products/archive-bulk', { method: 'POST', json: { ids } });
    }
    setSelected([]);
    setNotice(archived ? 'Produto arquivado no HUB. O ERP não foi alterado.' : 'Produto voltou para Todos. O ERP não foi alterado.');
    await load();
  };

  const loadSendList = async () => {
    const payload = await apiFetch<{ items: SendListItem[] }>('/api/catalog/publish-queue');
    setSendItems(payload.items);
  };

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToSendList = async (ids: string[]) => {
    if (ids.length === 0) {
      setNotice('Selecione ao menos um produto.');
      return;
    }
    const result = await apiFetch<{ queued: string[]; skipped: Array<{ id: string; sku: string; reason: string }> }>(
      '/api/catalog/products/send-list',
      { method: 'POST', json: { ids, channel: 'mercadolivre' } }
    );
    const catalogItems = data?.items ?? [];
    setNotice(null);
    setSelected([]);
    for (const item of result.skipped) {
      const local = catalogItems.find((product) => product.id === item.id);
      const skuLabel = local && !isBlankSku(local.sku) ? local.sku : !isBlankSku(item.sku) ? item.sku : 'sem SKU';
      const nameLabel = local?.name?.trim() || 'Sem nome';
      pushToast({
        variant: 'warning',
        title: `Produto ${skuLabel} - ${nameLabel} não foi adicionado`,
        reasons: checklistReasons(item.reason),
        action: local
          ? { label: 'Corrigir Cadastro', href: `/catalogo/${local.blingId}?aba=geral` }
          : undefined,
      });
    }
    if (result.queued.length > 0) {
      pushToast({
        variant: 'success',
        title:
          result.queued.length === 1
            ? 'Produto adicionado à lista de envio'
            : `${result.queued.length} produtos adicionados à lista de envio`,
      });
      if (result.skipped.length === 0) setView('envio');
      await loadSendList();
    }
  };

  const recalculateSelected = async (ids: string[]) => {
    if (ids.length === 0) {
      setNotice('Selecione ao menos um produto.');
      return;
    }
    const result = await apiFetch<{ items: Array<{ id: string; percent: number }> }>(
      '/api/catalog/products/recalculate-completeness',
      { method: 'POST', json: { ids } }
    );
    setNotice(`Completude recalculada para ${result.items.length} produto(s).`);
    await load();
  };

  const simulateIds = async (ids: string[]) => {
    const items = (data?.items ?? []).filter((item) => ids.includes(item.id));
    setSimulation({ loading: true, error: null, entries: [] });
    try {
      const entries: SimulationEntry[] = [];
      for (const item of items) {
        const body = await apiFetch<PublishPreview>(`/api/catalog/${item.id}/simulate`, { method: 'POST' });
        entries.push({
          sku: item.sku || item.blingId,
          payload: body.payload,
          missingAttributes: body.missingAttributes,
          attributesComplete: body.attributesComplete,
        });
      }
      setSimulation({ loading: false, error: null, entries });
    } catch {
      setSimulation({ loading: false, error: 'Não foi possível montar o JSON do anúncio.', entries: [] });
    }
  };

  const pageIds = data?.items.map((item) => item.id) ?? [];
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const counts = data?.counts;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{lockedTab ? 'Completude' : 'Catálogo'}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Um produto do ERP, um SKU no HUB. Arquivar não apaga o cadastro no Bling.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLookupOpen(true);
              setLookupHit(null);
              setLookupSku('');
              setCreateError(null);
              setConfirmCreate(false);
              setStockNotice(null);
              setCreatedBlingId(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-text-primary hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Produto
          </button>
          <button
            type="button"
            onClick={() => {
              void fetch(`${API_BASE_URL}/api/catalog/export`, { credentials: 'include' }).then(async (response) => {
                if (!response.ok) {
                  setNotice('Não foi possível exportar o catálogo.');
                  return;
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'catalogo.xlsx';
                link.click();
                URL.revokeObjectURL(url);
              });
            }}
            className="rounded-lg border border-border-color px-3 py-2 text-xs font-semibold text-text-primary"
          >
            Exportar
          </button>
        </div>
      </header>

      {notice && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100" role="status">
          {notice}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border-color bg-bg-surface/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Filtros</h2>
            <label className="mt-3 block text-[11px] text-text-muted">
              SKU
              <input
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
            </label>
            <label className="mt-2 block text-[11px] text-text-muted">
              Nome
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
            </label>
            <button type="button" onClick={() => setShowMore((prev) => !prev)} className="mt-2 text-[11px] text-text-muted underline">
              {showMore ? 'Ver menos' : 'Ver mais'}
            </button>
            {showMore && (
              <label className="mt-2 block text-[11px] text-text-muted">
                Marca
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                />
              </label>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  setApplied({ sku, name, brand });
                }}
                className="rounded-lg bg-text-primary px-2.5 py-1.5 text-[11px] font-semibold text-bg-base"
              >
                Filtrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setSku('');
                  setName('');
                  setBrand('');
                  setApplied({ sku: '', name: '', brand: '' });
                  setPage(1);
                }}
                className="rounded-lg border border-border-color px-2.5 py-1.5 text-[11px] text-text-primary"
              >
                Limpar
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-border-color bg-bg-surface/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Ações em lote</h2>
            <select
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value)}
              className="mt-3 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
            >
              <option value="arquivar">Arquivar</option>
              <option value="envio">Adicionar à Lista de Envio</option>
              <option value="completude">Recalcular Completude</option>
            </select>
            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-border-color px-2.5 py-1.5 text-[11px] font-semibold text-text-primary"
              onClick={() => {
                if (bulkAction === 'arquivar') {
                  void archiveIds(selected, true).catch(() => setNotice('Não foi possível arquivar a seleção.'));
                  return;
                }
                if (bulkAction === 'envio') {
                  void addToSendList(selected).catch(() => setNotice('Não foi possível adicionar à lista de envio.'));
                  return;
                }
                void recalculateSelected(selected).catch(() => setNotice('Não foi possível recalcular a completude.'));
              }}
            >
              Executar
            </button>
          </section>

          <section className="rounded-xl border border-border-color bg-bg-surface/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Importação</h2>
            <p className="mt-2 text-[11px] text-text-muted">
              A planilha atualiza a imagem e campos de canal ainda vazios. Nome, descrição, categoria, preço e estoque ficam com o Bling.
            </p>
          </section>
        </aside>

        <section>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['produtos', 'Lista de produtos'],
                ['envio', 'Lista de envio'],
                ['importacoes', 'Importações'],
                ['exportacoes', 'Exportações'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setView(id);
                  if (id === 'envio') void loadSendList().catch(() => setNotice('Não foi possível ler a lista de envio.'));
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  view === id
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-border-color text-text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'envio' && (
            <div className="mt-4" role="status">
              {sendItems.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-color bg-bg-surface/40 px-6 py-16 text-center">
                  <PackageOpen className="h-10 w-10 text-text-muted" aria-hidden="true" />
                  <p className="mt-3 max-w-sm text-sm text-text-muted">
                    Sua fila está vazia. Selecione produtos no Catálogo para enviá-los aos marketplaces.
                  </p>
                </div>
              )}
              {sendItems.length > 0 && (
                <ul className="space-y-2">
                  {sendItems.map((item) => {
                    const reasons = item.error_message ? checklistReasons(item.error_message) : [];
                    const skuLabel = isBlankSku(item.sku) ? 'SKU não informado' : item.sku;
                    if (item.status === 'failed') {
                      return (
                        <li key={item.id} className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-amber-950">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              <div>
                                <p className="text-sm font-semibold">{item.name?.trim() || 'Sem nome'}</p>
                                <p className="text-xs">SKU {skuLabel}</p>
                                <p className="mt-1 text-[11px] text-amber-800">
                                  {item.channel === 'mercadolivre' ? 'Mercado Livre' : item.channel} · {QUEUE_STATUS[item.status] ?? item.status}
                                </p>
                                {reasons.length > 0 && (
                                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                                    {reasons.map((reason, index) => (
                                      <li key={`${reason}-${index}`}>{reason}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                            {item.bling_id && (
                              <Link
                                href={`/catalogo/${item.bling_id}?aba=geral`}
                                className="rounded-lg bg-amber-950 px-2.5 py-1.5 text-[11px] font-semibold text-amber-50"
                              >
                                Corrigir Pendências
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-color bg-bg-surface/50 px-4 py-3 text-xs text-text-muted">
                        <span className="font-semibold text-text-primary">{item.name?.trim() || 'Sem nome'}</span>
                        <span>SKU {skuLabel}</span>
                        <span>{item.channel === 'mercadolivre' ? 'Mercado Livre' : item.channel}</span>
                        <span>{QUEUE_STATUS[item.status] ?? item.status}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {view === 'importacoes' && (
            <div className="mt-4 rounded-xl border border-border-color bg-bg-surface/50 p-6 text-sm text-text-muted">
              <p>Envie uma planilha .xlsx. Só entram a URL da imagem e textos de canal ainda vazios. Nome, descrição e categoria do Bling são ignorados.</p>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mt-3 block text-xs"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void fetch(`${API_BASE_URL}/api/catalog/import`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                    body: file,
                  })
                    .then(async (response) => {
                      const payload = (await response.json()) as { lines?: ImportLine[] };
                      if (!response.ok || !payload.lines) {
                        setNotice('Não foi possível ler a planilha.');
                        return;
                      }
                      setImportLines(payload.lines);
                      setView('importacoes');
                    })
                    .catch(() => setNotice('Não foi possível ler a planilha.'));
                }}
              />
              <ul className="mt-4 space-y-1 text-xs">
                {importLines.map((line) => (
                  <li key={`${line.line}-${line.sku}`} className={line.status === 'erro' ? 'text-rose-200' : 'text-emerald-200'}>
                    {line.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view === 'exportacoes' && (
            <div className="mt-4 rounded-xl border border-border-color bg-bg-surface/50 p-6 text-sm text-text-muted" role="status">
              Use o botão Exportar no topo. O arquivo traz SKU, nome, categoria, completude, preço, estoque e canais vinculados.
            </div>
          )}

          {view === 'produtos' && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {(lockedTab ? TABS.filter((item) => item.id === 'completude') : TABS).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setTab(item.id);
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      tab === item.id
                        ? 'border-sky-500/40 bg-sky-500/15 text-sky-100'
                        : 'border-border-color text-text-muted'
                    }`}
                  >
                    {item.label} {counts ? counts[item.id] : '…'}
                  </button>
                ))}
                {!lockedTab && tab === 'ready' && (
                  <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
                    Prontos {counts ? counts.ready : '…'}
                  </span>
                )}
              </div>
              {gap && (
                <p className="mt-3 text-xs text-amber-200">
                  Filtro de pendência: {GAP_LABEL[gap] ?? gap}.{' '}
                  <button type="button" className="underline" onClick={() => { setGap(''); setPage(1); }}>
                    Limpar filtro
                  </button>
                </p>
              )}

              <div className="mt-4 overflow-hidden rounded-xl border border-border-color">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg-surface text-[11px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={(event) => {
                            setSelected((prev) =>
                              event.target.checked
                                ? Array.from(new Set([...prev, ...pageIds]))
                                : prev.filter((id) => !pageIds.includes(id))
                            );
                          }}
                          aria-label="Selecionar os produtos desta página"
                        />
                      </th>
                      <th className="px-3 py-3">Imagem</th>
                      <th className="px-3 py-3">Nome</th>
                      <th className="px-3 py-3">Tipo</th>
                      <th className="px-3 py-3">SKU</th>
                      <th className="px-3 py-3">Estoque</th>
                      <th className="px-3 py-3">Preço</th>
                      <th className="px-3 py-3">Promo</th>
                      <th className="px-3 py-3">Canais</th>
                      <th className="px-3 py-3">Completude</th>
                      <th className="px-3 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-color bg-bg-base/40">
                    {loading && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-text-muted">Lendo o catálogo...</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-rose-200" role="alert">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && data && data.items.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-text-muted">Nenhum produto nesta lista.</td>
                      </tr>
                    )}
                    {data?.items.map((item) => (
                      <React.Fragment key={item.id}>
                        <tr>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selected.includes(item.id)}
                              onChange={(event) =>
                                setSelected((prev) =>
                                  event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                                )
                              }
                              aria-label={`Selecionar ${item.sku || item.blingId}`}
                            />
                          </td>
                          <td className="px-3 py-3">
                            {item.coverUrl ? (
                              <img src={item.coverUrl} alt="" className="h-10 w-10 rounded object-cover" />
                            ) : (
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-bg-surface text-[10px] text-text-muted">sem</span>
                            )}
                            <button type="button" onClick={() => void toggleVariants(item)} className="mt-1 block text-[10px] text-sky-300">
                              Variações
                            </button>
                          </td>
                          <td className="px-3 py-3 text-text-primary">{item.name || 'Sem nome no ERP'}</td>
                          <td className="px-3 py-3 text-text-muted">{item.typeLabel}</td>
                          <td className="px-3 py-3">
                            {isBlankSku(item.sku) ? <EmptySkuNotice /> : <span className="font-mono text-emerald-300">{item.sku}</span>}
                          </td>
                          <td className="px-3 py-3">{item.stock === null ? '—' : item.stock}</td>
                          <td className="px-3 py-3">{money(item.price)}</td>
                          <td className="px-3 py-3">{item.promotionalPrice === null ? '—' : money(item.promotionalPrice)}</td>
                          <td className="px-3 py-3">
                            <div className="flex gap-1">
                              {item.channels
                                .filter((channel) => channel.state !== 'absent')
                                .map((channel) => (
                                  <span
                                    key={channel.platform}
                                    title={`${CHANNEL_LABEL[channel.platform]} — ${STATE_LABEL[channel.state]}`}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${channelClass(channel.state)}`}
                                  >
                                    {channel.platform === 'mercadolivre' ? 'ML' : 'NS'}
                                  </span>
                                ))}
                            </div>
                          </td>
                          <td className={`px-3 py-3 font-semibold ${toneClass(item.checklist.tone)}`} title={item.checklist.items.filter((row) => !row.ok).map((row) => row.title).join(' · ')}>
                            {item.checklist.percent}%
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex gap-1">
                              <Link href={`/catalogo/${item.blingId}?aba=geral`} title="Editar" className="rounded border border-border-color p-1 text-text-primary">
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              <button type="button" title="Duplicar não cria SKU no ERP" onClick={() => { setDraftFor(item); setDraftSku(''); setDraftResult(null); }} className="rounded border border-border-color p-1 text-text-primary">
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <Link href={`/catalogo/${item.blingId}?aba=variacoes`} title="Depósitos lidos do ERP" className="rounded border border-border-color p-1 text-text-primary">
                                <Warehouse className="h-3.5 w-3.5" />
                              </Link>
                              <button
                                type="button"
                                title={item.archived ? 'Desarquivar' : 'Arquivar'}
                                onClick={() => void archiveIds([item.id], !item.archived).catch(() => setNotice('Não foi possível alterar o arquivamento.'))}
                                className="rounded border border-border-color p-1 text-text-primary"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded border border-sky-700 px-1.5 py-1 text-[10px] font-semibold text-sky-200"
                                onClick={() => void simulateIds([item.id])}
                              >
                                Simular envio
                              </button>
                            </div>
                          </td>
                        </tr>
                        {openVariants[item.blingId] && (
                          <tr>
                            <td colSpan={11} className="bg-bg-surface/70 px-6 py-3 text-[11px] text-text-muted">
                              {openVariants[item.blingId] === 'loading' && 'Lendo variações...'}
                              {Array.isArray(openVariants[item.blingId]) && (openVariants[item.blingId] as VariantRow[]).length === 0 && 'Nenhuma variação no banco.'}
                              {Array.isArray(openVariants[item.blingId]) &&
                                (openVariants[item.blingId] as VariantRow[]).map((variant) => (
                                  <div key={variant.id} className="flex gap-4 py-1">
                                    <span className="font-mono">{isBlankSku(variant.sku) ? 'Sem SKU' : variant.sku}</span>
                                    <span>Estoque {variant.stock === null ? '—' : variant.stock}</span>
                                    <span>Preço {variant.price ?? '—'}</span>
                                    <span>EAN {variant.ean || '—'}</span>
                                  </div>
                                ))}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {data && (
                <p className="mt-2 flex items-center gap-3 text-[11px] text-text-muted">
                  <span>{data.total} produto(s) neste filtro.</span>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="underline disabled:opacity-40">
                    Anterior
                  </button>
                  <span>Página {page}</span>
                  <button
                    type="button"
                    disabled={page * 50 >= data.total}
                    onClick={() => setPage((current) => current + 1)}
                    className="underline disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {simulation && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="simulate-title">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-border-color bg-bg-base p-5">
            <h2 id="simulate-title" className="text-sm font-bold text-text-primary">Simulação de envio — Mercado Livre</h2>
            <p className="mt-1 text-xs text-text-muted">Nada foi publicado no marketplace.</p>
            {simulation.loading && <p className="mt-4 text-sm text-text-muted">Montando o JSON...</p>}
            {simulation.error && <p className="mt-4 text-sm text-rose-200" role="alert">{simulation.error}</p>}
            {simulation.entries.map((entry) => (
              <section key={entry.sku} className="mt-4">
                <h3 className="text-xs font-semibold text-text-primary">SKU {entry.sku}</h3>
                {!entry.attributesComplete && (
                  <p className="mt-1 text-xs text-amber-200">
                    Atributos incompletos{entry.missingAttributes.length ? `: ${entry.missingAttributes.join(', ')}` : ''}.
                  </p>
                )}
                <HighlightedJson value={entry.payload} />
              </section>
            ))}
            <button type="button" className="mt-4 rounded-lg border border-border-color px-3 py-1.5 text-xs text-text-primary" onClick={() => setSimulation(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismissToast} />

      {selected.length > 0 && view === 'produtos' && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border-color bg-bg-base px-4 py-2 text-xs text-text-primary shadow-2xl">
          <span>{selected.length} selecionado(s)</span>
          <button type="button" className="rounded-full border border-sky-500 px-3 py-1 font-semibold text-sky-200" onClick={() => void simulateIds(selected)}>
            Simular
          </button>
          <button type="button" className="rounded-full bg-emerald-600 px-3 py-1 font-semibold" onClick={() => void addToSendList(selected).catch(() => setNotice('Não foi possível adicionar à lista de envio.'))}>
            Adicionar à Lista de Envio
          </button>
          <button type="button" className="rounded-full border border-border-color px-3 py-1" onClick={() => void recalculateSelected(selected).catch(() => setNotice('Não foi possível recalcular a completude.'))}>
            Recalcular Completude
          </button>
          <button type="button" className="text-text-muted underline" onClick={() => setSelected([])}>
            Limpar
          </button>
        </div>
      )}

      {lookupOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border-color bg-bg-base p-5">
            <h2 className="text-sm font-bold text-text-primary">Buscar SKU ou EAN antes de criar</h2>
            <p className="mt-1 text-xs text-text-muted">Se o produto já existe, a criação fica bloqueada.</p>
            <div className="mt-3 flex gap-2">
              <Search className="mt-2 h-4 w-4 text-text-muted" />
              <input
                value={lookupSku}
                onChange={(event) => setLookupSku(event.target.value)}
                placeholder="SKU ou EAN"
                className="w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-text-primary"
              onClick={() => {
                const term = lookupSku.trim();
                if (!term) return;
                void apiFetch<{ exists: boolean; product?: ExistsProduct }>(
                  `/api/catalog/check-exists?term=${encodeURIComponent(term)}`
                ).then((result) => {
                  setLookupHit(result.exists && result.product ? result.product : 'free');
                }).catch(() => setNotice('Não foi possível consultar o SKU.'));
              }}
            >
              Buscar
            </button>
            {lookupHit && lookupHit !== 'free' && (
              <div className="mt-3 space-y-2 text-xs text-amber-100">
                <p>Já existe: {lookupHit.name ?? lookupHit.sku}. A criação deste SKU está bloqueada.</p>
                <Link href={`/catalogo/${lookupHit.blingId}`} className="inline-block rounded-lg bg-text-primary px-3 py-1.5 font-semibold text-bg-base">
                  Ir para o produto existente
                </Link>
              </div>
            )}
            {lookupHit === 'free' && (
              <form
                className="mt-3 space-y-2 text-xs"
                onSubmit={(event) => {
                  event.preventDefault();
                  setCreateError(null);
                  setStockNotice(null);
                  const price = Number(createPrice.replace(',', '.'));
                  const stock = Number(createStock.replace(',', '.'));
                  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
                    setCreateError('Informe preço e estoque válidos. O cadastro sai no Bling.');
                    return;
                  }
                  setConfirmCreate(true);
                }}
              >
                <p className="text-text-muted">SKU livre. Nome, preço e estoque são gravados no Bling.</p>
                <input value={createName} onChange={(event) => setCreateName(event.target.value)} required placeholder="Nome" className="w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary" />
                <input value={createPrice} onChange={(event) => setCreatePrice(event.target.value)} required inputMode="decimal" placeholder="Preço" className="w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary" />
                <input value={createStock} onChange={(event) => setCreateStock(event.target.value)} required inputMode="decimal" placeholder="Estoque" className="w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary" />
                <input value={createImageUrl} onChange={(event) => setCreateImageUrl(event.target.value)} placeholder="URL da imagem (só no HUB)" className="w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary" />
                {createError && (
                  <div role="alert" className="space-y-2 rounded-lg border border-rose-700 bg-rose-950 px-3 py-2 text-rose-100">
                    <p>{createError}</p>
                    <a
                      href="https://www.bling.com.br/produtos.php"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block rounded-lg border border-rose-400 px-3 py-1.5 font-semibold text-rose-50"
                    >
                      Cadastrar diretamente no Bling
                    </a>
                  </div>
                )}
                {stockNotice && createdBlingId && (
                  <div role="status" className="space-y-2 rounded-lg border border-amber-700 bg-amber-950 px-3 py-2 text-amber-100">
                    <p>{stockNotice}</p>
                    <Link href={`/catalogo/${createdBlingId}`} className="inline-block font-semibold underline">
                      Abrir o produto salvo no HUB
                    </Link>
                  </div>
                )}
                {confirmCreate && (
                  <div role="alertdialog" aria-labelledby="confirm-bling-title" className="space-y-2 rounded-lg border border-amber-600 bg-amber-950 px-3 py-2 text-amber-50">
                    <p id="confirm-bling-title">Atenção: Isso criará um produto real no seu ERP Bling. Deseja continuar?</p>
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg border border-amber-400 px-3 py-1.5" onClick={() => setConfirmCreate(false)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-bg-base"
                        onClick={() => {
                          const price = Number(createPrice.replace(',', '.'));
                          const stock = Number(createStock.replace(',', '.'));
                          setConfirmCreate(false);
                          void apiFetch<{ blingId: string; stockWarning?: string | null }>('/api/catalog/products', {
                            method: 'POST',
                            json: {
                              sku: lookupSku.trim(),
                              name: createName.trim(),
                              price,
                              stock,
                              imageUrl: createImageUrl.trim() || undefined,
                            },
                          }).then((created) => {
                            if (created.stockWarning) {
                              setStockNotice(created.stockWarning);
                              setCreatedBlingId(created.blingId);
                              setNotice(created.stockWarning);
                              return;
                            }
                            setLookupOpen(false);
                            setNotice(`Produto ${lookupSku.trim()} criado no Bling e salvo no HUB.`);
                            window.location.assign(`/catalogo/${created.blingId}`);
                          }).catch((error: unknown) => {
                            const message = error instanceof ApiError && typeof error.body === 'object' && error.body !== null && 'message' in error.body
                              ? String((error.body as { message: unknown }).message)
                              : 'Não foi possível criar o produto no Bling.';
                            setCreateError(message);
                          });
                        }}
                      >
                        Continuar
                      </button>
                    </div>
                  </div>
                )}
                <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-text-primary">Salvar</button>
              </form>
            )}
            <button type="button" onClick={() => setLookupOpen(false)} className="mt-4 text-xs text-text-muted underline">Fechar</button>
          </div>
        </div>
      )}

      {draftFor && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border-color bg-bg-base p-5">
            <h2 className="text-sm font-bold text-text-primary">Duplicar não cria SKU no ERP</h2>
            <p className="mt-2 text-xs text-text-muted">Informe um SKU novo. Se ele já existir, o HUB abre o produto existente.</p>
            <input
              value={draftSku}
              onChange={(event) => setDraftSku(event.target.value)}
              className="mt-3 w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
            />
            <button
              type="button"
              className="mt-3 rounded-lg border border-border-color px-3 py-1.5 text-xs text-text-primary"
              onClick={() => {
                void apiFetch<{ found: boolean; product?: { bling_id: string } }>(
                  `/api/catalog/lookup?sku=${encodeURIComponent(draftSku.trim())}`
                ).then((result) => {
                  setDraftResult(
                    result.found
                      ? `SKU já existe. Use a ficha /catalogo/${result.product?.bling_id}. Nada foi criado no ERP.`
                      : 'SKU livre no catálogo. O rascunho não foi gravado no Bling.'
                  );
                }).catch(() => setDraftResult('Não foi possível consultar o SKU.'));
              }}
            >
              Conferir SKU
            </button>
            {draftResult && <p className="mt-3 text-xs text-text-primary">{draftResult}</p>}
            <button type="button" onClick={() => setDraftFor(null)} className="mt-4 text-xs text-text-muted underline">Fechar</button>
          </div>
        </div>
      )}
    </main>
  );
}
