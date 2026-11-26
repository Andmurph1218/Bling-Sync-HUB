'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { Button } from '../../components/ui/button';

interface CategoryMapping {
  id: string;
  erpCategoryId: string;
  channelId: string;
  channelCategoryId: string;
  status: 'connected' | 'divergent';
  divergences: number;
}
interface CategoryAudit {
  provider: string;
  lastSyncedAt: string | null;
  divergences: number;
  mappings: CategoryMapping[];
}

const channelName = (id: string) => ({ nuvemshop: 'Nuvemshop', mercadolivre: 'Mercado Livre' }[id] ?? id);

export default function AtributosPage() {
  const { hasRole } = useCurrentRole();
  const canSync = hasRole('admin');
  const [audit, setAudit] = useState<CategoryAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState('all');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAudit(await apiFetch<CategoryAudit>('/api/admin/category-mappings'));
      setError(null);
    } catch {
      setError('Não foi possível ler os vínculos. Tente atualizar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const synchronize = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ mappings: number }>('/api/admin/sync-category-mappings', { method: 'POST' });
      setNotice(`${result.mappings.toLocaleString('pt-BR')} ${result.mappings === 1 ? 'vínculo importado' : 'vínculos importados'} do ERP. A reconciliação dos anúncios verifica as divergências.`);
      await load();
    } catch {
      setError('Não foi possível confirmar a sincronização. Os vínculos exibidos foram preservados. Atualize a auditoria e confira a conexão do ERP antes de tentar novamente.');
    } finally {
      setSyncing(false);
    }
  };
  const channels = useMemo(() => [...new Set(audit?.mappings.map((row) => row.channelId) ?? [])], [audit]);
  const rows = audit?.mappings.filter((row) => channel === 'all' || row.channelId === channel) ?? [];
  const updatedAt = audit?.lastSyncedAt ? new Date(audit.lastSyncedAt).toLocaleString('pt-BR') : 'Ainda não sincronizado';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Auditoria de categorias</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            O ERP define as categorias de cada canal. O HUB lê os vínculos e audita os anúncios, sem criar ou editar mapeamentos.
          </p>
        </div>
        <Button variant="primary" disabled={!canSync || syncing || loading} aria-busy={syncing} onClick={() => void synchronize()}>
          <RefreshCw aria-hidden="true" size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} />
          {syncing ? 'Sincronizando com o ERP…' : 'Sincronizar Mapeamentos do ERP'}
        </Button>
      </header>
      {!canSync && <p className="mt-4 text-sm text-text-muted">Somente administradores podem sincronizar. A consulta dos vínculos é somente leitura.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-text-primary">{notice}</p>}
      {Boolean(audit?.divergences) && (
        <section role="alert" className="mt-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <AlertTriangle aria-hidden="true" size={20} className="shrink-0" />
          <div>
            <p>{audit!.divergences.toLocaleString('pt-BR')} {audit!.divergences === 1 ? 'anúncio' : 'anúncios'} com categoria diferente da definida pelo ERP na última reconciliação.</p>
            <Link href="/problemas?filtro=divergencias" className="mt-2 inline-block font-semibold underline underline-offset-4">Ver divergências em Problemas</Link>
          </div>
        </section>
      )}
      <section className="mt-8" aria-labelledby="category-mappings-title" aria-busy={loading}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="category-mappings-title" className="text-base font-semibold text-text-primary">Vínculos importados do ERP{audit ? ` · ${audit.provider}` : ''}</h2>
            <p className="mt-1 text-sm text-text-muted">Última sincronização: {updatedAt}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-text-muted">Canal
              <select value={channel} onChange={(event) => setChannel(event.target.value)} className="ml-2 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm text-text-primary">
                <option value="all">Todos os canais</option>
                {channels.map((id) => <option key={id} value={id}>{channelName(id)}</option>)}
              </select>
            </label>
            <Button disabled={loading || syncing} onClick={() => void load()}>Atualizar auditoria</Button>
          </div>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-text-muted">Conectado confirma o vínculo importado do ERP, não uma verificação ao vivo do canal. Divergente indica um alerta aberto pela reconciliação. Corrija o vínculo no ERP ou a categoria no canal; o HUB não altera esses dados automaticamente.</p>
        {loading && !audit ? <p role="status" className="py-8 text-sm text-text-muted">Carregando vínculos do ERP…</p> : audit && (
          <div role="region" aria-label="Vínculos de categorias por canal" tabIndex={0} className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
            <table className="w-full min-w-[600px] text-left text-sm">
              <caption className="sr-only">Categorias vinculadas no ERP e alertas da última reconciliação dos anúncios</caption>
              <thead className="border-b border-border-color text-text-muted">
                <tr><th scope="col" className="px-4 py-3 font-medium">Categoria ERP</th><th scope="col" className="px-4 py-3 font-medium">Canal</th><th scope="col" className="px-4 py-3 font-medium">Categoria no canal</th><th scope="col" className="px-4 py-3 font-medium">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-border-color text-text-primary">
                {rows.map((row) => <tr key={row.id} className="hover:bg-bg-base">
                  <td className="max-w-xs break-all px-4 py-4 font-mono">{row.erpCategoryId}</td>
                  <td className="px-4 py-4">{channelName(row.channelId)}</td>
                  <td className="max-w-xs break-all px-4 py-4 font-mono">{row.channelCategoryId}</td>
                  <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'divergent' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'}`}>{row.status === 'divergent' ? 'Divergente' : 'Conectado'}</span>{row.divergences > 0 && <span className="ml-2 tabular-nums text-text-muted">{row.divergences} {row.divergences === 1 ? 'anúncio' : 'anúncios'}</span>}</td>
                </tr>)}
                {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-text-muted">Nenhum vínculo encontrado. Vincule as categorias à loja correta no ERP e sincronize os mapeamentos.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
