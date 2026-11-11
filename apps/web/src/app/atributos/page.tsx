'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { MERCADO_LIVRE_ACTIVE } from '../../config/channels';
import { AttributeMappingTable } from '../../components/mapping/attribute-mapping-table';
import { CategoryMappingPanel } from '../../components/mapping/category-mapping-panel';
import { MappingPlatform, MappingStudio } from '../../components/mapping/types';

type StudioTab = 'categories' | 'attributes';
type ChannelOption = { id: string; name: string };
type ConnectorAttribute = { id: string; name: string; required: boolean };

const STUDIO_PLATFORMS = new Set<MappingPlatform>(['nuvemshop', 'mercadolivre']);

function isStudioPlatform(value: string): value is MappingPlatform {
  return STUDIO_PLATFORMS.has(value as MappingPlatform);
}

export default function AtributosPage() {
  const { hasRole } = useCurrentRole();
  const canWrite = hasRole('operator', 'admin');
  const [tab, setTab] = useState<StudioTab>('categories');
  const [platform, setPlatform] = useState<string>('nuvemshop');
  const [channels, setChannels] = useState<ChannelOption[]>([{ id: 'nuvemshop', name: 'Nuvemshop' }]);
  const [studio, setStudio] = useState<MappingStudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [connectorAttributes, setConnectorAttributes] = useState<ConnectorAttribute[] | null>(null);

  useEffect(() => {
    void apiFetch<{ apps: Array<{ id: string; name: string; category: string; implemented: boolean }> }>('/api/integrations')
      .then((payload) => {
        const next = payload.apps.filter(
          (app) => app.category === 'marketplaces' && app.implemented && (app.id !== 'mercadolivre' || MERCADO_LIVRE_ACTIVE)
        );
        if (next.length > 0) setChannels(next.map((app) => ({ id: app.id, name: app.name })));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!isStudioPlatform(platform)) {
      setStudio(null);
      return;
    }
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

  const channelName = channels.find((channel) => channel.id === platform)?.name ?? platform;

  const readConnectorAttributes = async () => {
    if (!categoryId.trim()) {
      setError('Informe o ID da categoria neste canal.');
      return;
    }
    try {
      const payload = await apiFetch<{ attributes: ConnectorAttribute[] }>(
        `/api/marketplace/${platform}/category-attributes?categoryId=${encodeURIComponent(categoryId.trim())}`
      );
      setConnectorAttributes(payload.attributes);
      setError(null);
    } catch {
      setConnectorAttributes(null);
      setError('Não foi possível ler os atributos deste canal. Confira a credencial e o ID da categoria.');
    }
  };

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
            onChange={(event) => {
              setPlatform(event.target.value);
              setConnectorAttributes(null);
              setError(null);
            }}
            className="mt-1 block rounded-lg border border-border-color bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </select>
        </label>
      </header>

      {studio?.channelTreeSource === 'fixture' && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100">
          A árvore de {channelName} é um exemplo, no formato da API do canal. Quando a leitura real estiver ligada, esta tela usa a mesma resposta sem mudar o mapeamento já salvo.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-200" role="alert">{error}</p>}

      {isStudioPlatform(platform) && <div className="mt-5 flex gap-1 border-b border-border-color" role="tablist">
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
      </div>}

      <div className="mt-5">
        {!isStudioPlatform(platform) && (
          <section className="rounded-xl border border-border-color bg-bg-surface p-4">
            <h2 className="text-sm font-semibold text-text-primary">Atributos de {channelName}</h2>
            <p className="mt-1 text-sm text-text-muted">
              A lista vem do conector, com o ID da categoria no canal. O estúdio de categorias continua na Nuvemshop e no Mercado Livre.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-text-muted">
                ID da categoria
                <input
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="mt-1 block rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                />
              </label>
              <button
                type="button"
                onClick={() => void readConnectorAttributes()}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white"
              >
                Ler atributos
              </button>
            </div>
            {connectorAttributes && connectorAttributes.length === 0 && (
              <p className="mt-3 text-sm text-text-muted">Esta categoria não devolveu atributos.</p>
            )}
            {connectorAttributes && connectorAttributes.length > 0 && (
              <ul className="mt-3 divide-y divide-border-color">
                {connectorAttributes.map((attribute) => (
                  <li key={attribute.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-text-primary">{attribute.name}</span>
                    <span className="text-xs text-text-muted">{attribute.required ? 'Obrigatório' : 'Opcional'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {isStudioPlatform(platform) && !studio && !error && <p className="text-sm text-text-muted">Carregando...</p>}
        {isStudioPlatform(platform) && studio && tab === 'categories' && (
          <CategoryMappingPanel platform={platform} studio={studio} canWrite={canWrite} onSaved={load} />
        )}
        {isStudioPlatform(platform) && studio && tab === 'attributes' && (
          <AttributeMappingTable platform={platform} categories={studio.erp} fields={studio.fields} canWrite={canWrite} />
        )}
      </div>
    </main>
  );
}
