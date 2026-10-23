'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';

export type TechnicalTermKey =
  | 'PIRE'
  | 'VIR'
  | 'GVE'
  | 'NVE'
  | 'CQS'
  | 'IQRE'
  | 'CRE'
  | 'APE'
  | 'WIG'
  | 'DLM'
  | 'meli_facility'
  | 'match_rejections'
  | 'follow_store_price';

export const TECHNICAL_GLOSSARY: Record<TechnicalTermKey, string> = {
  PIRE: 'Motor de Resolução de Identidade de Produto: exige 2 sinais fortes concordantes (score 95) para auto-vínculo e envia conflitos para quarentena.',
  VIR: 'Motor de Identidade de Variantes: normaliza atributos por comboKey e analisa lacunas da matriz entre o Bling e os canais.',
  GVE: 'Motor de Validação Fiscal de GTIN/EAN: valida dígito verificador GS1 (módulo 10), detecta duplicidade entre variantes e exige aprovação humana para EAN externo.',
  NVE: 'Motor de Validação de NCM: valida código de 8 dígitos (0000.00.00), bloqueia conflito entre variantes e exige dupla confirmação com consulta à TIPI.',
  CQS: 'Motor de Qualidade de Conteúdo: avalia grades A–F sem jamais substituir (REPLACE) campos Grade A ou B do Bling.',
  IQRE: 'Motor de Qualidade e Direitos de Imagem: processa fotos em fila assíncrona e deduplica por Average Hash 64-bit dentro do mesmo produto.',
  CRE: 'Motor de Prontidão por Canal: calcula 3 scores independentes por variante (Bling, ML e Nuvemshop); estoque e pausa nunca dependem deste score.',
  APE: 'Motor de Push Atômico: publica por passo individual (pause, stock, price, measures, pictures) sem fazer PUT do produto inteiro.',
  WIG: 'Guarda de Idempotência de Webhook: valida HMAC-SHA256 e persiste o evento em webhook_events antes de responder HTTP 200.',
  DLM: 'Gerenciador de Ciclo de Vida de Dados: executa expurgo por TTL, manutenção de partições mensais e arquivamento fiscal imutável de 5 anos.',
  meli_facility: 'Estoque Full gerido fisicamente pelo Mercado Livre: o hub apenas lê sua versão/saldo e jamais escreve quantidade (nem zero) nessa localização.',
  match_rejections: 'Cache negativo permanente de vínculos recusados por operador humano; não possui TTL e impede novas sugestões para o mesmo par.',
  follow_store_price: 'Flag auditada em control_changes que define qual condição do anúncio User Product no Mercado Livre recebe atualização automática de preço da loja Bling.',
};

interface TechTooltipProps {
  term: TechnicalTermKey;
  label?: string;
  className?: string;
}

export function TechTooltip({ term, label, className = '' }: TechTooltipProps) {
  const description = TECHNICAL_GLOSSARY[term];

  return (
    <span className={`group relative inline-flex items-center gap-1 cursor-help ${className}`}>
      <span className="underline decoration-dotted decoration-zinc-500 underline-offset-4">
        {label ?? term}
      </span>
      <HelpCircle className="h-3.5 w-3.5 text-zinc-400 transition group-hover:text-zinc-200" />
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-zinc-200 opacity-0 shadow-xl transition-all duration-150 group-hover:visible group-hover:opacity-100"
      >
        <strong className="mb-0.5 block font-semibold text-white">{term}</strong>
        {description}
      </span>
    </span>
  );
}
