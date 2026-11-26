'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';

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
    <Tooltip.Root>
      <Tooltip.Trigger delay={400} closeDelay={100} render={<span tabIndex={0} />} className={`inline-flex cursor-help items-center gap-1 rounded ${className}`}>
        <span className="underline decoration-dotted decoration-text-muted underline-offset-4">{label ?? term}</span>
        <HelpCircle className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={8} className="z-[70]">
          <Tooltip.Popup className="ui-tooltip max-w-[calc(100vw-32px)] rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-left text-xs font-normal leading-relaxed text-text-primary shadow-lg">
            <strong className="mb-1 block font-semibold">{term}</strong>
            {description}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
