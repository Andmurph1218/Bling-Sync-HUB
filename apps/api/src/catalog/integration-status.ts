import { CatalogChannel, ChecklistResult } from './completeness.js';

export type IntegrationVisual = 'connected' | 'pending' | 'blocked' | 'absent';

export interface ChannelBlocker {
  code: string;
  title: string;
  fixHref: string;
  where: 'bling' | 'hub';
}

export interface ChannelIntegrationView {
  platform: CatalogChannel;
  visual: IntegrationVisual;
  label: string;
  tooltip: string;
  percent: number;
  ready: boolean;
  blockers: ChannelBlocker[];
}

const LABEL: Record<IntegrationVisual, string> = {
  connected: 'Conectado',
  pending: 'Pendente',
  blocked: 'Bloqueado',
  absent: 'Não integrado',
};

function bottleneckTitle(code: string, fallback: string, percent: number): string {
  if (code === 'ncm') return 'Falta preencher NCM no ERP (Bling)';
  if (code === 'cover') return `Falta imagem com fundo branco (completude ${percent}%)`;
  if (code === 'hub_category' || code === 'channel_category') return 'Falta vincular categoria no HUB';
  if (code === 'ean') return 'Aguardando aprovação de EAN';
  if (code === 'sku') return 'Sem SKU no ERP';
  return fallback;
}

function fixPlace(code: string): 'bling' | 'hub' {
  return code === 'sku' || code === 'ncm' || code === 'price' ? 'bling' : 'hub';
}

/**
 * Semáforo de um canal a partir do checklist já calculado e do vínculo.
 * Não consulta o banco: a listagem junta os dados numa única leitura.
 */
export function describeChannelIntegration(input: {
  platform: CatalogChannel;
  linkStatus: string | null;
  sendRequested: boolean;
  checklist: ChecklistResult;
}): ChannelIntegrationView {
  const failing = input.checklist.items.filter((item) => !item.ok);
  const blockers = failing.map((item) => ({
    code: item.code,
    title: bottleneckTitle(item.code, item.title, input.checklist.percent),
    fixHref: item.fixHref,
    where: fixPlace(item.code),
  }));
  const critical = blockers.filter((item) => item.code === 'sku' || item.code === 'ncm');
  const linked = input.linkStatus === 'linked';
  const apt = linked && input.checklist.ready && !failing.some((item) => item.code === 'ncm');

  let visual: IntegrationVisual;
  if (critical.length > 0) visual = 'blocked';
  else if (apt) visual = 'connected';
  else if (failing.length > 0) visual = 'pending';
  else if (!linked && !input.sendRequested) visual = 'absent';
  else visual = 'pending';

  const tooltip =
    visual === 'connected'
      ? 'Vinculado e apto para o canal'
      : visual === 'absent'
        ? 'Não integrado. Nenhum envio foi solicitado.'
        : blockers[0]?.title ?? 'Envio solicitado. Aguardando o canal.';

  return {
    platform: input.platform,
    visual,
    label: LABEL[visual],
    tooltip,
    percent: input.checklist.percent,
    ready: visual === 'connected',
    blockers,
  };
}
