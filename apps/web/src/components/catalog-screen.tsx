'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ImageOff, MoreVertical, PackageOpen, Pencil, Play, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { ApiError, apiFetch, API_BASE_URL } from '../utils/api-client';
import { EmptySkuNotice, isBlankSku } from './empty-sku-notice';
import { buildBlingProductUrl } from '../utils/matching-signals';
import { IntegrationStatusBadge, integrationBadgeKind } from './integration-status-badge';
import { useCurrentRole } from './app-shell';
import { Toaster, ToastMessage } from './toaster';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels';
import useSWR from 'swr';

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

interface ChannelIntegration {
  platform: 'mercadolivre' | 'nuvemshop';
  visual: 'connected' | 'pending' | 'blocked' | 'absent';
  label: string;
  tooltip: string;
  percent: number;
  ready: boolean;
  blockers: Array<{ code: string; title: string; fixHref: string; where: 'bling' | 'hub' }>;
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
  integrations?: ChannelIntegration[];
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
  dimensions: 'sem peso e dimensões',
  description: 'sem descrição',
  content: 'sem atributos ou descrição',
};

const CHANNEL_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
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

const MISSING_LABEL: Record<string, string> = {
  sku: 'SKU',
  cover: 'Imagem de Capa',
  hub_category: 'Categoria',
  channel_category: 'Categoria do canal',
  attributes: 'Atributos',
  ean: 'EAN',
  ncm: 'NCM',
  price: 'Preço',
  duplicate: 'Duplicata',
};

function missingFieldsLabel(item: CatalogItem): string {
  const missing = item.checklist.items.filter((row) => !row.ok).map((row) => MISSING_LABEL[row.code] ?? row.title);
  return missing.length > 0 ? `Faltam: ${missing.join(', ')}` : 'Cadastro completo';
}

function completenessBarClass(item: CatalogItem): string {
  const fatal = item.checklist.items.some((row) => !row.ok && (row.code === 'sku' || row.code === 'ncm'));
  if (item.checklist.percent >= 100) return 'bg-emerald-600';
  if (fatal) return 'bg-rose-500';
  return item.checklist.percent < 50 ? 'bg-orange-400' : 'bg-sky-500';
}

export function CatalogScreen({ lockedTab }: { lockedTab?: 'completude' }) {
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');
  const search = useSearchParams();
  const initialTab = lockedTab ?? (search.get('status') === 'completude' ? 'completude' : search.get('status') === 'ready' ? 'ready' : 'todos');
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const [gap, setGap] = useState(search.get('pendencia') ?? '');
  const [view, setView] = useState<TopView>(search.get('aba') === 'envio' ? 'envio' : 'produtos');
  const initialSku = search.get('sku') ?? '';
  const [sku, setSku] = useState(initialSku);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [applied, setApplied] = useState({ sku: initialSku, name: '', brand: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [channelFocus, setChannelFocus] = useState<{ item: CatalogItem; platform: ChannelIntegration['platform'] } | null>(null);
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
  const [existingProduct, setExistingProduct] = useState<{ bling_id: string } | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const { data: batch } = useSWR<{ status: string; processed: number; total: number; rows_error: number }>(
    batchId ? `/api/catalog/batch-jobs/${batchId}` : null,
    (path: string) => apiFetch(path),
    { refreshInterval: 2000 }
  );
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

  useEffect(() => {
    if (batch?.status !== 'done') return;
    pushToast({
      variant: 'success',
      title: 'Lote concluído',
      description: `${batch.processed} processados, ${batch.rows_error} erro(s).`,
    });
  }, [batch?.status, batch?.processed, batch?.rows_error, pushToast]);

  const addToSendList = async (ids: string[]) => {
    if (ids.length === 0) {
      setNotice('Selecione ao menos um produto.');
      return;
    }
    const result = await apiFetch<{ queued: string[]; skipped: Array<{ id: string; sku: string; reason: string }> }>(
      '/api/catalog/products/send-list',
      { method: 'POST', json: { ids, channel: MERCADO_LIVRE_ACTIVE ? 'mercadolivre' : 'nuvemshop' } }
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

      <div className="mt-6">
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
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold text-text-primary"
                  aria-expanded={filtersOpen}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filtros avançados
                </button>
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
              {filtersOpen && (
                <div className="mt-3 rounded-xl border border-border-color bg-bg-surface p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block text-[11px] text-text-muted">
                      SKU
                      <input value={sku} onChange={(event) => setSku(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary" />
                    </label>
                    <label className="block text-[11px] text-text-muted">
                      Nome
                      <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary" />
                    </label>
                    <label className="block text-[11px] text-text-muted">
                      Marca
                      <input value={brand} onChange={(event) => setBrand(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary" />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPage(1);
                        setApplied({ sku, name, brand });
                        setFiltersOpen(false);
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
                </div>
              )}
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
                      <th className="px-2 py-1.5">
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
                      <th className="px-2 py-1.5">Imagem</th>
                      <th className="px-2 py-1.5">Nome</th>
                      <th className="px-2 py-1.5">Tipo</th>
                      <th className="px-2 py-1.5">Estoque</th>
                      <th className="px-2 py-1.5">Preço</th>
                      <th className="px-2 py-1.5">Promo</th>
                      <th className="px-2 py-1.5">Integrado</th>
                      <th className="px-2 py-1.5">Completude</th>
                      <th className="px-2 py-1.5">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-color bg-bg-base/40">
                    {loading && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-text-muted">Lendo o catálogo...</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-rose-200" role="alert">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && data && data.items.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-text-muted">Nenhum produto nesta lista.</td>
                      </tr>
                    )}
                    {data?.items.map((item) => (
                      <React.Fragment key={item.id}>
                        <tr className="h-14 max-h-14">
                          <td className="px-2 py-1">
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
                          <td className="px-2 py-1">
                            {item.coverUrl ? (
                              <img src={item.coverUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
                            ) : (
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-bg-surface text-text-muted">
                                <ImageOff className="h-4 w-4" aria-hidden="true" />
                              </span>
                            )}
                          </td>
                          <td className="max-w-[240px] px-2 py-1">
                            <p className="truncate font-medium text-text-primary">{item.name || 'Sem nome no ERP'}</p>
                            {isBlankSku(item.sku) ? <EmptySkuNotice /> : <p className="truncate font-mono text-xs text-text-muted">{item.sku}</p>}
                          </td>
                          <td className="px-2 py-1 text-text-muted">{item.typeLabel}</td>
                          <td className="px-2 py-1">{item.stock === null ? '—' : item.stock}</td>
                          <td className="px-2 py-1">{money(item.price)}</td>
                          <td className="px-2 py-1">{item.promotionalPrice === null ? '—' : money(item.promotionalPrice)}</td>
                          <td className="px-2 py-1">
                            <div className="flex flex-wrap gap-1">
                              {(item.integrations ?? [])
                                .filter((channel) => MERCADO_LIVRE_ACTIVE || channel.platform !== 'mercadolivre')
                                .map((channel) => (
                                  <IntegrationStatusBadge
                                    key={channel.platform}
                                    platform={channel.platform}
                                    kind={integrationBadgeKind(channel)}
                                    onClick={() => setChannelFocus({ item, platform: channel.platform })}
                                  />
                                ))}
                            </div>
                          </td>
                          <td className="px-2 py-1" title={missingFieldsLabel(item)}>
                            <div className="w-16">
                              <p className="text-[11px] font-semibold text-text-primary">{item.checklist.percent}%</p>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-surface">
                                <div className={`h-full ${completenessBarClass(item)}`} style={{ width: `${item.checklist.percent}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              <Link href={`/catalogo/${item.blingId}?aba=geral`} title="Editar" className="rounded border border-border-color p-1 text-text-primary">
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              {(isAdmin || item.checklist.ready || (item.integrations ?? []).some((channel) => channel.ready)) && (
                                <button type="button" title="Simular envio" className="rounded border border-border-color p-1 text-text-primary" onClick={() => void simulateIds([item.id])}>
                                  <Play className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                title="Mais ações"
                                aria-label="Mais ações"
                                className="rounded border border-border-color p-1 text-text-primary"
                                onClick={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setRowMenu((current) => current?.id === item.id ? null : { id: item.id, top: rect.bottom + 4, left: rect.right });
                                }}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {openVariants[item.blingId] && (
                          <tr>
                            <td colSpan={10} className="bg-bg-surface/70 px-6 py-3 text-[11px] text-text-muted">
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

      {channelFocus && (() => {
        const focus = channelFocus.item.integrations?.find((channel) => channel.platform === channelFocus.platform);
        const channelName = CHANNEL_LABEL[channelFocus.platform] ?? channelFocus.platform;
        return (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="presentation" onClick={() => setChannelFocus(null)}>
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="channel-focus-title"
              className="h-full w-full max-w-md overflow-auto border-l border-border-color bg-bg-surface p-5 text-text-primary shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-text-muted">Status de integração</p>
                  <h2 id="channel-focus-title" className="mt-1 text-base font-bold">{channelFocus.item.name || 'Sem nome no ERP'}</h2>
                  <p className="text-xs text-text-muted">{channelName} · {focus?.label ?? 'Sem leitura'}</p>
                </div>
                <button type="button" className="text-xs text-text-muted underline" onClick={() => setChannelFocus(null)}>Fechar</button>
              </div>
              <p className="mt-4 text-sm font-semibold">{focus?.percent ?? 0}% pronto</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-base">
                <div className="h-full bg-emerald-600" style={{ width: `${focus?.percent ?? 0}%` }} />
              </div>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">Lista de prontidão</h3>
              {(focus?.blockers.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">Nada pendente neste canal.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {focus?.blockers.map((blocker) => (
                    <li key={blocker.code} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                      <p>{blocker.title}</p>
                      {blocker.where === 'bling' ? (
                        <a href={buildBlingProductUrl(channelFocus.item.blingId)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold underline">
                          Corrigir no Bling
                        </a>
                      ) : (
                        <Link href={blocker.fixHref} className="mt-1 inline-block font-semibold underline">Resolver no HUB</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {focus?.ready && (
                <button
                  type="button"
                  className="mt-5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => void addToSendList([channelFocus.item.id])}
                >
                  Enviar para {channelName}
                </button>
              )}
              <p className="mt-3 text-[11px] text-text-muted">O envio entra na fila. Com a publicação ao vivo desligada, o HUB só simula.</p>
            </aside>
          </div>
        );
      })()}

      {simulation && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="simulate-title">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-border-color bg-bg-base p-5">
            <h2 id="simulate-title" className="text-sm font-bold text-text-primary">Simulação de envio — {MERCADO_LIVRE_ACTIVE ? 'Mercado Livre' : 'Nuvemshop'}</h2>
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

      {batch && (
        <div className="fixed bottom-24 right-5 z-40 w-72 rounded-xl border border-border-color bg-bg-surface p-3 text-xs text-text-primary shadow-xl">
          <p className="font-semibold">Processando {batch.processed}/{batch.total}...</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-base">
            <div className="h-full bg-emerald-600" style={{ width: `${batch.total ? Math.round((batch.processed / batch.total) * 100) : 0}%` }} />
          </div>
          {batch.status === 'done' && (
            <div className="mt-2 flex flex-col gap-1">
              <p>Lote concluído. {batch.rows_error} erro(s).</p>
              <a className="font-semibold underline" href={`${API_BASE_URL}/api/catalog/batch-jobs/${batchId}/errors.csv`}>Baixar Log de Erros (CSV)</a>
            </div>
          )}
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismissToast} />

      {selected.length > 0 && view === 'produtos' && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border-color bg-bg-base px-4 py-2 text-xs text-text-primary shadow-2xl">
          <span>{selected.length} {selected.length === 1 ? 'item selecionado' : 'itens selecionados'}.</span>
          <button
            type="button"
            className="rounded-full border border-border-color px-3 py-1 font-semibold"
            onClick={() => {
              void apiFetch<{ batchJobId: string }>('/api/catalog/batch-jobs', { method: 'POST', json: { action: 'arquivar', ids: selected } })
                .then((job) => setBatchId(job.batchJobId))
                .catch(() => setNotice('Não foi possível arquivar.'));
            }}
          >
            Arquivar
          </button>
          <button
            type="button"
            className="rounded-full border border-border-color px-3 py-1 font-semibold"
            onClick={() => {
              void apiFetch<{ batchJobId: string }>('/api/catalog/batch-jobs', { method: 'POST', json: { action: 'completude', ids: selected } })
                .then((job) => setBatchId(job.batchJobId))
                .catch(() => setNotice('Não foi possível recalcular.'));
            }}
          >
            Recalcular
          </button>
          <button type="button" className="rounded-full bg-emerald-700 px-3 py-1 font-semibold text-white" onClick={() => void simulateIds(selected)}>
            Simular Envio
          </button>
          <button type="button" className="text-text-muted underline" onClick={() => setSelected([])}>
            Limpar
          </button>
        </div>
      )}

      {rowMenu && (() => {
        const menuItem = data?.items.find((row) => row.id === rowMenu.id);
        if (!menuItem) return null;
        return (
          <div className="fixed inset-0 z-50" onClick={() => setRowMenu(null)}>
            <div
              className="absolute w-44 rounded-lg border border-border-color bg-bg-surface py-1 text-xs shadow-xl"
              style={{ top: rowMenu.top, left: rowMenu.left, transform: 'translateX(-100%)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-bg-base" onClick={() => { setDraftFor(menuItem); setDraftSku(''); setDraftResult(null); setRowMenu(null); }}>
                Duplicar produto
              </button>
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-bg-base" onClick={() => { void archiveIds([menuItem.id], !menuItem.archived).catch(() => setNotice('Não foi possível alterar o arquivamento.')); setRowMenu(null); }}>
                {menuItem.archived ? 'Desarquivar' : 'Arquivar'}
              </button>
              <a href={buildBlingProductUrl(menuItem.blingId)} target="_blank" rel="noreferrer" className="block px-3 py-1.5 hover:bg-bg-base" onClick={() => setRowMenu(null)}>
                Ver no Bling
              </a>
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-bg-base" onClick={() => { void toggleVariants(menuItem); setRowMenu(null); }}>
                Variações
              </button>
            </div>
          </div>
        );
      })()}

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
            <p className="mt-2 text-xs text-text-muted">Informe um SKU. Se ele já existir, escolha abrir o produto ou vincular um anúncio da Nuvemshop.</p>
            <input
              value={draftSku}
              onChange={(event) => { setDraftSku(event.target.value); setExistingProduct(null); setDraftResult(null); }}
              className="mt-3 w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
            />
            <button
              type="button"
              className="mt-3 rounded-lg border border-border-color px-3 py-1.5 text-xs text-text-primary"
              onClick={() => {
                void apiFetch<{ found: boolean; product?: { bling_id: string } }>(
                  `/api/catalog/lookup?sku=${encodeURIComponent(draftSku.trim())}`
                ).then((result) => {
                  if (result.found && result.product?.bling_id) {
                    setExistingProduct({ bling_id: result.product.bling_id });
                    setDraftResult('SKU já existe no Bling.');
                    return;
                  }
                  setExistingProduct(null);
                  setDraftResult('SKU livre no catálogo. O rascunho não foi gravado no Bling.');
                }).catch(() => setDraftResult('Não foi possível consultar o SKU.'));
              }}
            >
              Conferir SKU
            </button>
            {draftResult && <p className="mt-3 text-xs font-semibold text-text-primary">{draftResult}</p>}
            {existingProduct && (
              <div className="mt-3 flex flex-col gap-2">
                <Link href={`/catalogo/${existingProduct.bling_id}`} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-center text-xs font-semibold text-text-primary">
                  Ir para o produto existente
                </Link>
                <Link href={`/matching?sku=${encodeURIComponent(draftSku.trim())}&platform=nuvemshop`} className="rounded-lg border border-border-color px-3 py-1.5 text-center text-xs font-semibold text-text-primary">
                  Vincular um anúncio Nuvemshop existente a este SKU
                </Link>
              </div>
            )}
            <button type="button" onClick={() => setDraftFor(null)} className="mt-4 text-xs text-text-muted underline">Fechar</button>
          </div>
        </div>
      )}
    </main>
  );
}
