'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api-client';

interface Category {
  id: string;
  parent_id: string | null;
  name: string;
}

interface Spec {
  id: string;
  name: string;
  required: boolean;
}

interface DraftAttr {
  channelAttributeId: string;
  channelAttributeName: string;
  required: boolean;
  mode: 'fixed' | 'dynamic' | 'manual';
  fixedValue: string;
  sourceField: string;
}

const FIXTURES = {
  mercadolivre: { id: 'MLB999001', name: 'Lâmpadas' },
  nuvemshop: { id: 'ns-cat-lamps', name: 'Lâmpadas' },
} as const;

export default function AtributosPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [platform, setPlatform] = useState<'mercadolivre' | 'nuvemshop'>('mercadolivre');
  const [draft, setDraft] = useState<DraftAttr[]>([]);
  const [green, setGreen] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const payload = await apiFetch<{ categories: Category[] }>('/api/catalog/categories');
    setCategories(payload.categories);
  };

  useEffect(() => {
    void load().catch(() => setMessage('Não foi possível ler as categorias.'));
  }, []);

  const loadSpecs = async () => {
    const fixture = FIXTURES[platform];
    const specs = await apiFetch<{ known: boolean; attributes: Spec[] }>(
      `/api/catalog/channel-attributes?platform=${platform}&channelCategoryId=${fixture.id}`
    );
    setDraft(
      specs.attributes.map((attribute) => ({
        channelAttributeId: attribute.id,
        channelAttributeName: attribute.name,
        required: attribute.required,
        mode: attribute.id === 'BRAND' || attribute.id === 'brand' ? 'dynamic' : 'fixed',
        fixedValue: '',
        sourceField: attribute.id === 'BRAND' || attribute.id === 'brand' ? 'brand' : '',
      }))
    );
    setGreen(null);
  };

  const save = async () => {
    if (!categoryId) return;
    const fixture = FIXTURES[platform];
    await apiFetch(`/api/catalog/categories/${categoryId}/channels/${platform}`, {
      method: 'PUT',
      json: {
        channelCategoryId: fixture.id,
        channelCategoryName: fixture.name,
        attributes: draft.map((row) => ({
          channelAttributeId: row.channelAttributeId,
          channelAttributeName: row.channelAttributeName,
          required: row.required,
          mode: row.mode,
          fixedValue: row.mode === 'fixed' ? row.fixedValue : null,
          sourceField: row.mode === 'dynamic' ? row.sourceField : null,
        })),
      },
    });
    const resolved = draft
      .filter((row) => row.required)
      .every((row) => (row.mode === 'fixed' ? row.fixedValue.trim() : row.mode === 'dynamic' ? row.sourceField.trim() : true));
    setGreen(resolved);
    setMessage(resolved ? 'Categoria verde: obrigatórios resolvidos.' : 'Ainda há obrigatório sem valor ou origem.');
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Atributos</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Mapeie uma vez por categoria do catálogo e canal. Verde só quando todo obrigatório está resolvido.
      </p>
      {message && <p className="mt-4 text-sm text-zinc-200" role="status">{message}</p>}

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-sm font-semibold text-white">Categorias do catálogo</h2>
        <ul className="mt-2 space-y-1 text-xs text-zinc-300">
          {categories.length === 0 && <li>Nenhuma categoria. Um produto sem categoria aparece em Completude.</li>}
          {categories.map((category) => (
            <li key={category.id}>{category.name}</li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome da categoria"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          />
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
            onClick={() => {
              void apiFetch('/api/catalog/categories', { method: 'POST', json: { name } })
                .then(() => {
                  setName('');
                  return load();
                })
                .catch(() => setMessage('Não foi possível criar a categoria.'));
            }}
          >
            Criar
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-sm font-semibold text-white">Mapa categoria × canal</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as 'mercadolivre' | 'nuvemshop')}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            <option value="mercadolivre">Mercado Livre</option>
            <option value="nuvemshop">Nuvemshop</option>
          </select>
          <button type="button" onClick={() => void loadSpecs().catch(() => setMessage('Fixture de atributos indisponível.'))} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-white">
            Ler atributos da categoria do canal
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {draft.map((row, index) => (
            <div key={row.channelAttributeId} className="grid gap-2 rounded-lg border border-zinc-800 p-3 sm:grid-cols-4">
              <div className="text-xs text-zinc-200">
                {row.channelAttributeName}
                {row.required ? ' (obrigatório)' : ' (opcional)'}
              </div>
              <select
                value={row.mode}
                onChange={(event) => {
                  const mode = event.target.value as DraftAttr['mode'];
                  setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, mode } : item)));
                }}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
              >
                <option value="fixed">Fixo</option>
                <option value="dynamic">Dinâmico</option>
                <option value="manual">Manual</option>
              </select>
              {row.mode === 'fixed' && (
                <input
                  value={row.fixedValue}
                  onChange={(event) =>
                    setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, fixedValue: event.target.value } : item)))
                  }
                  placeholder="Valor fixo"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
                />
              )}
              {row.mode === 'dynamic' && (
                <input
                  value={row.sourceField}
                  onChange={(event) =>
                    setDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, sourceField: event.target.value } : item)))
                  }
                  placeholder="brand, name ou eixo"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
                />
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => void save().catch(() => setMessage('Não foi possível salvar o mapa.'))} className="mt-4 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
          Salvar mapa
        </button>
        {green !== null && (
          <p className={`mt-3 text-sm font-semibold ${green ? 'text-emerald-300' : 'text-amber-300'}`}>
            {green ? 'Verde' : 'Ainda não está verde'}
          </p>
        )}
      </section>
    </main>
  );
}
