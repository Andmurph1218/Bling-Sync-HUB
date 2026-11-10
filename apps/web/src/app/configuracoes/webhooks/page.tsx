'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../utils/api-client';
import { SettingsFrame, fieldClass } from '../../../components/settings/settings-frame';

interface Endpoint { source: string; method: string; path: string }
interface ApiKey { id: string; name: string; prefix: string; created_at: string; rotated_at: string | null }

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const [hooks, stored] = await Promise.all([
      apiFetch<{ endpoints: Endpoint[] }>('/api/admin/webhooks'),
      apiFetch<{ keys: ApiKey[] }>('/api/admin/api-keys'),
    ]);
    setEndpoints(hooks.endpoints);
    setKeys(stored.keys);
  };

  useEffect(() => { void load().catch(() => setNotice('Não foi possível ler webhooks e chaves.')); }, []);

  const create = async () => {
    const created = await apiFetch<{ secret: string }>('/api/admin/api-keys', { method: 'POST', json: { name } });
    setSecret(created.secret);
    setName('');
    await load();
  };

  const rotate = async (id: string) => {
    const rotated = await apiFetch<{ secret: string }>(`/api/admin/api-keys/${id}/rotate`, { method: 'POST' });
    setSecret(rotated.secret);
    await load();
  };

  return (
    <SettingsFrame title="Webhooks e chaves" lede="Entradas que o Bling e a Nuvemshop chamam, e chaves para integrações externas.">
      <h3 className="text-sm font-semibold text-text-primary">Endpoints de entrada</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {endpoints.map((endpoint) => (
          <li key={endpoint.path} className="rounded-lg border border-border-color px-3 py-2">
            <span className="font-medium text-text-primary">{endpoint.source}</span>
            <span className="ml-2 font-mono text-xs text-text-muted">{endpoint.method} {endpoint.path}</span>
          </li>
        ))}
      </ul>
      <h3 className="mt-6 text-sm font-semibold text-text-primary">Chaves de API</h3>
      <form className="mt-2 flex max-w-lg gap-2" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da integração" className={fieldClass} />
        <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Criar chave</button>
      </form>
      {secret && <p role="status" className="mt-3 break-all rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs">Mostrada uma vez: {secret}</p>}
      <div className="mt-4 overflow-x-auto rounded-xl border border-border-color">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-color text-[11px] uppercase text-text-muted">
            <tr className="h-10"><th className="px-3">Nome</th><th className="px-3">Prefixo</th><th className="px-3">Rotação</th><th className="px-3" /></tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-border-color">
                <td className="px-3 py-2">{key.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{key.prefix}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{key.rotated_at ? new Date(key.rotated_at).toLocaleString('pt-BR') : 'Nunca'}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => void rotate(key.id)} className="text-xs font-semibold underline">Rotacionar chave</button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-sm text-text-muted">Nenhuma chave emitida.</td></tr>}
          </tbody>
        </table>
      </div>
      {notice && <p className="mt-3 text-sm text-text-muted">{notice}</p>}
    </SettingsFrame>
  );
}
