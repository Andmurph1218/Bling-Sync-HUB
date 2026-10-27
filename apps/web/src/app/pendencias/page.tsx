'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';

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
  channel: 'Bling ERP' | 'Mercado Livre' | 'Nuvemshop' | 'Multi-canal';
  createdAt: string;
  reasonPlain: string;
  impactPlain: string;
  responsibleRole: 'Operador' | 'Revisor Fiscal' | 'Financeiro' | 'Administrador';
  actionLabel: string;
  actionHref: string;
  severity: 'critical' | 'warning' | 'info';
  technicalDetail: string;
}

const UNIFIED_PENDINGS: UnifiedPendingItem[] = [
  {
    id: 'pend-1',
    category: 'ean_ausente_divergente',
    categoryLabel: 'EAN ausente ou divergente',
    sku: 'Sem SKU (Bling #16719381290)',
    productId: '16719381290',
    productName: 'CONTATOR AUXILIAR 2NA+2NF',
    channel: 'Bling ERP',
    createdAt: 'Hoje, 15:42',
    reasonPlain:
      'O produto está sem código de barras (GTIN/EAN) válido no Bling; o Mercado Livre possui um EAN sugerido aguardando conferência.',
    impactPlain:
      'Bloqueia a criação de novos anúncios e a atualização de ficha técnica (estoque e pausa continuam normais).',
    responsibleRole: 'Revisor Fiscal',
    actionLabel: 'Comparar fontes e enviar para aprovação',
    actionHref: '/fiscal/ean',
    severity: 'critical',
    technicalDetail: 'Motor GVE · blocker: ean_invalid_or_risk · Tabela: ean_pending_validation',
  },
  {
    id: 'pend-2',
    category: 'ncm_divergente',
    categoryLabel: 'NCM divergente',
    sku: 'Mercurio 400w e40',
    productId: '16723377536',
    productName: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    channel: 'Mercado Livre',
    createdAt: 'Hoje, 14:18',
    reasonPlain:
      'Sugestão de NCM 8539.32.00 já recebeu a 1ª confirmação fiscal, mas exige a 2ª confirmação por outro revisor com nota da TIPI.',
    impactPlain:
      'Publicação de conteúdo retida até conclusão da dupla confirmação fiscal.',
    responsibleRole: 'Revisor Fiscal',
    actionLabel: 'Concluir 2ª aprovação de NCM',
    actionHref: '/fiscal/ncm',
    severity: 'critical',
    technicalDetail: 'Motor NVE · status: pending_second · Constraint: second_review_by <> first_review_by',
  },
  {
    id: 'pend-3',
    category: 'sku_sem_correspondencia',
    categoryLabel: 'SKU sem correspondência',
    sku: '13621',
    productId: '16722020114',
    productName: 'Isolador Epoxi Paralelo Barramento 30x30x3/8 Cx. 10un.',
    channel: 'Nuvemshop',
    createdAt: 'Hoje, 13:50',
    reasonPlain:
      'O SKU coincide com o anúncio NS-314517886, mas o título no canal é diferente. Exige confirmação humana antes de vincular.',
    impactPlain:
      'Enquanto não vinculado, o HUB não enriquece conteúdo nem sincroniza este anúncio.',
    responsibleRole: 'Operador',
    actionLabel: 'Comparar candidatos e confirmar vínculo',
    actionHref: '/matching',
    severity: 'warning',
    technicalDetail: 'Motor PIRE · score: 78/100 · sinal: sku_exact + title_divergent_warning',
  },
  {
    id: 'pend-4',
    category: 'variacao_nao_identificada',
    categoryLabel: 'Variação não identificada',
    sku: 'Infra Ray 220V 250W - Kit 5',
    productId: '16723148832',
    productName: 'Kit 5 un. Lâmpada Infravermelha 220V Aquecimento Secagem 250W',
    channel: 'Mercado Livre',
    createdAt: 'Ontem, 19:10',
    reasonPlain:
      'A família User Product MLBU-FAM-882910 possui itens que apontam para 2 produtos pais diferentes no Bling.',
    impactPlain:
      'Família colocada em quarentena para evitar partir o agrupamento do Mercado Livre.',
    responsibleRole: 'Operador',
    actionLabel: 'Conferir produto pai, voltagem e SKU',
    actionHref: '/matching',
    severity: 'critical',
    technicalDetail: 'Motor PIRE/VIR · status: quarantine · family_multi_parent_conflict',
  },
  {
    id: 'pend-5',
    category: 'conteudo_incompleto',
    categoryLabel: 'Conteúdo incompleto',
    sku: 'Infra Ray 220V 250W',
    productId: '16722891360',
    productName: 'Lâmpada Infravermelha 220V Aquecimento Secagem 250W',
    channel: 'Multi-canal',
    createdAt: 'Ontem, 18:05',
    reasonPlain:
      'Descrição técnica abaixo de 180 caracteres para o Mercado Livre e campos de SEO (tags e meta description) vazios na Nuvemshop.',
    impactPlain:
      'Nota de prontidão (38/100 no ML e 34/100 na Nuvemshop) abaixo do mínimo exigido para publicação.',
    responsibleRole: 'Operador',
    actionLabel: 'Editar ou aprovar título, descrição e SEO',
    actionHref: '/catalogo/16722891360',
    severity: 'warning',
    technicalDetail: 'Motores CQS + CRE · blockers: score_ml_below_50, score_ns_below_45',
  },
  {
    id: 'pend-6',
    category: 'imagens_invalidas',
    categoryLabel: 'Imagens duplicadas ou inválidas',
    sku: 'Mercurio 400w e40',
    productId: '16723377536',
    productName: 'Lâmpada Vapor Mercúrio 400w Hpl E40 Branco-neutro',
    channel: 'Mercado Livre',
    createdAt: 'Ontem, 17:20',
    reasonPlain:
      'Falta imagem de capa elegível (>= 500x500 px sem marca d’água) e ao menos 3 fotos validadas para o Mercado Livre.',
    impactPlain:
      'Reduz a nota de prontidão no Mercado Livre em 20 pontos.',
    responsibleRole: 'Operador',
    actionLabel: 'Comparar, selecionar e validar imagens',
    actionHref: '/catalogo/16723377536',
    severity: 'info',
    technicalDetail: 'Motor IQRE · code: add_ml_images_cover',
  },
  {
    id: 'pend-7',
    category: 'preco_abaixo_custo',
    categoryLabel: 'Preço abaixo do custo',
    sku: 'DPS-VCL-275V',
    productId: '16714624025',
    productName: 'DPS CLAMPER VCL SLIM 275V',
    channel: 'Nuvemshop',
    createdAt: 'Ontem, 16:40',
    reasonPlain:
      'Preço de venda configurado na loja (R$ 34,90) está abaixo do custo cadastrado no Bling (R$ 39,50).',
    impactPlain:
      'Venda com margem bruta negativa (-13,1%). Por regra do sistema, não bloqueia o envio de estoque.',
    responsibleRole: 'Financeiro',
    actionLabel: 'Consultar custo, preço e margem estimada',
    actionHref: '/qualidade-margem',
    severity: 'critical',
    technicalDetail: 'Motor APE · alert_code: price_below_cost (não-bloqueante)',
  },
  {
    id: 'pend-8',
    category: 'publicacao_falha',
    categoryLabel: 'Publicação com falha',
    sku: 'BOT-34-209R',
    productId: '16706185677',
    productName: 'BOTOEIRA 34-209R CAIXA ALTA- 9 FUROS (3X3) 22 MM - ALUMINIO',
    channel: 'Mercado Livre',
    createdAt: '22/10, 16:15',
    reasonPlain:
      'O Mercado Livre recusou o passo de atualização de medidas porque a categoria ainda não possui atributo de dimensões habilitado.',
    impactPlain:
      'Os passos anteriores (estoque e preço) foram preservados; apenas o passo de medidas aguarda reconciliação.',
    responsibleRole: 'Operador',
    actionLabel: 'Ver causa, corrigir dados e reprocessar com segurança',
    actionHref: '/publicacoes',
    severity: 'warning',
    technicalDetail: 'Motor APE · step: measures · HTTP 400 validation_error',
  },
];

export default function CentralPendenciasPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [showTech, setShowTech] = useState<boolean>(false);

  const filtered = UNIFIED_PENDINGS.filter((item) => {
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
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-bold text-white">
              Central Unificada de Pendências
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Fila única de decisões operacionais, fiscais e financeiras: cada item explica o problema, o impacto e o próximo passo claro.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowTech((prev) => !prev)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white"
        >
          {showTech ? 'Ocultar códigos dos motores' : 'Exibir diagnóstico técnico'}
        </button>
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
          <option value="all">Todos os tipos de pendência (8 categorias)</option>
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
