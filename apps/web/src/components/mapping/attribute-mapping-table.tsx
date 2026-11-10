'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/api-client';
import { AttributeDraft, ChannelAttributeDefinition, ErpCategoryNode, fieldsForAttribute, MappingField, MappingPlatform, ValuePair } from './types';
import { ValueMappingModal } from './value-mapping-modal';

type RowFilter = 'all' | 'required' | 'unmapped' | 'mapped';

const FILTERS: Array<{ id: RowFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'required', label: 'Mostrar apenas obrigatórios' },
  { id: 'unmapped', label: 'Mostrar apenas não mapeados' },
  { id: 'mapped', label: 'Mostrar apenas mapeados' },
];

export function AttributeMappingTable({
  platform,
  categories,
  fields,
  canWrite,
}: {
  platform: MappingPlatform;
  categories: ErpCategoryNode[];
  fields: MappingField[];
  canWrite: boolean;
}) {
  const mapped = categories.filter((node) => node.hubCategoryId && node.channelCategoryId);
  const mappedIds = mapped.map((node) => node.hubCategoryId).join('|');
  const [hubCategoryId, setHubCategoryId] = useState(mapped[0]?.hubCategoryId ?? '');
  const [rows, setRows] = useState<AttributeDraft[]>([]);
  const [channelName, setChannelName] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [applyToChildren, setApplyToChildren] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<AttributeDraft | null>(null);

  useEffect(() => {
    const ids = mappedIds.split('|').filter(Boolean);
    if (!ids.includes(hubCategoryId)) setHubCategoryId(ids[0] ?? '');
  }, [mappedIds, hubCategoryId]);

  useEffect(() => {
    if (!hubCategoryId) {
      setRows([]);
      return;
    }
    const category = categories.find((node) => node.hubCategoryId === hubCategoryId);
    setChannelName(category?.channelCategoryName ?? '');
    setLoading(true);
    setMessage(null);
    void apiFetch<{
      attributes: ChannelAttributeDefinition[];
      maps: Array<{ channelAttributeId: string; sourceField: string | null; valueMaps: ValuePair[] }>;
    }>(`/api/catalog/mapping-studio/attributes?platform=${platform}&hubCategoryId=${hubCategoryId}`)
      .then((payload) => {
        setRows(
          payload.attributes.map((attribute) => {
            const saved = payload.maps.find((map) => map.channelAttributeId === attribute.id);
            return {
              channelAttributeId: attribute.id,
              channelAttributeName: attribute.name,
              required: attribute.required,
              recommended: attribute.recommended,
              valueType: attribute.valueType,
              values: attribute.values,
              sourceField: saved?.sourceField ?? '',
              valueMaps: saved?.valueMaps ?? [],
            };
          })
        );
      })
      .catch(() => setMessage('Não foi possível ler os atributos desta categoria.'))
      .finally(() => setLoading(false));
  }, [hubCategoryId, platform, categories]);

  const visible = rows.filter((row) => {
    if (filter === 'required') return row.required;
    if (filter === 'mapped') return Boolean(row.sourceField);
    if (filter === 'unmapped') return !row.sourceField;
    return true;
  });

  const update = (id: string, patch: Partial<AttributeDraft>) => {
    setRows((prev) => prev.map((row) => (row.channelAttributeId === id ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    const category = mapped.find((node) => node.hubCategoryId === hubCategoryId);
    if (!category?.hubCategoryId || !category.channelCategoryId || !category.channelCategoryName) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/catalog/categories/${category.hubCategoryId}/channels/${platform}`, {
        method: 'PUT',
        json: {
          channelCategoryId: category.channelCategoryId,
          channelCategoryName: category.channelCategoryName,
          applyToChildren,
          attributes: rows.map((row) => ({
            channelAttributeId: row.channelAttributeId,
            channelAttributeName: row.channelAttributeName,
            required: row.required,
            mode: row.sourceField ? 'dynamic' : 'manual',
            fixedValue: null,
            sourceField: row.sourceField || null,
            valueMaps: row.valueType === 'list' ? row.valueMaps : [],
          })),
        },
      });
      setMessage(applyToChildren ? 'Mapeamento salvo e aplicado às categorias filhas.' : 'Mapeamento salvo.');
    } catch {
      setMessage('Não foi possível salvar o mapeamento.');
    } finally {
      setSaving(false);
    }
  };

  const selected = useMemo(() => mapped.find((node) => node.hubCategoryId === hubCategoryId) ?? null, [mapped, hubCategoryId]);

  return (
    <section className="rounded-xl border border-border-color bg-bg-surface">
      <header className="flex flex-col gap-3 border-b border-border-color px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="block text-xs text-text-muted">
          Categoria já mapeada
          <select
            value={hubCategoryId}
            onChange={(event) => setHubCategoryId(event.target.value)}
            className="mt-1 block rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-sm text-text-primary"
          >
            {mapped.length === 0 && <option value="">Nenhuma categoria mapeada</option>}
            {mapped.map((node) => (
              <option key={node.hubCategoryId} value={node.hubCategoryId ?? ''}>
                {node.path.join(' > ')} → {node.channelCategoryName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${filter === item.id ? 'bg-bg-base font-semibold text-text-primary' : 'text-text-muted hover:bg-bg-base'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {loading && <p className="px-4 py-6 text-sm text-text-muted">Lendo atributos do canal...</p>}
      {!loading && mapped.length === 0 && (
        <p className="px-4 py-6 text-sm text-text-muted">Mapeie uma categoria na primeira aba para liberar os atributos.</p>
      )}
      {!loading && hubCategoryId && rows.length === 0 && mapped.length > 0 && (
        <p className="px-4 py-6 text-sm text-text-muted">Esta categoria do canal ainda não tem atributos na árvore carregada.</p>
      )}
      {!loading && visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
              <tr className="h-10">
                <th className="px-4 font-semibold">Atributo do canal</th>
                <th className="px-3 font-semibold">Campo no ERP</th>
                <th className="px-3 font-semibold">Mapeamento de valores</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const compatible = fieldsForAttribute(row.valueType, fields);
                return (
                  <tr key={row.channelAttributeId} className="border-b border-border-color">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{row.channelAttributeName}</p>
                      <p className="mt-0.5 text-[11px]">
                        {row.required && <span className="font-semibold text-rose-600 dark:text-rose-300">Obrigatório</span>}
                        {!row.required && row.recommended && <span className="font-semibold text-amber-600 dark:text-amber-300">Recomendado</span>}
                        {!row.required && !row.recommended && <span className="text-text-muted">Opcional</span>}
                        <span className="text-text-muted"> · {row.valueType === 'number' ? 'número' : row.valueType === 'list' ? 'lista' : 'texto'}</span>
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={row.sourceField}
                        onChange={(event) => update(row.channelAttributeId, { sourceField: event.target.value, valueMaps: [] })}
                        className="w-full max-w-xs rounded-md border border-border-color bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                      >
                        <option value="">Não mapear</option>
                        {compatible.map((field) => (
                          <option key={field.code} value={field.code}>
                            {field.label} · {field.type === 'number' ? 'número' : 'texto'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      {row.valueType === 'list' ? (
                        <button
                          type="button"
                          disabled={!row.sourceField}
                          title={row.sourceField ? 'Traduzir os valores do ERP' : 'Escolha o campo do ERP primeiro'}
                          onClick={() => setEditing(row)}
                          className="rounded-md border border-border-color px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                        >
                          Mapear Valores{row.valueMaps.length > 0 ? ` (${row.valueMaps.length})` : ''}
                        </button>
                      ) : (
                        <span className="text-xs text-text-muted">Valor segue direto</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="inline-flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={applyToChildren} onChange={(event) => setApplyToChildren(event.target.checked)} />
          Aplicar às categorias filhas
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canWrite || saving || !selected || rows.length === 0}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Salvando...' : 'Salvar Mapeamento'}
        </button>
        {channelName && <span className="text-xs text-text-muted">{channelName}</span>}
        {message && <p className="text-sm text-text-muted" role="status">{message}</p>}
      </footer>

      {editing && editing.sourceField && (
        <ValueMappingModal
          title={editing.channelAttributeName}
          field={editing.sourceField}
          channelValues={editing.values}
          pairs={editing.valueMaps}
          onClose={() => setEditing(null)}
          onConfirm={(pairs) => {
            update(editing.channelAttributeId, { valueMaps: pairs });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
