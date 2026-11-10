import { query } from '../db/pool.js';
import { DEFAULT_ERP_ID } from '../connectors/strategy/factory.js';
import { CatalogListItem, listCatalog } from './list.js';

export type ProblemType = 'estoque' | 'preco' | 'anuncio' | 'cadastro';

export interface ProblemItem {
  id: string;
  type: ProblemType;
  sku: string;
  name: string;
  productId: string;
  erpId: string;
  channel: string;
  message: string;
  source: 'publish_queue' | 'webhook_events' | 'completude';
}

export interface CompletenessGroup {
  code: string;
  label: string;
  count: number;
  href: string;
}

export interface ProblemGroup {
  type: ProblemType;
  label: string;
  count: number;
  items: ProblemItem[];
}

const GROUP_LABEL: Record<ProblemType, string> = {
  estoque: 'Problemas de Estoque',
  preco: 'Problemas de Preço',
  anuncio: 'Problemas de Anúncio',
  cadastro: 'Problemas de Cadastro',
};

const CHECKLIST_META: Record<string, { type: ProblemType; label: string; message: string; channel: string }> = {
  sku: { type: 'cadastro', label: 'produtos sem SKU', message: 'Sem SKU — não sincroniza', channel: 'Catálogo' },
  ean: { type: 'cadastro', label: 'produtos sem EAN', message: 'Falta EAN válido', channel: 'Catálogo' },
  ncm: { type: 'cadastro', label: 'produtos sem NCM válido', message: 'NCM ausente ou inválido', channel: 'Catálogo' },
  hub_category: { type: 'cadastro', label: 'produtos sem categoria', message: 'Sem categoria', channel: 'Catálogo' },
  duplicate: { type: 'cadastro', label: 'produtos com possível duplicata', message: 'Possível duplicata por SKU ou EAN', channel: 'Catálogo' },
  price: { type: 'preco', label: 'produtos sem preço', message: 'Preço ausente ou zero', channel: 'Catálogo' },
  cover: { type: 'anuncio', label: 'produtos sem imagem', message: 'Falta imagem de capa elegível', channel: 'Mercado Livre e Nuvemshop' },
  channel_category: { type: 'anuncio', label: 'produtos sem categoria no canal', message: 'Categoria do canal ainda não está verde', channel: 'Mercado Livre e Nuvemshop' },
  attributes: { type: 'anuncio', label: 'produtos com atributos pendentes', message: 'Atributos obrigatórios do anúncio ainda não resolvidos', channel: 'Mercado Livre e Nuvemshop' },
  stock: { type: 'estoque', label: 'produtos sem leitura de estoque', message: 'Estoque ainda não foi lido do ERP', channel: 'ERP' },
};

const CHANNEL_NAME: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
  shopee: 'Shopee',
  amazon: 'Amazon',
  tiktok: 'TikTok',
  erp: 'ERP',
};

function channelName(value: string): string {
  if (value === DEFAULT_ERP_ID) return 'ERP';
  return CHANNEL_NAME[value] ?? value;
}

export function translateProblemMessage(channel: string, raw: string | null): string {
  const name = channelName(channel);
  const text = (raw ?? '').trim();
  if (!text) return `Falha no envio para ${name}.`;
  if (text === 'escrita_ao_vivo_desligada') {
    return `O envio para ${name} não saiu: a publicação ao vivo está desligada.`;
  }
  if (text === 'estoque_na_integracao_nativa') return 'O estoque continua na integração nativa do ERP.';
  if (text === 'modo_catalogo') return 'Pedido ou nota fiscal fora do modo catálogo.';
  if (/image|imagem|picture/i.test(text) && /small|pequena|size|tamanho|min/i.test(text)) {
    return `Rejeitado pelo ${name}: imagem pequena.`;
  }
  if (/^[a-z0-9_]+$/.test(text)) {
    return `Rejeitado pelo ${name}: ${text.replace(/_/g, ' ')}.`;
  }
  if (text.includes(' ')) return text;
  return text.toLowerCase().includes(name.toLowerCase()) ? text : `Rejeitado pelo ${name}: ${text}`;
}

function webhookType(eventType: string): ProblemType {
  const value = eventType.toLowerCase();
  if (value.includes('stock') || value.includes('estoque')) return 'estoque';
  if (value.includes('price') || value.includes('preco')) return 'preco';
  if (value.includes('item') || value.includes('listing') || value.includes('anuncio')) return 'anuncio';
  return 'cadastro';
}

function webhookMessage(eventType: string, detail: string | null, channel: string): string {
  if (detail && detail.trim()) return translateProblemMessage(channel, detail);
  const type = webhookType(eventType);
  if (type === 'estoque') return 'A leitura de estoque do webhook falhou na validação.';
  if (type === 'preco') return 'A leitura de preço do webhook falhou na validação.';
  return 'O evento do webhook falhou na validação do cadastro.';
}

function fromChecklist(code: string, item: CatalogListItem): ProblemItem | null {
  const meta = CHECKLIST_META[code];
  if (!meta) return null;
  return {
    id: `completude:${code}:${item.id}`,
    type: meta.type,
    sku: item.sku || 'Sem SKU',
    name: item.name ?? 'Sem nome',
    productId: item.id,
    erpId: item.erpId,
    channel: meta.channel,
    message: meta.message,
    source: 'completude',
  };
}

export async function listProblems(): Promise<{ groups: ProblemGroup[]; pendencies: CompletenessGroup[] }> {
  const catalog = await listCatalog({
    tab: 'todos',
    sku: '',
    name: '',
    brand: '',
    page: 1,
    pageSize: 1,
    collectGapSamples: true,
  });

  const items: ProblemItem[] = [];

  const failedJobs = await query<{
    id: string;
    channel: string;
    error_message: string | null;
    product_id: string;
    erp_id: string;
    erp_sku: string;
    name: string | null;
  }>(
    `SELECT q.id, q.channel, q.error_message, mp.id AS product_id, mp.erp_id, mp.erp_sku, mp.name
     FROM publish_queue q
     INNER JOIN master_products mp ON mp.id = q.product_id
     WHERE q.status = 'failed'
     ORDER BY q.updated_at DESC
     LIMIT 80`
  );
  for (const row of failedJobs.rows) {
    const kind = webhookType(row.error_message ?? '');
    const type: ProblemType =
      kind === 'estoque' || kind === 'preco' ? kind : 'anuncio';
    items.push({
      id: `publish:${row.id}`,
      type,
      sku: row.erp_sku || 'Sem SKU',
      name: row.name ?? 'Sem nome',
      productId: row.product_id,
      erpId: row.erp_id,
      channel: channelName(row.channel),
      message: translateProblemMessage(row.channel, row.error_message),
      source: 'publish_queue',
    });
  }

  const failedEvents = await query<{
    id: string;
    source: string;
    event_type: string;
    resource_id: string;
    error_detail: string | null;
    product_id: string | null;
    erp_id: string | null;
    erp_sku: string | null;
    name: string | null;
  }>(
    `SELECT w.id, w.source, w.event_type, w.resource_id, w.error_detail,
            mp.id AS product_id, mp.erp_id, mp.erp_sku, mp.name
     FROM webhook_events w
     LEFT JOIN master_products mp ON mp.erp_id = w.resource_id
     WHERE w.status = 'failed'
     ORDER BY w.created_at DESC
     LIMIT 80`
  );
  for (const row of failedEvents.rows) {
    items.push({
      id: `webhook:${row.id}`,
      type: webhookType(row.event_type),
      sku: row.erp_sku || row.resource_id || 'Sem SKU',
      name: row.name ?? `Evento ${row.event_type}`,
      productId: row.product_id ?? '',
      erpId: row.erp_id ?? row.resource_id,
      channel: channelName(row.source),
      message: webhookMessage(row.event_type, row.error_detail, row.source),
      source: 'webhook_events',
    });
  }

  for (const [code, sample] of Object.entries(catalog.gapSamples)) {
    for (const item of sample) {
      const problem = fromChecklist(code, item);
      if (problem) items.push(problem);
    }
  }

  const groups = (Object.keys(GROUP_LABEL) as ProblemType[]).map((type) => {
    const groupItems = items.filter((item) => item.type === type);
    const completenessCount = Object.entries(CHECKLIST_META)
      .filter(([, meta]) => meta.type === type)
      .reduce((sum, [code]) => sum + (catalog.gaps.byCode[code] ?? 0), 0);
    const queueCount = groupItems.filter((item) => item.source !== 'completude').length;
    return {
      type,
      label: GROUP_LABEL[type],
      count: queueCount + completenessCount,
      items: groupItems,
    };
  });

  const pendencies: CompletenessGroup[] = Object.entries(CHECKLIST_META)
    .map(([code, meta]) => ({
      code,
      label: meta.label,
      count: catalog.gaps.byCode[code] ?? 0,
      href: `/catalogo?status=completude&pendencia=${code}`,
    }))
    .filter((group) => group.count > 0);

  return { groups, pendencies };
}
