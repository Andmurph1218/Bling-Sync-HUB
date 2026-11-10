'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { ErpCategoryNode, MappingPlatform, MappingStudio, StudioChannelNode } from './types';

interface DraftLink {
  channelCategoryId: string;
  channelCategoryName: string;
}

function nodeLink(node: ErpCategoryNode, drafts: Record<string, DraftLink | null>): DraftLink | null {
  if (Object.prototype.hasOwnProperty.call(drafts, node.key)) return drafts[node.key] ?? null;
  if (!node.channelCategoryId || !node.channelCategoryName) return null;
  return { channelCategoryId: node.channelCategoryId, channelCategoryName: node.channelCategoryName };
}

export function CategoryMappingPanel({
  platform,
  studio,
  canWrite,
  onSaved,
}: {
  platform: MappingPlatform;
  studio: MappingStudio;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(studio.erp[0]?.key ?? null);
  React.useEffect(() => {
    if (!studio.erp.some((node) => node.key === selectedKey)) setSelectedKey(studio.erp[0]?.key ?? null);
  }, [studio, selectedKey]);
  const [drafts, setDrafts] = useState<Record<string, DraftLink | null>>({});
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'suggest' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const children = useMemo(() => {
    const grouped = new Map<string | null, ErpCategoryNode[]>();
    for (const node of studio.erp) {
      const list = grouped.get(node.parentKey) ?? [];
      list.push(node);
      grouped.set(node.parentKey, list);
    }
    return grouped;
  }, [studio.erp]);

  const selected = studio.erp.find((node) => node.key === selectedKey) ?? null;
  const selectedLink = selected ? nodeLink(selected, drafts) : null;
  const dirty = studio.erp.filter((node) => {
    const draft = drafts[node.key];
    return draft && draft.channelCategoryId !== node.channelCategoryId;
  });

  const visibleChannel = studio.channel.filter((node) => {
    const term = query.trim().toLowerCase();
    return !term || node.path.toLowerCase().includes(term) || node.name.toLowerCase().includes(term);
  });

  const choose = (node: StudioChannelNode) => {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected.key]: { channelCategoryId: node.id, channelCategoryName: node.name } }));
    setQuery('');
  };

  const suggest = async () => {
    setBusy('suggest');
    setMessage(null);
    try {
      const payload = await apiFetch<{ suggestions: Array<{ key: string; channelCategoryId: string; channelCategoryName: string }> }>(
        `/api/catalog/mapping-studio/suggest?platform=${platform}`
      );
      if (payload.suggestions.length === 0) {
        setMessage('Nenhuma categoria com nome parecido para sugerir.');
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const suggestion of payload.suggestions) {
          if (next[suggestion.key]) continue;
          next[suggestion.key] = {
            channelCategoryId: suggestion.channelCategoryId,
            channelCategoryName: suggestion.channelCategoryName,
          };
        }
        return next;
      });
      setMessage(`${payload.suggestions.length} sugestão(ões). Revise e salve para confirmar.`);
    } catch {
      setMessage('Não foi possível sugerir o mapeamento.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (dirty.length === 0) return;
    setBusy('save');
    setMessage(null);
    try {
      await apiFetch('/api/catalog/mapping-studio/categories', {
        method: 'POST',
        json: {
          platform,
          items: dirty.map((node) => ({
            hubCategoryId: node.hubCategoryId,
            path: node.path,
            channelCategoryId: drafts[node.key]!.channelCategoryId,
            channelCategoryName: drafts[node.key]!.channelCategoryName,
          })),
        },
      });
      setDrafts({});
      await onSaved();
      setMessage('Mapeamento de categorias salvo.');
    } catch {
      setMessage('Não foi possível salvar o mapeamento.');
    } finally {
      setBusy(null);
    }
  };

  const createCategory = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    try {
      await apiFetch('/api/catalog/categories', {
        method: 'POST',
        json: { name: trimmed, parentId: selected?.hubCategoryId ?? null },
      });
      setName('');
      await onSaved();
    } catch {
      setMessage('Não foi possível criar a categoria.');
    }
  };

  const renderNodes = (parentKey: string | null, depth: number): React.ReactNode =>
    (children.get(parentKey) ?? []).map((node) => {
      const link = nodeLink(node, drafts);
      const nested = children.get(node.key) ?? [];
      const open = !collapsed.has(node.key);
      const unsaved = Boolean(drafts[node.key] && drafts[node.key]?.channelCategoryId !== node.channelCategoryId);
      return (
        <li key={node.key}>
          <div
            className={`flex items-center gap-1 rounded-md pr-2 ${selectedKey === node.key ? 'bg-bg-base' : 'hover:bg-bg-base/70'}`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            {nested.length > 0 ? (
              <button
                type="button"
                className="rounded p-1 text-text-muted"
                aria-label={open ? 'Recolher' : 'Expandir'}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.key)) next.delete(node.key);
                    else next.add(node.key);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="w-6" />
            )}
            <button type="button" onClick={() => setSelectedKey(node.key)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
              {link ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Mapeada" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="Sem correspondência" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm text-text-primary">{node.name}</span>
                <span className="block truncate text-[11px] text-text-muted">
                  {link ? link.channelCategoryName : 'Sem correspondência no canal'}
                  {unsaved ? ' · não salvo' : ''}
                  {node.productCount > 0 ? ` · ${node.productCount} produto(s)` : ''}
                </span>
              </span>
            </button>
          </div>
          {open && nested.length > 0 && <ul>{renderNodes(node.key, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-border-color bg-bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-border-color px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Categorias do ERP</h2>
            <p className="text-[11px] text-text-muted">Bling e categorias já criadas no HUB.</p>
          </div>
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={!canWrite || busy !== null || studio.erp.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-2.5 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {busy === 'suggest' ? 'Sugerindo...' : 'Sugerir Mapeamento Automático'}
          </button>
        </header>
        {studio.erp.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">
            Nenhuma categoria do Bling ainda. Elas aparecem quando o produto traz a categoria do ERP, ou crie uma abaixo.
          </p>
        ) : (
          <ul className="max-h-[32rem] overflow-auto py-2">{renderNodes(null, 0)}</ul>
        )}
        <div className="flex gap-2 border-t border-border-color px-4 py-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={selected?.hubCategoryId ? `Filha de ${selected.name}` : 'Nova categoria'}
            className="min-w-0 flex-1 rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          />
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => void createCategory()}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Criar
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border-color bg-bg-surface">
        <header className="border-b border-border-color px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Categoria no canal</h2>
          <p className="text-[11px] text-text-muted">
            {selected ? selected.path.join(' > ') : 'Selecione uma categoria do ERP.'}
            {selectedLink ? ` → ${selectedLink.channelCategoryName}` : ''}
          </p>
        </header>
        <div className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!selected}
              placeholder="Buscar na árvore do canal"
              className="w-full rounded-lg border border-border-color bg-bg-base py-1.5 pl-8 pr-2 text-sm text-text-primary disabled:opacity-50"
            />
          </div>
          <ul className="mt-2 max-h-[28rem] overflow-auto">
            {visibleChannel.map((node) => {
              const active = selectedLink?.channelCategoryId === node.id;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    disabled={!selected}
                    onClick={() => choose(node)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-40 ${
                      active ? 'bg-emerald-500/10 text-text-primary' : 'text-text-muted hover:bg-bg-base hover:text-text-primary'
                    }`}
                    style={{ paddingLeft: `${8 + node.path.split(' > ').length * 8}px` }}
                  >
                    <span className="truncate">{node.name}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canWrite || busy !== null || dirty.length === 0}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy === 'save' ? 'Salvando...' : `Salvar Mapeamento${dirty.length > 0 ? ` (${dirty.length})` : ''}`}
        </button>
        {message && <p className="text-sm text-text-muted" role="status">{message}</p>}
      </div>
    </div>
  );
}
