'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardList,
  ArrowRight,
  Filter,
  AlertTriangle,
  Lock,
  GitCompare,
  FileText,
  ImageIcon,
  DollarSign,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '../../utils/api-client';

export type PendingCategory =
  | 'ean_ausente_divergente'
  | 'ncm_divergente'
  | 'sku_sem_correspondencia'
  | 'variacao_nao_identificada'
  | 'conteudo_incompleto'
  | 'imagens_invalidas'
  | 'preco_abaixo_custo'
  | 'publicacao_falha';

interface UnifiedPendingItem {
  id: string;
  category: PendingCategory;
  categoryLabel: string;
  sku: string;
  productId: string;
  productName: string;
  channel: string;
  createdAt: string;
  reasonPlain: string;
  impactPlain: string;
  responsibleRole: 'Operador' | 'Revisor Fiscal' | 'Financeiro' | 'Administrador';
  actionLabel: string;
  actionHref: string;
  severity: 'critical' | 'warning' | 'info';
  technicalDetail: string;
}

export default function CentralPendenciasPage() {
  const [items, setItems] = useState<UnifiedPendingItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveFromDb, setLiveFromDb] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [showTech, setShowTech] = useState<boolean>(false);

  const loadPendings = async () => {
    setLoading(true);
    try {
      const json = await apiFetch<{ items?: UnifiedPendingItem[] }>('/api/dashboard/pendings');
      setItems(json.items ?? []);
      setLiveFromDb(true);
      setLoadError(null);
    } catch {
      setLiveFromDb(false);
      setLoadError('Não foi possível carregar as pendências da API. Os dados abaixo podem estar desatualizados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPendings();
  }, []);

  const filtered = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false;
    }
    if (selectedRole !== 'all' && item.responsibleRole !== selectedRole) {
      return false;
    }
    return true;
  });

  const categoryIcon = (cat: PendingCategory) => {
    switch (cat) {
      case 'ean_ausente_divergente':
      case 'ncm_divergente':
        return <Lock className="h-4 w-4 text-rose-400" />;
      case 'sku_sem_correspondencia':
      case 'variacao_nao_identificada':
        return <GitCompare className="h-4 w-4 text-sky-400" />;
      case 'conteudo_incompleto':
        return <FileText className="h-4 w-4 text-amber-400" />;
      case 'imagens_invalidas':
        return <ImageIcon className="h-4 w-4 text-purple-400" />;
      case 'preco_abaixo_custo':
        return <DollarSign className="h-4 w-4 text-rose-400" />;
      case 'publicacao_falha':
        return <RotateCcw className="h-4 w-4 text-amber-400" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ClipboardList className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-bold text-white">
              Central Unificada de Pendências
            </h1>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                liveFromDb
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {liveFromDb ? 'Lendo pendências reais do PostgreSQL' : 'Modo demonstração'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Fila única de decisões operacionais, fiscais e financeiras: cada item explica o problema, o impacto e o próximo passo claro.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTech((prev) => !prev)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white"
          >
            {showTech ? 'Ocultar códigos dos motores' : 'Exibir diagnóstico técnico'}
          </button>
          <button
            type="button"
            onClick={() => void loadPendings()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Barra de Filtros */}
      <section className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
          <Filter className="h-4 w-4 text-emerald-400" />
          <span>Filtrar fila:</span>
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200"
        >
          <option value="all">Todos os tipos de pendência</option>
          <option value="ean_ausente_divergente">EAN ausente ou divergente</option>
          <option value="ncm_divergente">NCM divergente (Dupla aprovação)</option>
          <option value="sku_sem_correspondencia">SKU sem correspondência</option>
          <option value="variacao_nao_identificada">Variação não identificada</option>
          <option value="conteudo_incompleto">Conteúdo incompleto</option>
          <option value="imagens_invalidas">Imagens duplicadas ou inválidas</option>
          <option value="preco_abaixo_custo">Preço abaixo do custo</option>
          <option value="publicacao_falha">Publicação com falha</option>
        </select>

        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200"
        >
          <option value="all">Todos os responsáveis</option>
          <option value="Operador">Responsável: Operador</option>
          <option value="Revisor Fiscal">Responsável: Revisor Fiscal</option>
          <option value="Financeiro">Responsável: Financeiro</option>
        </select>

        <span className="ml-auto text-xs text-zinc-400">
          Exibindo <strong className="text-white">{filtered.length}</strong> pendências prioritárias
        </span>
      </section>

      {loadError && (
        <div role="alert" className="mt-6 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{loadError}</span>
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span>Nenhuma pendência encontrada para os filtros selecionados.</span>
        </div>
      )}

      {loading && items.length === 0 && (
        <p className="mt-6 text-sm text-zinc-400" role="status">Carregando pendências...</p>
      )}

      {/* Lista de Pendências */}
      <section className="mt-6 space-y-4">
        {filtered.map((item) => {
          const borderTone =
            item.severity === 'critical'
              ? 'border-rose-500/35 bg-zinc-900/70'
              : item.severity === 'warning'
              ? 'border-amber-500/30 bg-zinc-900/60'
              : 'border-zinc-800 bg-zinc-900/50';

          return (
            <div
              key={item.id}
              className={`rounded-xl border p-5 transition hover:border-zinc-600 ${borderTone}`}
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white">
                      {categoryIcon(item.category)}
                      {item.categoryLabel}
                    </span>
                    <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-200">
                      Canal: {item.channel}
                    </span>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                      Responsável: {item.responsibleRole}
                    </span>
                    <span className="text-xs text-zinc-400">{item.createdAt}</span>
                  </div>

                  <div>
                    <Link
                      href={`/catalogo/${item.productId}`}
                      className="text-base font-bold text-white hover:text-emerald-300 hover:underline"
                    >
                      {item.productName}
                    </Link>
                    <span className="ml-2 font-mono text-xs font-semibold text-emerald-400">
                      SKU: {item.sku}
                    </span>
                  </div>

                  <div className="grid gap-2 pt-1 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                      <span className="block font-semibold uppercase tracking-wider text-zinc-400">
                        O que aconteceu (Motivo)
                      </span>
                      <p className="mt-1 text-zinc-200">{item.reasonPlain}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                      <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Impacto no negócio
                      </span>
                      <p className="mt-1 text-zinc-200">{item.impactPlain}</p>
                    </div>
                  </div>

                  {showTech && (
                    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
                      Diagnóstico técnico: {item.technicalDetail}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                  <Link
                    href={item.actionHref}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                  >
                    <span>{item.actionLabel}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/catalogo/${item.productId}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                  >
                    <span>Abrir Ficha Única do Produto</span>
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
