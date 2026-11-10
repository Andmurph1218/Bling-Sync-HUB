'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { AttributeMappingTable } from '../../components/mapping/attribute-mapping-table';
import { CategoryMappingPanel } from '../../components/mapping/category-mapping-panel';
import { MappingPlatform, MappingStudio } from '../../components/mapping/types';

type StudioTab = 'categories' | 'attributes';

export default function AtributosPage() {
  const { hasRole } = useCurrentRole();
  const canWrite = hasRole('operator', 'admin');
  const [tab, setTab] = useState<StudioTab>('categories');
  const [platform, setPlatform] = useState<MappingPlatform>('nuvemshop');
  const [studio, setStudio] = useState<MappingStudio | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStudio(await apiFetch<MappingStudio>(`/api/catalog/mapping-studio?platform=${platform}`));
      setError(null);
    } catch {
      setStudio(null);
      setError('Não foi possível ler o estúdio de mapeamento.');
    }
  }, [platform]);

  useEffect(() => {
    void load();
  }, [load]);

  const channelName = platform === 'nuvemshop' ? 'Nuvemshop' : 'Mercado Livre';

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Data Mapping Studio</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">
            Mapeie a categoria do ERP para a categoria do canal e, em seguida, traduza os atributos e os valores.
            O que você salvar vale para todos os produtos daquela categoria.
          </p>
        </div>
        <label className="text-xs text-text-muted">
          Canal de destino
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as MappingPlatform)}
            className="mt-1 block rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="nuvemshop">Nuvemshop</option>
            {MERCADO_LIVRE_ACTIVE && <option value="mercadolivre">Mercado Livre</option>}
          </select>
        </label>
      </header>

      {studio?.channelTreeSource === 'fixture' && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100">
          A árvore de {channelName} é um exemplo, no formato da API do canal. Quando a leitura real estiver ligada, esta tela usa a mesma resposta sem mudar o mapeamento já salvo.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-200" role="alert">{error}</p>}

      <div className="mt-5 flex gap-1 border-b border-border-color" role="tablist">
        {([
          ['categories', 'Mapeamento de Categorias'],
          ['attributes', 'Mapeamento de Atributos e Valores'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === id ? 'border-emerald-600 font-semibold text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {!studio && !error && <p className="text-sm text-text-muted">Carregando...</p>}
        {studio && tab === 'categories' && (
          <CategoryMappingPanel platform={platform} studio={studio} canWrite={canWrite} onSaved={load} />
        )}
        {studio && tab === 'attributes' && (
          <AttributeMappingTable platform={platform} categories={studio.erp} fields={studio.fields} canWrite={canWrite} />
        )}
      </div>
    </main>
  );
}
