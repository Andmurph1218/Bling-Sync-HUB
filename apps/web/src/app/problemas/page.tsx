'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Download, RefreshCw, RotateCw } from 'lucide-react';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { ProblemDataGrid } from '../../components/problems/problem-data-grid';
import { ProblemLogDrawer } from '../../components/problems/problem-log-drawer';
import { ERP_SYNC_GROUP, ProblemGroup, ProblemSelection, ProblemType } from '../../components/problems/types';

type Filter = ProblemType | 'todos';

interface PanelPayload {
  groups: ProblemGroup[];
  counts: Record<Filter, number>;
}

interface BatchStatus {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  rows_error: number;
}

const FILTERS: Array<{ type: Filter; label: string }> = [
  { type: 'todos', label: 'Todos' },
  { type: 'estoque', label: 'Problemas de Estoque' },
  { type: 'preco', label: 'Problemas de Preço' },
  { type: 'anuncio', label: 'Problemas de Anúncio' },
  { type: 'cadastro', label: 'Problemas de Cadastro' },
];

const SYSTEMIC_THRESHOLD = 100;

function systemicMessage(group: ProblemGroup): string {
  if (group.key === ERP_SYNC_GROUP) {
    return "Falha Sistêmica Detectada: O job de leitura de estoque parece estar parado. Verifique a conexão com o Bling ou clique em 'Reprocessar Todos'.";
  }
  const fix = group.action === 'bling' ? "clique em 'Corrigir no Bling'" : "clique em 'Reprocessar Todos'";
  return `Falha Sistêmica Detectada: ${group.count.toLocaleString('pt-BR')} itens com o mesmo erro (${group.message}). Verifique a conexão com ${group.channel} ou ${fix}.`;
}

export default function ProblemasPage() {
  const { hasRole } = useCurrentRole();
  const canWrite = hasRole('operator', 'admin');
  const canSyncErp = hasRole('admin');
  const [panel, setPanel] = useState<PanelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('todos');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importFilter, setImportFilter] = useState<{ sku: string; file: string } | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Map<string, string>>(new Map());
  const [drawer, setDrawer] = useState<{ itemId: string | null; group: ProblemGroup | null } | null>(null);
  const [batch, setBatch] = useState<BatchStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPanel(await apiFetch<PanelPayload>('/api/problems/panel'));
      setError(null);
    } catch {
      setError('Não foi possível ler as exceções do HUB.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sku = params.get('q');
    const file = params.get('importacao');
    if (sku || file) setImportFilter({ sku: sku ?? '', file: file ?? '' });
    void load();
  }, [load]);

  useEffect(() => {
    if (!batch || batch.status === 'done' || batch.status === 'failed') return;
    const timer = window.setTimeout(() => {
      void apiFetch<BatchStatus>(`/api/catalog/batch-jobs/${batch.id}`)
        .then((next) => {
          setBatch(next);
          if (next.status === 'done') void load();
        })
        .catch(() => setBatch(null));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [batch, load]);

  const visible = useMemo(
    () => (panel?.groups ?? []).filter((group) => filter === 'todos' || group.type === filter),
    [panel, filter]
  );
  const systemic = visible.filter((group) => group.count > SYSTEMIC_THRESHOLD).sort((a, b) => b.count - a.count)[0];

  const clearSelection = () => {
    setSelectedGroups(new Set());
    setSelectedItems(new Map());
  };

  const selection = (): ProblemSelection => ({
    groupKeys: [...selectedGroups],
    itemIds: [...selectedItems.keys()],
  });

  const selectedTotal =
    (panel?.groups ?? []).filter((group) => selectedGroups.has(group.key)).reduce((sum, group) => sum + group.count, 0) +
    selectedItems.size;

  const toggleGroup = (key: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectedItems((prev) => new Map([...prev].filter(([, groupKey]) => groupKey !== key)));
  };

  const toggleItem = (id: string, groupKey: string) => {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, groupKey);
      return next;
    });
  };

  const toggleAll = () => {
    const everyVisible = visible.length > 0 && visible.every((group) => selectedGroups.has(group.key));
    setSelectedGroups(everyVisible ? new Set() : new Set(visible.map((group) => group.key)));
    setSelectedItems(new Map());
  };

  const reprocess = async (target: Partial<ProblemSelection>) => {
    setNotice(null);
    try {
      const started = await apiFetch<{ batchJobId: string; total: number }>('/api/problems/reprocess', {
        method: 'POST',
        json: { groupKeys: target.groupKeys ?? [], itemIds: target.itemIds ?? [] },
      });
      setBatch({ id: started.batchJobId, status: 'queued', total: started.total, processed: 0, rows_error: 0 });
    } catch {
      setNotice('Não foi possível iniciar o reprocessamento.');
    }
  };

  const dismiss = async () => {
    if (!window.confirm(`Ignorar ${selectedTotal.toLocaleString('pt-BR')} erro(s)? Eles saem deste painel, mas o dado continua igual no ERP.`)) {
      return;
    }
    try {
      const result = await apiFetch<{ dismissed: number }>('/api/problems/dismiss', { method: 'POST', json: selection() });
      setNotice(`${result.dismissed.toLocaleString('pt-BR')} erro(s) ignorado(s).`);
      clearSelection();
      await load();
    } catch {
      setNotice('Não foi possível ignorar os erros selecionados.');
    }
  };

  const exportCsv = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/problems/export.csv`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection()),
      });
      if (!response.ok) throw new Error('export_failed');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'erros-integracao.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice('Não foi possível exportar a lista de erros.');
    }
  };

  const batchDone = batch?.status === 'done' || batch?.status === 'failed';

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 pb-28">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Exceções e Logs de Erro</h1>
          <p className="mt-1 text-sm text-text-muted">
            Erros iguais viram uma linha só. Expanda para ver os SKUs, reprocesse em lote ou corrija na origem.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary lg:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {importFilter && (
        <p className="mt-4 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm text-text-muted">
          Filtro da importação{importFilter.file ? ` ${importFilter.file}` : ''}
          {importFilter.sku ? `: SKU ${importFilter.sku}` : ''}. Os grupos abaixo reúnem o mesmo tipo de falha. Abra o grupo e procure esse SKU.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-200" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-text-muted" role="status">{notice}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit rounded-xl border border-border-color bg-bg-surface p-2">
          <ul className="space-y-0.5">
            {FILTERS.map((item) => {
              const count = panel?.counts[item.type] ?? 0;
              const active = filter === item.type;
              return (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => setFilter(item.type)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      active ? 'bg-bg-base font-semibold text-text-primary' : 'text-text-muted hover:bg-bg-base hover:text-text-primary'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    <span
                      className={`min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-[11px] font-bold tabular-nums ${
                        count > 0 ? 'bg-rose-600 text-white' : 'bg-bg-base text-text-muted'
                      }`}
                    >
                      {count.toLocaleString('pt-BR')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="min-w-0 space-y-3">
          {systemic && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:text-rose-100 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{systemicMessage(systemic)}</span>
              </p>
              {systemic.action === 'reprocess' && canWrite && (
                <button
                  type="button"
                  onClick={() => void reprocess({ groupKeys: [systemic.key] })}
                  disabled={systemic.key === ERP_SYNC_GROUP && !canSyncErp}
                  title={systemic.key === ERP_SYNC_GROUP && !canSyncErp ? 'Apenas administradores podem forçar a leitura do Bling.' : undefined}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Reprocessar Todos
                </button>
              )}
            </div>
          )}

          {!loading && visible.length === 0 && !error && (
            <p className="rounded-xl border border-border-color bg-bg-surface px-4 py-8 text-center text-sm text-text-muted">
              Nenhuma exceção neste filtro.
            </p>
          )}

          {visible.length > 0 && (
            <ProblemDataGrid
              groups={visible}
              selection={{ groupKeys: selectedGroups, itemIds: selectedItems }}
              canWrite={canWrite}
              canSyncErp={canSyncErp}
              onToggleGroup={toggleGroup}
              onToggleItem={toggleItem}
              onToggleAll={toggleAll}
              onReprocess={(target) => void reprocess(target)}
              onOpenLog={(itemId) => setDrawer({ itemId, group: null })}
              onOpenGroup={(group) => setDrawer({ itemId: null, group })}
            />
          )}
        </section>
      </div>

      {batch && (
        <div className="fixed bottom-24 right-5 z-40 w-80 rounded-xl border border-border-color bg-bg-surface p-3 text-xs text-text-primary shadow-xl" role="status">
          <div className="flex items-center justify-between">
            <p className="font-semibold">
              {batchDone ? 'Reprocessamento concluído' : `Reprocessando ${batch.processed.toLocaleString('pt-BR')}/${batch.total.toLocaleString('pt-BR')}...`}
            </p>
            {batchDone && (
              <button type="button" className="text-text-muted underline" onClick={() => setBatch(null)}>Fechar</button>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-base">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${batch.total ? Math.round((batch.processed / batch.total) * 100) : 0}%` }}
            />
          </div>
          {batchDone && (
            <p className="mt-2">
              {batch.rows_error.toLocaleString('pt-BR')} falha(s).{' '}
              {batch.rows_error > 0 && (
                <a className="font-semibold underline" href={`${API_BASE_URL}/api/catalog/batch-jobs/${batch.id}/errors.csv`}>
                  Baixar log de falhas (CSV)
                </a>
              )}
            </p>
          )}
        </div>
      )}

      {selectedTotal > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border-color bg-bg-base px-4 py-2 text-xs text-text-primary shadow-2xl">
          <span className="font-semibold tabular-nums">
            {selectedTotal.toLocaleString('pt-BR')} {selectedTotal === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          {canWrite && (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 font-semibold text-white"
                onClick={() => {
                  void reprocess(selection());
                  clearSelection();
                }}
              >
                <RotateCw className="h-3 w-3" />
                Reprocessar Selecionados
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-border-color px-3 py-1 font-semibold"
                onClick={() => void dismiss()}
              >
                <Archive className="h-3 w-3" />
                Ignorar/Arquivar Erro
              </button>
            </>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-border-color px-3 py-1 font-semibold"
            onClick={() => void exportCsv()}
          >
            <Download className="h-3 w-3" />
            Exportar Lista de Erros (CSV)
          </button>
          <button type="button" className="text-text-muted underline" onClick={clearSelection}>
            Limpar
          </button>
        </div>
      )}

      {drawer && <ProblemLogDrawer itemId={drawer.itemId} group={drawer.group} onClose={() => setDrawer(null)} />}
    </main>
  );
}
