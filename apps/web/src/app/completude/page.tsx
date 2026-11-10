'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Fingerprint, Megaphone, ReceiptText, RefreshCw } from 'lucide-react';
import { API_BASE_URL, apiFetch } from '../../utils/api-client';
import { useCurrentRole } from '../../components/app-shell';
import { QualityMetricRow, QualityTone } from '../../components/quality-metric-row';

type MetricCode = 'sku' | 'duplicate' | 'stock' | 'ncm' | 'ean' | 'dimensions' | 'cover' | 'hub_category' | 'content';

interface QualitySummary {
  total: number;
  metrics: Record<MetricCode, number>;
}

const BLING_PRODUCTS_URL = 'https://www.bling.com.br/produtos.php';

const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50';
const OUTLINE_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg border border-border-color px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-base';

function catalogHref(code: string): string {
  return `/catalogo?status=todos&pendencia=${code}`;
}

async function downloadCsv(path: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error('download_failed');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function QualityBlock({
  title,
  subtitle,
  tone,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  tone: QualityTone;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const accent = {
    red: 'border-l-rose-500 text-rose-600 dark:text-rose-300',
    orange: 'border-l-orange-500 text-orange-600 dark:text-orange-300',
    yellow: 'border-l-amber-400 text-amber-600 dark:text-amber-300',
  }[tone];
  return (
    <section className={`overflow-hidden rounded-xl border border-border-color border-l-4 bg-bg-surface ${accent}`}>
      <header className="flex items-start gap-3 border-b border-border-color px-4 py-3">
        <span className="mt-0.5">{icon}</span>
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
      </header>
      <ul className="divide-y divide-border-color">{children}</ul>
    </section>
  );
}

export default function CompletudePage() {
  const { hasRole } = useCurrentRole();
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSummary(await apiFetch<QualitySummary>('/api/catalog/quality'));
      setError(null);
    } catch {
      setError('Não foi possível ler os indicadores de qualidade.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const exportGap = (code?: MetricCode) => {
    setNotice(null);
    const path = code ? `/api/catalog/quality/export.csv?gap=${code}` : '/api/catalog/quality/export.csv';
    const fileName = code ? `qualidade-${code}.csv` : 'relatorio-qualidade.csv';
    void downloadCsv(path, fileName).catch(() => setNotice('Não foi possível gerar o CSV.'));
  };

  const forceStockRead = async () => {
    setNotice(null);
    try {
      await apiFetch('/api/admin/sync-full', { method: 'POST' });
      setNotice('Leitura completa do Bling iniciada. Os números atualizam quando ela terminar.');
    } catch {
      setNotice('Não foi possível iniciar a leitura do Bling.');
    }
  };

  const total = summary?.total ?? 0;
  const metric = (code: MetricCode) => summary?.metrics[code] ?? 0;
  const catalogLink = (code: string) => (
    <Link href={catalogHref(code)} className={OUTLINE_BUTTON}>
      Abrir no catálogo
    </Link>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border-color pb-6 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Qualidade de Dados</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">
            Use este painel para identificar o que falta no seu catálogo. Produtos com bloqueios em vermelho
            (Identificação) não podem ser publicados. Os em laranja (Fiscal) precisam de aprovação. Os em amarelo
            (Marketing) podem ser publicados, mas terão baixa conversão.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => void load()} className={OUTLINE_BUTTON}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button type="button" onClick={() => exportGap()} className={PRIMARY_BUTTON} disabled={!summary}>
            <Download className="h-3.5 w-3.5" />
            Exportar Relatório de Qualidade (CSV)
          </button>
        </div>
      </header>

      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-200" role="alert">{error}</p>}
      {notice && <p className="mt-4 text-sm text-text-muted" role="status">{notice}</p>}

      {summary && (
        <>
          <p className="mt-4 text-xs text-text-muted">
            Base: <span className="font-semibold tabular-nums text-text-primary">{total.toLocaleString('pt-BR')}</span> produtos ativos (arquivados ficam de fora).
          </p>
          <div className="mt-4 space-y-6">
            <QualityBlock
              tone="red"
              title="Integridade de Identificação"
              subtitle="Bloqueia a publicação. Sem isso o produto não pode ir para nenhum canal."
              icon={<Fingerprint className="h-5 w-5" aria-hidden="true" />}
            >
              <QualityMetricRow
                title="Sem SKU"
                value={metric('sku')}
                total={total}
                tone="red"
                healthyLabel="com SKU"
                onDownload={() => exportGap('sku')}
                actions={
                  <>
                    <a href={BLING_PRODUCTS_URL} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON}>Corrigir no Bling</a>
                    {catalogLink('sku')}
                  </>
                }
              />
              <QualityMetricRow
                title="Possível Duplicata"
                value={metric('duplicate')}
                total={total}
                tone="red"
                healthyLabel="sem EAN repetido"
                onDownload={() => exportGap('duplicate')}
                actions={<Link href={catalogHref('duplicate')} className={PRIMARY_BUTTON}>Revisar no Catálogo</Link>}
              />
              <QualityMetricRow
                title="Sem Leitura de Estoque"
                value={metric('stock')}
                total={total}
                tone="red"
                healthyLabel="com estoque lido do Bling"
                onDownload={() => exportGap('stock')}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => void forceStockRead()}
                      disabled={!hasRole('admin')}
                      title={hasRole('admin') ? 'Dispara uma leitura completa do Bling' : 'Apenas administradores'}
                      className={PRIMARY_BUTTON}
                    >
                      Forçar Leitura
                    </button>
                    {catalogLink('stock')}
                  </>
                }
              />
            </QualityBlock>

            <QualityBlock
              tone="orange"
              title="Fiscal e Logística"
              subtitle="Precisa de aprovação fiscal ou de dados de envio antes de publicar."
              icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />}
            >
              <QualityMetricRow
                title="Sem NCM Válido"
                value={metric('ncm')}
                total={total}
                tone="orange"
                healthyLabel="com NCM válido"
                onDownload={() => exportGap('ncm')}
                actions={
                  <>
                    <Link href="/fiscal/ncm" className={PRIMARY_BUTTON}>Ir para Fila Fiscal</Link>
                    <button type="button" onClick={() => exportGap('ncm')} className={OUTLINE_BUTTON}>Exportar Lista</button>
                    {catalogLink('ncm')}
                  </>
                }
              />
              <QualityMetricRow
                title="Sem EAN"
                value={metric('ean')}
                total={total}
                tone="orange"
                healthyLabel="com EAN válido ou sem exigência de EAN"
                onDownload={() => exportGap('ean')}
                actions={
                  <>
                    <Link href="/fiscal/ean" className={PRIMARY_BUTTON}>Ir para Fila de EAN</Link>
                    {catalogLink('ean')}
                  </>
                }
              />
              <QualityMetricRow
                title="Sem Peso e Dimensões"
                value={metric('dimensions')}
                total={total}
                tone="orange"
                healthyLabel="com peso, largura, altura e profundidade"
                onDownload={() => exportGap('dimensions')}
                actions={
                  <>
                    <a href={BLING_PRODUCTS_URL} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON}>Corrigir no Bling</a>
                    {catalogLink('dimensions')}
                  </>
                }
              />
            </QualityBlock>

            <QualityBlock
              tone="yellow"
              title="Conteúdo e Marketing"
              subtitle="Pode publicar, mas o anúncio tende a converter pouco."
              icon={<Megaphone className="h-5 w-5" aria-hidden="true" />}
            >
              <QualityMetricRow
                title="Sem Imagem de Capa"
                value={metric('cover')}
                total={total}
                tone="yellow"
                healthyLabel="com imagem de capa"
                onDownload={() => exportGap('cover')}
                actions={<Link href={catalogHref('cover')} className={PRIMARY_BUTTON}>Otimizar Imagens</Link>}
              />
              <QualityMetricRow
                title="Sem Categoria"
                value={metric('hub_category')}
                total={total}
                tone="yellow"
                healthyLabel="com categoria do HUB"
                onDownload={() => exportGap('hub_category')}
                actions={
                  <>
                    <Link href="/atributos" className={PRIMARY_BUTTON}>Mapear Categorias em Massa</Link>
                    {catalogLink('hub_category')}
                  </>
                }
              />
              <QualityMetricRow
                title="Sem Atributos/Descrição"
                value={metric('content')}
                total={total}
                tone="yellow"
                healthyLabel="com atributos de canal e descrição"
                onDownload={() => exportGap('content')}
                actions={
                  <>
                    <Link href="/atributos" className={PRIMARY_BUTTON}>Enriquecer em Massa</Link>
                    {catalogLink('content')}
                  </>
                }
              />
            </QualityBlock>
          </div>
        </>
      )}
    </main>
  );
}
