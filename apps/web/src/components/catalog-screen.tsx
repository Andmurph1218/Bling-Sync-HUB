'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Archive, Copy, Pencil, Plus, Search, Warehouse } from 'lucide-react';
import { apiFetch } from '../utils/api-client';
import { EmptySkuNotice, isBlankSku } from './empty-sku-notice';

type CatalogTab = 'todos' | 'publicados' | 'completude' | 'rejeitados' | 'arquivados' | 'ready';
type TopView = 'produtos' | 'envio' | 'importacoes' | 'exportacoes';

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

function toneClass(tone: CatalogItem['checklist']['tone']): string {
  if (tone === 'green') return 'text-emerald-300';
  if (tone === 'amber') return 'text-amber-300';
  return 'text-rose-300';
}

function channelClass(state: string): string {
  if (state === 'published') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (state === 'rejected') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  if (state === 'pending') return 'border-zinc-600 bg-zinc-800 text-zinc-300';
  return 'border-zinc-800 bg-transparent text-zinc-600';
}

export function CatalogScreen({ lockedTab }: { lockedTab?: 'completude' }) {
  const search = useSearchParams();
  const initialTab = lockedTab ?? (search.get('status') === 'ready' ? 'ready' : 'todos');
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const [view, setView] = useState<TopView>('produtos');
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [applied, setApplied] = useState({ sku: '', name: '', brand: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState('arquivar');
  const [notice, setNotice] = useState<string | null>(null);
  const [openVariants, setOpenVariants] = useState<Record<string, VariantRow[] | 'loading'>>({});
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupSku, setLookupSku] = useState('');
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<CatalogItem | null>(null);
  const [draftSku, setDraftSku] = useState('');
  const [draftResult, setDraftResult] = useState<string | null>(null);

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
  }, [applied.brand, applied.name, applied.sku, page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const counts = data?.counts;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{lockedTab ? 'Completude' : 'Catálogo'}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Um produto do ERP, um SKU no HUB. Arquivar não apaga o cadastro no Bling.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLookupOpen(true);
            setLookupResult(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Produto
        </button>
      </header>

      {notice && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100" role="status">
          {notice}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Filtros</h2>
            <label className="mt-3 block text-[11px] text-zinc-400">
              SKU
              <input
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="mt-2 block text-[11px] text-zinc-400">
              Nome
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <button type="button" onClick={() => setShowMore((prev) => !prev)} className="mt-2 text-[11px] text-zinc-300 underline">
              {showMore ? 'Ver menos' : 'Ver mais'}
            </button>
            {showMore && (
              <label className="mt-2 block text-[11px] text-zinc-400">
                Marca
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
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
                className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-900"
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
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-200"
              >
                Limpar
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Ações em lote</h2>
            <select
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value)}
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
            >
              <option value="arquivar">Arquivar</option>
              <option value="envio">Enviar para lista de envio</option>
              <option value="exportar">Exportar seleção</option>
            </select>
            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100"
              onClick={() => {
                if (bulkAction === 'arquivar') {
                  void archiveIds(selected, true).catch(() => setNotice('Não foi possível arquivar a seleção.'));
                  return;
                }
                setNotice(
                  bulkAction === 'envio'
                    ? 'A lista de envio com publicação real entra no P2. Nada foi enviado ao canal.'
                    : 'A exportação de planilha entra no P2. Nenhum arquivo foi gerado.'
                );
              }}
            >
              Executar
            </button>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Importação</h2>
            <p className="mt-2 text-[11px] text-zinc-400">
              Reimportar do ERP e planilha de enriquecimento ficam no P2. Esta tela não cria produto no Bling.
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
                onClick={() => setView(id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  view === id
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-zinc-700 text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view !== 'produtos' && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-300" role="status">
              {view === 'envio' && 'Nenhum envio nesta lista. A publicação em lote entra no P2 e não grava anúncio no canal.'}
              {view === 'importacoes' && 'Nenhuma importação registrada. O HUB não inventa linhas de planilha.'}
              {view === 'exportacoes' && 'Nenhuma exportação gerada. O download de planilha entra no P2.'}
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
                        : 'border-zinc-800 text-zinc-300'
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

              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-900 text-[11px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="px-3 py-3"> </th>
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
                  <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
                    {loading && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-zinc-400">Lendo o catálogo...</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-rose-200" role="alert">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && data && data.items.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-zinc-400">Nenhum produto nesta lista.</td>
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
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-zinc-800 text-[10px] text-zinc-500">sem</span>
                            )}
                            <button type="button" onClick={() => void toggleVariants(item)} className="mt-1 block text-[10px] text-sky-300">
                              Variações
                            </button>
                          </td>
                          <td className="px-3 py-3 text-zinc-100">{item.name || 'Sem nome no ERP'}</td>
                          <td className="px-3 py-3 text-zinc-300">{item.typeLabel}</td>
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
                              <Link href={`/catalogo/${item.blingId}?aba=geral`} title="Editar" className="rounded border border-zinc-700 p-1 text-zinc-200">
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              <button type="button" title="Duplicar não cria SKU no ERP" onClick={() => { setDraftFor(item); setDraftSku(''); setDraftResult(null); }} className="rounded border border-zinc-700 p-1 text-zinc-200">
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <Link href={`/catalogo/${item.blingId}?aba=variacoes`} title="Depósitos lidos do ERP" className="rounded border border-zinc-700 p-1 text-zinc-200">
                                <Warehouse className="h-3.5 w-3.5" />
                              </Link>
                              <button
                                type="button"
                                title={item.archived ? 'Desarquivar' : 'Arquivar'}
                                onClick={() => void archiveIds([item.id], !item.archived).catch(() => setNotice('Não foi possível alterar o arquivamento.'))}
                                className="rounded border border-zinc-700 p-1 text-zinc-200"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {openVariants[item.blingId] && (
                          <tr>
                            <td colSpan={11} className="bg-zinc-900/70 px-6 py-3 text-[11px] text-zinc-300">
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
                <p className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
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

      {lookupOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-5">
            <h2 className="text-sm font-bold text-white">Buscar SKU ou EAN antes de criar</h2>
            <div className="mt-3 flex gap-2">
              <Search className="mt-2 h-4 w-4 text-zinc-500" />
              <input
                value={lookupSku}
                onChange={(event) => setLookupSku(event.target.value)}
                placeholder="SKU do ERP"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white"
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => {
                void apiFetch<{ found: boolean; product?: { bling_id: string; name: string | null } }>(
                  `/api/catalog/lookup?sku=${encodeURIComponent(lookupSku.trim())}`
                ).then((result) => {
                  setLookupResult(
                    result.found && result.product
                      ? `Já existe: ${result.product.name ?? result.product.bling_id}. Abra a ficha em vez de criar outro cadastro.`
                      : 'Nenhum produto com esse SKU no catálogo. Esta tela não cria cadastro no ERP.'
                  );
                }).catch(() => setLookupResult('Não foi possível consultar o SKU.'));
              }}
            >
              Buscar
            </button>
            {lookupResult && <p className="mt-3 text-xs text-zinc-200">{lookupResult}</p>}
            <button type="button" onClick={() => setLookupOpen(false)} className="mt-4 text-xs text-zinc-400 underline">Fechar</button>
          </div>
        </div>
      )}

      {draftFor && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-5">
            <h2 className="text-sm font-bold text-white">Duplicar não cria SKU no ERP</h2>
            <p className="mt-2 text-xs text-zinc-400">Informe um SKU novo. Se ele já existir, o HUB abre o produto existente.</p>
            <input
              value={draftSku}
              onChange={(event) => setDraftSku(event.target.value)}
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white"
            />
            <button
              type="button"
              className="mt-3 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-white"
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
            {draftResult && <p className="mt-3 text-xs text-zinc-200">{draftResult}</p>}
            <button type="button" onClick={() => setDraftFor(null)} className="mt-4 text-xs text-zinc-400 underline">Fechar</button>
          </div>
        </div>
      )}
    </main>
  );
}
