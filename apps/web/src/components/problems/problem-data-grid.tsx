'use client';

import React, { useState } from 'react';
import { AlertCircle, AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FileJson, RotateCw } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { buildBlingProductUrl } from '../../utils/matching-signals';
import { ERP_SYNC_GROUP, isErpSyncTarget, ProblemGroup, ProblemItem, ProblemSelection, ProblemSeverity } from './types';

const PAGE_SIZE = 25;
const BLING_PRODUCTS_URL = 'https://www.bling.com.br/produtos.php';

const SEVERITY: Record<ProblemSeverity, { label: string; icon: typeof AlertOctagon; className: string }> = {
  critico: { label: 'Crítico', icon: AlertOctagon, className: 'text-rose-600 dark:text-rose-400' },
  aviso: { label: 'Aviso', icon: AlertTriangle, className: 'text-orange-500 dark:text-orange-400' },
  erro: { label: 'Erro', icon: AlertCircle, className: 'text-amber-500 dark:text-amber-300' },
};

const ACTION_PRIMARY =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40';
const ACTION_OUTLINE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border-color px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-bg-base';
const ICON_BUTTON = 'rounded-md p-1.5 text-text-muted hover:bg-bg-base hover:text-text-primary';

interface Expansion {
  items: ProblemItem[];
  total: number;
  page: number;
  loading: boolean;
  error: boolean;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function SeverityIcon({ severity }: { severity: ProblemSeverity }) {
  const meta = SEVERITY[severity];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.className}`} title={meta.label}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden xl:inline">{meta.label}</span>
    </span>
  );
}

function ProductCell({ name, sku }: { name: string; sku: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-text-primary" title={name}>{name}</p>
      <p className="truncate font-mono text-[11px] text-text-muted">{sku}</p>
    </div>
  );
}

export function ProblemDataGrid({
  groups,
  selection,
  canWrite,
  canSyncErp,
  onToggleGroup,
  onToggleItem,
  onToggleAll,
  onReprocess,
  onOpenLog,
  onOpenGroup,
}: {
  groups: ProblemGroup[];
  selection: { groupKeys: Set<string>; itemIds: Map<string, string> };
  canWrite: boolean;
  canSyncErp: boolean;
  onToggleGroup: (key: string) => void;
  onToggleItem: (id: string, groupKey: string) => void;
  onToggleAll: () => void;
  onReprocess: (target: Partial<ProblemSelection>) => void;
  onOpenLog: (itemId: string) => void;
  onOpenGroup: (group: ProblemGroup) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, Expansion>>({});

  const loadPage = async (key: string, page: number) => {
    setExpanded((prev) => ({
      ...prev,
      [key]: { items: prev[key]?.items ?? [], total: prev[key]?.total ?? 0, page, loading: true, error: false },
    }));
    try {
      const result = await apiFetch<{ items: ProblemItem[]; total: number }>(
        `/api/problems/groups/${encodeURIComponent(key)}/items?page=${page}&pageSize=${PAGE_SIZE}`
      );
      setExpanded((prev) => ({
        ...prev,
        [key]: {
          items: page === 1 ? result.items : [...(prev[key]?.items ?? []), ...result.items],
          total: result.total,
          page,
          loading: false,
          error: false,
        },
      }));
    } catch {
      setExpanded((prev) => ({ ...prev, [key]: { ...(prev[key] as Expansion), loading: false, error: true } }));
    }
  };

  const toggleExpand = (key: string) => {
    if (expanded[key]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    void loadPage(key, 1);
  };

  const allSelected = groups.length > 0 && groups.every((group) => selection.groupKeys.has(group.key));

  const actionsFor = (group: ProblemGroup, item: ProblemItem | null, bulk: boolean) => {
    const blingHref = item?.blingId ? buildBlingProductUrl(item.blingId) : BLING_PRODUCTS_URL;
    const syncBlocked = !canWrite || (isErpSyncTarget(item?.id ?? group.key) && !canSyncErp);
    return (
      <div className="flex items-center justify-end gap-1.5">
        {group.action === 'bling' ? (
          <a href={blingHref} target="_blank" rel="noreferrer" className={ACTION_OUTLINE}>
            Corrigir no Bling
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            className={ACTION_PRIMARY}
            disabled={syncBlocked}
            title={
              !canWrite
                ? 'Seu perfil só pode consultar.'
                : syncBlocked
                  ? 'Apenas administradores podem forçar a leitura do Bling.'
                  : undefined
            }
            onClick={() => onReprocess(item ? { itemIds: [item.id] } : { groupKeys: [group.key] })}
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            {bulk ? 'Reprocessar Todos em Lote' : 'Reprocessar'}
          </button>
        )}
        <button
          type="button"
          className={ICON_BUTTON}
          onClick={() => (item ? onOpenLog(item.id) : onOpenGroup(group))}
          title="Ver detalhes"
          aria-label="Ver detalhes"
        >
          <FileJson className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-16" />
          <col className="w-28" />
          <col className="w-56" />
          <col className="w-28" />
          <col />
          <col className="w-32" />
          <col className="w-64" />
        </colgroup>
        <thead className="border-b border-border-color bg-bg-base/60 text-[11px] uppercase tracking-wide text-text-muted">
          <tr className="h-10">
            <th className="px-3">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Selecionar todos os grupos" />
            </th>
            <th className="px-2 font-semibold">Gravidade</th>
            <th className="px-2 font-semibold">Produto / SKU</th>
            <th className="px-2 font-semibold">Tipo de falha</th>
            <th className="px-2 font-semibold">Mensagem de erro</th>
            <th className="px-2 font-semibold">Data/Hora</th>
            <th className="px-3 text-right font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const single = group.count === 1 ? group.single ?? null : null;
            const expansion = expanded[group.key];
            const groupSelected = selection.groupKeys.has(group.key);
            const expandable = !single;
            return (
              <React.Fragment key={group.key}>
                <tr className={`h-14 border-b border-border-color ${groupSelected ? 'bg-sky-500/5' : 'hover:bg-bg-base/60'}`}>
                  <td className="px-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        onChange={() => onToggleGroup(group.key)}
                        aria-label={`Selecionar ${group.groupMessage}`}
                      />
                      {expandable && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(group.key)}
                          className="rounded p-0.5 text-text-muted hover:text-text-primary"
                          aria-expanded={Boolean(expansion)}
                          aria-label={expansion ? 'Recolher SKUs' : 'Ver SKUs'}
                        >
                          {expansion ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2"><SeverityIcon severity={group.severity} /></td>
                  <td className="px-2">
                    {single ? (
                      <ProductCell name={single.name} sku={single.sku} />
                    ) : (
                      <button type="button" onClick={() => toggleExpand(group.key)} className="min-w-0 text-left">
                        <p className="text-sm font-semibold tabular-nums text-text-primary">{group.count.toLocaleString('pt-BR')} itens</p>
                        <p className="text-[11px] text-text-muted">{expansion ? 'Recolher SKUs' : 'Expandir para ver SKUs'}</p>
                      </button>
                    )}
                  </td>
                  <td className="px-2">
                    <span className="inline-flex rounded-full border border-border-color px-2 py-0.5 text-[11px] font-medium text-text-primary">
                      {group.failureType}
                    </span>
                  </td>
                  <td className="px-2">
                    <p className="truncate text-sm text-text-primary" title={single ? single.message : group.groupMessage}>
                      {single ? single.message : group.groupMessage}
                    </p>
                    <p className="truncate text-[11px] text-text-muted">{group.channel}</p>
                  </td>
                  <td className="px-2 text-xs tabular-nums text-text-muted">{formatDate(single?.occurredAt ?? group.lastAt)}</td>
                  <td className="px-3">{actionsFor(group, single, !single && group.count > 1)}</td>
                </tr>
                {expansion && (
                  <>
                    {expansion.items.map((item) => (
                      <tr key={item.id} className="h-12 border-b border-border-color bg-bg-base/40 text-xs">
                        <td className="px-3 pl-9">
                          <input
                            type="checkbox"
                            checked={groupSelected || selection.itemIds.has(item.id)}
                            disabled={groupSelected}
                            onChange={() => onToggleItem(item.id, group.key)}
                            aria-label={`Selecionar ${item.sku}`}
                          />
                        </td>
                        <td className="px-2"><SeverityIcon severity={group.severity} /></td>
                        <td className="px-2"><ProductCell name={item.name} sku={item.sku} /></td>
                        <td className="px-2 text-text-muted">{group.failureType}</td>
                        <td className="px-2"><p className="truncate text-text-primary" title={item.message}>{item.message}</p></td>
                        <td className="px-2 tabular-nums text-text-muted">{formatDate(item.occurredAt)}</td>
                        <td className="px-3">{group.key === ERP_SYNC_GROUP ? null : actionsFor(group, item, false)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-border-color bg-bg-base/40">
                      <td colSpan={7} className="px-3 py-2 pl-9 text-xs text-text-muted">
                        {expansion.error && <span className="text-rose-600 dark:text-rose-300">Não foi possível carregar os SKUs. </span>}
                        {expansion.loading
                          ? 'Carregando SKUs...'
                          : `Mostrando ${expansion.items.length.toLocaleString('pt-BR')} de ${expansion.total.toLocaleString('pt-BR')}.`}
                        {group.key === ERP_SYNC_GROUP && ' A leitura de estoque é feita para o catálogo inteiro, pelo botão do grupo.'}
                        {!expansion.loading && expansion.items.length < expansion.total && (
                          <button
                            type="button"
                            className="ml-2 font-semibold text-text-primary underline"
                            onClick={() => void loadPage(group.key, expansion.page + 1)}
                          >
                            Carregar mais {PAGE_SIZE}
                          </button>
                        )}
                      </td>
                    </tr>
                  </>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
