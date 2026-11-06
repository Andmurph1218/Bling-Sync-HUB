'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api-client';

interface ChecklistItem {
  code: string;
  ok: boolean;
  title: string;
}

interface SheetPayload {
  item: {
    id: string;
    sku: string;
    name: string | null;
    price: number | null;
    stock: number | null;
    checklist: { items: ChecklistItem[] };
  };
  category: { id: string; name: string } | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

export function ProductFixModal({
  blingId,
  reason,
  onClose,
  onSaved,
}: {
  blingId: string;
  reason: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<SheetPayload | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState('');

  const load = async () => {
    const [nextSheet, nextCategories] = await Promise.all([
      apiFetch<SheetPayload>(`/api/catalog/products/${blingId}/sheet`),
      apiFetch<{ categories: CategoryOption[] }>('/api/catalog/categories'),
    ]);
    setSheet(nextSheet);
    setCategories(nextCategories.categories);
  };

  useEffect(() => {
    void load().catch(() => setError('Não foi possível abrir a ficha deste produto.'));
  }, [blingId]);

  const saveCategory = async (hubCategoryId: string) => {
    if (!sheet) return;
    await apiFetch(`/api/catalog/products/${sheet.item.id}/category`, {
      method: 'PUT',
      json: { hubCategoryId: hubCategoryId || null },
    });
    setNotice('Categoria salva. A completude é recalculada na próxima leitura.');
    onSaved();
    await load();
  };

  const saveCover = async () => {
    if (!sheet || coverUrl.trim().length < 8) return;
    await apiFetch(`/api/catalog/products/${sheet.item.id}/cover`, {
      method: 'POST',
      json: { url: coverUrl.trim() },
    });
    setCoverUrl('');
    setNotice('Capa salva. A imagem passa a contar na completude.');
    onSaved();
    await load();
  };

  const pending = sheet?.item.checklist.items.filter((item) => !item.ok) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="fix-title">
      <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl border border-border-color bg-bg-base p-5">
        <h2 id="fix-title" className="text-sm font-bold text-text-primary">Corrigir produto</h2>
        <p className="mt-1 text-xs text-amber-200">{reason}</p>
        {error && <p className="mt-3 text-sm text-rose-200" role="alert">{error}</p>}
        {!sheet && !error && <p className="mt-4 text-sm text-text-muted">Abrindo a ficha...</p>}
        {sheet && (
          <div className="mt-4 space-y-4 text-xs text-text-primary">
            <div>
              <p className="text-sm font-semibold text-text-primary">{sheet.item.name ?? 'Sem nome'}</p>
              <p className="mt-1 font-mono text-emerald-300">SKU {sheet.item.sku || 'Sem SKU'}</p>
            </div>
            <p>
              Preço: {sheet.item.price !== null ? `R$ ${sheet.item.price}` : 'ausente'} · Estoque:{' '}
              {sheet.item.stock !== null ? `${sheet.item.stock} un.` : 'ainda não lido do Bling'}
            </p>
            <label className="block">
              Categoria do catálogo
              <select
                className="mt-1 w-full rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary"
                value={sheet.category?.id ?? ''}
                onChange={(event) => void saveCategory(event.target.value).catch(() => setError('Não foi possível salvar a categoria.'))}
              >
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                URL da imagem de capa
                <input
                  value={coverUrl}
                  onChange={(event) => setCoverUrl(event.target.value)}
                  className="mt-1 w-72 rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-text-primary"
                />
              </label>
              <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-text-primary" onClick={() => void saveCover().catch(() => setError('Não foi possível salvar a capa.'))}>
                Salvar capa
              </button>
            </div>
            {pending.length > 0 && (
              <ul className="space-y-1 text-amber-200">
                {pending.map((item) => (
                  <li key={item.code}>{item.title}</li>
                ))}
              </ul>
            )}
            {notice && <p className="text-emerald-300" role="status">{notice}</p>}
          </div>
        )}
        <button type="button" className="mt-4 rounded-lg border border-border-color px-3 py-1.5 text-xs text-text-primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
