'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useCurrentRole } from '../../../components/app-shell';
import { ApiError, apiFetch } from '../../../utils/api-client';

interface Warehouse {
  bling_warehouse_id: string;
  name: string;
  role: string;
  include_in_push: boolean;
  variants: number;
  saldo_virtual: number;
  updated_at: string | null;
}

const ROLE_OPTIONS = [
  { id: 'seller', label: 'Venda', hint: 'Soma no estoque enviado aos canais.' },
  { id: 'ml_full', label: 'Full', hint: 'Estoque no centro do Mercado Livre. Nunca é enviado.' },
  { id: 'damaged', label: 'Avaria', hint: 'Fora de venda. Não aparece no catálogo nem é enviado.' },
] as const;

const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function DepositosPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const { hasRole } = useCurrentRole();
  const isAdmin = hasRole('admin');

  const load = async () => {
    try {
      const body = await apiFetch<{ warehouses: Warehouse[] }>('/api/warehouses');
      setWarehouses(body.warehouses);
      setLoadError(null);
    } catch {
      setLoadError('Não foi possível carregar os depósitos.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const classify = async (warehouse: Warehouse, role: string) => {
    if (!warehouses || (role === warehouse.role && warehouse.include_in_push === (role === 'seller'))) return;
    const previous = warehouses;
    setSavingId(warehouse.bling_warehouse_id);
    setNotice(null);
    setWarehouses(previous.map((row) => (
      row.bling_warehouse_id === warehouse.bling_warehouse_id
        ? { ...row, role, include_in_push: role === 'seller' }
        : row
    )));
    try {
      const saved = await apiFetch<{ recomputedVariants: number | null }>(
        `/api/admin/warehouses/${encodeURIComponent(warehouse.bling_warehouse_id)}`,
        { method: 'PUT', json: { name: warehouse.name, role, include_in_push: role === 'seller' } }
      );
      setNotice({
        tone: 'ok',
        text: saved.recomputedVariants === null
          ? `${warehouse.name} classificado. O estoque será recalculado no próximo sync.`
          : `${warehouse.name} classificado. Estoque recalculado em ${plural(saved.recomputedVariants, 'variação', 'variações')}.`,
      });
    } catch {
      setWarehouses(previous);
      setNotice({ tone: 'error', text: `Não foi possível salvar ${warehouse.name}. A classificação anterior foi mantida.` });
    } finally {
      setSavingId(null);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setNotice(null);
    try {
      const body = await apiFetch<{ warehouses: Warehouse[] }>('/api/admin/warehouses/discover', { method: 'POST' });
      const added = body.warehouses.length - (warehouses?.length ?? 0);
      setWarehouses(body.warehouses);
      setNotice({
        tone: 'ok',
        text: added > 0
          ? `${plural(added, 'depósito novo encontrado', 'depósitos novos encontrados')} no Bling. Classifique abaixo.`
          : 'Lista atualizada. Nenhum depósito novo no Bling.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError && error.status === 502
          ? error.message
          : 'Não foi possível buscar os depósitos no Bling.',
      });
    } finally {
      setDiscovering(false);
    }
  };

  const sellers = (warehouses ?? []).filter((row) => row.role === 'seller' && row.include_in_push);
  const unclassified = (warehouses ?? []).filter((row) => row.role === 'unclassified');

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Depósitos</h1>
          <p className="mt-1 text-sm text-text-muted">
            O estoque enviado aos canais soma só os depósitos de Venda. O catálogo mostra Venda e os não classificados; Full e Avaria ficam de fora dos dois.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void discover()}
            disabled={discovering}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm font-semibold text-text-primary transition hover:bg-bg-base focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
          >
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {discovering ? 'Buscando no Bling…' : 'Buscar depósitos no Bling'}
          </button>
        )}
      </header>

      {loadError && <p role="alert" className="mt-6 text-sm text-rose-600 dark:text-rose-400">{loadError}</p>}

      {!warehouses && !loadError && (
        <div className="mt-6 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-bg-surface" />)}
        </div>
      )}

      {warehouses && (
        <>
          {sellers.length === 0 && warehouses.length > 0 && (
            <p role="status" className="mt-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Nenhum depósito de venda classificado. Nenhum produto entra na lista de envio até você marcar pelo menos um depósito como Venda.
              </span>
            </p>
          )}
          {sellers.length > 0 && unclassified.length > 0 && (
            <p role="status" className="mt-6 text-sm text-text-muted">
              {plural(unclassified.length, 'depósito sem classificação', 'depósitos sem classificação')}. O saldo aparece no catálogo, mas não é enviado aos canais.
            </p>
          )}
          {notice && (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`mt-4 text-sm ${notice.tone === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}
            >
              {notice.text}
            </p>
          )}
          {!isAdmin && (
            <p className="mt-4 text-sm text-text-muted">Só administradores podem alterar a classificação.</p>
          )}

          {warehouses.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-border-color px-6 py-10 text-center">
              <p className="font-semibold text-text-primary">Nenhum depósito importado ainda</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
                Os depósitos aparecem aqui depois do primeiro sync de estoque ou quando você busca a lista no Bling.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border-color text-xs text-text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Depósito</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Variações com saldo</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Saldo virtual</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((warehouse) => {
                    const saving = savingId === warehouse.bling_warehouse_id;
                    const locked = !isAdmin || savingId !== null;
                    return (
                      <tr key={warehouse.bling_warehouse_id} className="border-b border-border-color last:border-b-0">
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text-primary">{warehouse.name}</span>
                            {warehouse.role === 'unclassified' && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                                Não classificado
                              </span>
                            )}
                            {warehouse.role === 'seller' && !warehouse.include_in_push && (
                              <span
                                title="Este depósito não soma no estoque enviado. Clique em Venda para ligar o envio."
                                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200"
                              >
                                Venda sem envio
                              </span>
                            )}
                            {warehouse.role === 'other' && (
                              <span className="rounded-full bg-bg-base px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                                Outro, fora do envio
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-text-muted">ID no Bling {warehouse.bling_warehouse_id}</p>
                        </td>
                        <td className="px-4 py-3 text-right align-middle tabular-nums text-text-muted">
                          {quantity.format(warehouse.variants)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle font-medium tabular-nums text-text-primary">
                          {quantity.format(warehouse.saldo_virtual)}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <fieldset className="flex items-center gap-2" disabled={locked}>
                            <legend className="sr-only">Classificação de {warehouse.name}</legend>
                            <div className="inline-flex rounded-lg border border-border-color bg-bg-base p-0.5">
                              {ROLE_OPTIONS.map((option) => (
                                <label key={option.id} title={option.hint} className="relative">
                                  <input
                                    type="radio"
                                    name={`role-${warehouse.bling_warehouse_id}`}
                                    value={option.id}
                                    checked={warehouse.role === option.id}
                                    readOnly
                                    onClick={() => void classify(warehouse, option.id)}
                                    className="peer sr-only"
                                  />
                                  <span className="block cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold text-text-muted transition peer-checked:bg-bg-surface peer-checked:text-text-primary peer-checked:shadow-[0_1px_2px_rgba(0,0,0,0.12)] peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 hover:text-text-primary">
                                    {option.label}
                                  </span>
                                </label>
                              ))}
                            </div>
                            {saving && <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-label="Salvando" />}
                          </fieldset>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
