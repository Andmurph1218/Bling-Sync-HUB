'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Lock, X } from 'lucide-react';
import { API_BASE_URL, ApiError, apiFetch } from '../../utils/api-client';
import { AuditEmptyState, AuditLogTable, AuditRecord } from '../../components/audit/audit-log-table';
import { EngineHealthStrip, MotorStatus } from '../../components/audit/engine-health-strip';

type Range = 'hoje' | '7d' | 'tudo' | 'custom';

interface AuditPayload {
  records: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
}

function localDay(value: string): Date | undefined {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function rangeBounds(range: Range, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (range === 'hoje') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString() };
  }
  if (range === '7d') return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() };
  if (range === 'custom') {
    const start = localDay(from);
    const end = localDay(to);
    if (end) end.setDate(end.getDate() + 1);
    return {
      from: start?.toISOString(),
      to: end?.toISOString(),
    };
  }
  return {};
}

export default function AuditoriaPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [motors, setMotors] = useState<MotorStatus[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('tudo');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [motor, setMotor] = useState('');
  const [open, setOpen] = useState<AuditRecord | null>(null);
  const pageSize = 50;

  const params = () => {
    const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedQuery.trim()) search.set('q', debouncedQuery.trim());
    if (actor.trim()) search.set('actor', actor.trim());
    if (motor) search.set('motor', motor);
    const bounds = rangeBounds(range, from, to);
    if (bounds.from) search.set('from', bounds.from);
    if (bounds.to) search.set('to', bounds.to);
    return search;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void apiFetch<{ motors?: MotorStatus[] }>('/api/dashboard/motors-diagnostic')
      .then((payload) => setMotors(payload.motors ?? []))
      .catch(() => setMotors([]));
  }, []);

  useEffect(() => {
    const search = params();
    setLoading(true);
    void apiFetch<AuditPayload>(`/api/dashboard/audit-trail?${search.toString()}`)
      .then((payload) => {
        setRecords(payload.records ?? []);
        setTotal(payload.total ?? payload.records.length);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError && err.status === 403
          ? 'Seu papel não tem acesso à trilha de auditoria.'
          : 'Não foi possível carregar a auditoria.');
      })
      .finally(() => setLoading(false));
  }, [page, debouncedQuery, range, from, to, actor, motor]);

  const exportCsv = () => {
    const search = params();
    search.set('format', 'csv');
    search.delete('page');
    void fetch(`${API_BASE_URL}/api/dashboard/audit-trail?${search.toString()}`, { credentials: 'include' }).then(async (response) => {
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'auditoria.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const actors = [...new Set(records.map((record) => record.originActor))].filter(Boolean);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Centro de auditoria e compliance</h1>
          <p className="mt-1 text-sm text-text-muted">O que mudou, quem fez e qual foi o resultado.</p>
          <details className="mt-3 text-xs text-text-muted">
            <summary className="cursor-pointer font-semibold text-text-primary">Siglas técnicas</summary>
            <p className="mt-2 max-w-xl">PIRE é o vínculo do anúncio. GVE valida o código de barras. NVE valida o NCM. CRE mede a prontidão do conteúdo.</p>
          </details>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <Lock className="h-3.5 w-3.5" />
          Tabelas imutáveis · Retenção fiscal 5 anos
        </span>
      </header>

      {motors.length > 0 && <div className="mt-4"><EngineHealthStrip motors={motors} /></div>}
      {loadError && <p role="alert" className="mt-4 text-sm text-rose-600">{loadError}</p>}

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">O que mudou</h2>
            <Link href="/auditoria/configuracoes" className="text-xs font-semibold text-text-muted underline">Configurações</Link>
          </div>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-semibold">
            <Download className="h-3.5 w-3.5" />
            Exportar logs (CSV)
          </button>
        </div>
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="SKU ou nome do produto" className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm" />
          <select value={range} onChange={(event) => { setPage(1); setRange(event.target.value as Range); }} className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm">
            <option value="tudo">Qualquer data</option>
            <option value="hoje">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="custom">Personalizado</option>
          </select>
          <input
            value={actor}
            list="audit-actors"
            onChange={(event) => { setPage(1); setActor(event.target.value); }}
            placeholder="Origem ou usuário"
            className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm"
          />
          <datalist id="audit-actors">
            <option value="Sistema (Auto)" />
            <option value="Revisor fiscal" />
            {actors.map((name) => <option key={name} value={name} />)}
          </datalist>
          <select value={motor} onChange={(event) => { setPage(1); setMotor(event.target.value); }} className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm">
            <option value="">Qualquer motor</option>
            <option value="GVE">Apenas GVE</option>
            <option value="NVE">Apenas NVE</option>
            <option value="Sistema">Apenas Sistema</option>
          </select>
        </div>
        {range === 'custom' && (
          <div className="mb-3 flex gap-2">
            <input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm" />
            <input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} className="rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm" />
          </div>
        )}
        {loading ? <p className="py-8 text-sm text-text-muted">Carregando registros…</p> : records.length === 0 && !loadError ? <AuditEmptyState /> : <AuditLogTable records={records} onOpen={setOpen} />}
        <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
          <p>Mostrando {start}-{end} de {total.toLocaleString('pt-BR')} registros</p>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded border border-border-color px-2 py-1 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={end >= total} onClick={() => setPage((current) => current + 1)} className="rounded border border-border-color px-2 py-1 disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60" onClick={() => setOpen(null)} />
          <aside role="dialog" aria-label="Detalhe do log" className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-border-color bg-bg-base shadow-2xl">
            <header className="flex items-center justify-between border-b border-border-color px-5 py-4">
              <h2 className="text-base font-semibold">Detalhe da alteração</h2>
              <button type="button" onClick={() => setOpen(null)} aria-label="Fechar"><X className="h-4 w-4" /></button>
            </header>
            <pre className="flex-1 overflow-auto p-5 font-mono text-[11px] leading-relaxed">{JSON.stringify(open, null, 2)}</pre>
          </aside>
        </div>
      )}
    </main>
  );
}
