import { query } from '../db/pool.js';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels.js';
import { QUALITY_GAP_SQL, QUALITY_SCOPE_SQL } from './list.js';
import { ProblemType, translateProblemMessage } from './problems.js';

export type ProblemSeverity = 'critico' | 'aviso' | 'erro';
export type ProblemSource = 'completude' | 'publish_queue' | 'webhook_events';
export type ProblemActionKind = 'reprocess' | 'bling';

export interface ProblemGroupRow {
  key: string;
  type: ProblemType;
  severity: ProblemSeverity;
  source: ProblemSource;
  failureType: string;
  message: string;
  groupMessage: string;
  count: number;
  lastAt: string | null;
  action: ProblemActionKind;
  channel: string;
  single?: ProblemItemRow | null;
}

export interface ProblemItemRow {
  id: string;
  productId: string | null;
  blingId: string | null;
  sku: string;
  name: string;
  message: string;
  occurredAt: string | null;
}

const BLING_PRODUCTS_URL = 'https://www.bling.com.br/produtos.php';
const STORE_CHANNEL = MERCADO_LIVRE_ACTIVE ? 'Mercado Livre e Nuvemshop' : 'Nuvemshop';
const MAX_SOURCE_GROUPS = 200;
const MAX_SINGLE_INLINE = 100;
export const MAX_EXPANDED_ITEMS = 50000;

const GAP_META: Record<
  string,
  {
    type: ProblemType;
    severity: ProblemSeverity;
    failureType: string;
    message: string;
    groupMessage: (count: string) => string;
    action: ProblemActionKind;
    channel: string;
  }
> = {
  stock: {
    type: 'estoque',
    severity: 'critico',
    failureType: 'Estoque',
    message: 'Estoque não lido do ERP',
    groupMessage: (n) => `${n} produtos aguardando leitura de estoque do ERP`,
    action: 'reprocess',
    channel: 'Bling',
  },
  sku: {
    type: 'cadastro',
    severity: 'critico',
    failureType: 'Cadastro',
    message: 'Sem SKU — não sincroniza',
    groupMessage: (n) => `${n} produtos sem SKU no ERP`,
    action: 'bling',
    channel: 'Bling',
  },
  duplicate: {
    type: 'cadastro',
    severity: 'critico',
    failureType: 'Cadastro',
    message: 'Possível duplicata por EAN',
    groupMessage: (n) => `${n} produtos com EAN repetido em outro cadastro`,
    action: 'bling',
    channel: 'Bling',
  },
  price: {
    type: 'preco',
    severity: 'critico',
    failureType: 'Preço',
    message: 'Preço ausente ou zero',
    groupMessage: (n) => `${n} produtos sem preço de venda`,
    action: 'bling',
    channel: 'Bling',
  },
  ncm: {
    type: 'cadastro',
    severity: 'aviso',
    failureType: 'Cadastro',
    message: 'NCM ausente ou inválido',
    groupMessage: (n) => `${n} produtos sem NCM válido`,
    action: 'bling',
    channel: 'Bling',
  },
  ean: {
    type: 'cadastro',
    severity: 'aviso',
    failureType: 'Cadastro',
    message: 'Falta EAN válido exigido pelo canal',
    groupMessage: (n) => `${n} produtos sem EAN válido exigido pelo canal`,
    action: 'bling',
    channel: 'Bling',
  },
  cover: {
    type: 'anuncio',
    severity: 'erro',
    failureType: 'Anúncio',
    message: 'Falta imagem de capa elegível',
    groupMessage: (n) => `${n} produtos sem imagem de capa elegível`,
    action: 'reprocess',
    channel: STORE_CHANNEL,
  },
  hub_category: {
    type: 'anuncio',
    severity: 'erro',
    failureType: 'Anúncio',
    message: 'Sem categoria do HUB',
    groupMessage: (n) => `${n} produtos sem categoria do HUB`,
    action: 'reprocess',
    channel: 'HUB',
  },
  attributes: {
    type: 'anuncio',
    severity: 'erro',
    failureType: 'Anúncio',
    message: 'Categoria do canal ou atributos obrigatórios pendentes',
    groupMessage: (n) => `${n} produtos com categoria do canal ou atributos pendentes`,
    action: 'reprocess',
    channel: STORE_CHANNEL,
  },
};

const CHANNEL_NAME: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
  shopee: 'Shopee',
  amazon: 'Amazon',
  tiktok: 'TikTok',
  bling: 'Bling',
};

function channelName(value: string): string {
  return CHANNEL_NAME[value] ?? value;
}

function encodeKey(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

function decodeKey(value: string): string[] | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return Array.isArray(parsed) && parsed.every((part) => typeof part === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function textType(text: string): ProblemType {
  const value = text.toLowerCase();
  if (value.includes('stock') || value.includes('estoque')) return 'estoque';
  if (value.includes('price') || value.includes('preco') || value.includes('preço')) return 'preco';
  if (value.includes('item') || value.includes('listing') || value.includes('anuncio')) return 'anuncio';
  return 'cadastro';
}

function webhookMessage(eventType: string, detail: string): string {
  if (detail.trim()) return detail.trim();
  const type = textType(eventType);
  if (type === 'estoque') return 'A leitura de estoque do webhook falhou na validação.';
  if (type === 'preco') return 'A leitura de preço do webhook falhou na validação.';
  return 'O evento do webhook falhou na validação do cadastro.';
}

function gapWhere(code: string): string {
  return `${QUALITY_SCOPE_SQL} AND ${QUALITY_GAP_SQL[code]}
    AND mp.id NOT IN (SELECT ref_id FROM problem_dismissals WHERE source = 'completude' AND code = '${code}')`;
}

const PUBLISH_NOT_DISMISSED = `q.id NOT IN (SELECT ref_id FROM problem_dismissals WHERE source = 'publish_queue')`;

function formatCount(value: number): string {
  return value.toLocaleString('pt-BR');
}

export async function listProblemGroups(): Promise<ProblemGroupRow[]> {
  const [gapRows, publishRows, webhookRows] = await Promise.all([
    Promise.all(
      Object.keys(GAP_META).map(async (code) => {
        const row = await query<{ count: number; last_at: Date | null }>(
          `SELECT count(*)::int AS count, max(mp.updated_at) AS last_at FROM master_products mp WHERE ${gapWhere(code)}`
        );
        return { code, count: row.rows[0]?.count ?? 0, lastAt: row.rows[0]?.last_at ?? null };
      })
    ),
    query<{ channel: string; message: string; count: number; last_at: Date | null }>(
      `SELECT q.channel, COALESCE(q.error_message, '') AS message, count(*)::int AS count, max(q.updated_at) AS last_at
       FROM publish_queue q
       WHERE q.status = 'failed' AND ${PUBLISH_NOT_DISMISSED}
       GROUP BY q.channel, COALESCE(q.error_message, '')
       ORDER BY count(*) DESC
       LIMIT ${MAX_SOURCE_GROUPS}`
    ),
    query<{ source: string; event_type: string; detail: string; count: number; last_at: Date | null }>(
      `SELECT w.source, w.event_type, COALESCE(w.error_detail, '') AS detail, count(*)::int AS count, max(w.created_at) AS last_at
       FROM webhook_events w
       WHERE w.status = 'failed'
       GROUP BY w.source, w.event_type, COALESCE(w.error_detail, '')
       ORDER BY count(*) DESC
       LIMIT ${MAX_SOURCE_GROUPS}`
    ),
  ]);

  const groups: ProblemGroupRow[] = [];
  for (const gap of gapRows) {
    if (gap.count === 0) continue;
    const meta = GAP_META[gap.code]!;
    groups.push({
      key: `gap:${gap.code}`,
      type: meta.type,
      severity: meta.severity,
      source: 'completude',
      failureType: meta.failureType,
      message: meta.message,
      groupMessage: meta.groupMessage(formatCount(gap.count)),
      count: gap.count,
      lastAt: iso(gap.lastAt),
      action: meta.action,
      channel: meta.channel,
    });
  }
  for (const row of publishRows.rows) {
    const kind = textType(row.message);
    const message = translateProblemMessage(row.channel, row.message || null);
    groups.push({
      key: `pq:${encodeKey([row.channel, row.message])}`,
      type: kind === 'estoque' || kind === 'preco' ? kind : 'anuncio',
      severity: 'erro',
      source: 'publish_queue',
      failureType: 'Publicação',
      message,
      groupMessage: `${formatCount(row.count)} envios para ${channelName(row.channel)} falharam: ${message}`,
      count: row.count,
      lastAt: iso(row.last_at),
      action: 'reprocess',
      channel: channelName(row.channel),
    });
  }
  for (const row of webhookRows.rows) {
    const message = row.detail
      ? translateProblemMessage(row.source, row.detail)
      : webhookMessage(row.event_type, row.detail);
    groups.push({
      key: `wh:${encodeKey([row.source, row.event_type, row.detail])}`,
      type: textType(row.event_type),
      severity: 'critico',
      source: 'webhook_events',
      failureType: 'Webhook',
      message,
      groupMessage: `${formatCount(row.count)} eventos ${row.event_type} de ${channelName(row.source)} falharam: ${message}`,
      count: row.count,
      lastAt: iso(row.last_at),
      action: 'reprocess',
      channel: channelName(row.source),
    });
  }

  const rank: Record<ProblemSeverity, number> = { critico: 0, aviso: 1, erro: 2 };
  groups.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
  await Promise.all(
    groups
      .filter((group) => group.count === 1)
      .slice(0, MAX_SINGLE_INLINE)
      .map(async (group) => {
        const page = await listGroupItems(group.key, 1, 1);
        group.single = page?.items[0] ?? null;
      })
  );
  return groups;
}

type ParsedGroup =
  | { kind: 'gap'; code: string }
  | { kind: 'pq'; channel: string; message: string }
  | { kind: 'wh'; source: string; eventType: string; detail: string };

export function parseGroupKey(key: string): ParsedGroup | null {
  const [prefix, ...rest] = key.split(':');
  const body = rest.join(':');
  if (prefix === 'gap') return GAP_META[body] ? { kind: 'gap', code: body } : null;
  const parts = decodeKey(body);
  if (prefix === 'pq' && parts?.length === 2) return { kind: 'pq', channel: parts[0]!, message: parts[1]! };
  if (prefix === 'wh' && parts?.length === 3) {
    return { kind: 'wh', source: parts[0]!, eventType: parts[1]!, detail: parts[2]! };
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedItem =
  | { kind: 'gap'; code: string; productId: string }
  | { kind: 'pq'; id: string }
  | { kind: 'wh'; id: string };

export function parseItemId(id: string): ParsedItem | null {
  const parts = id.split(':');
  if (parts[0] === 'gap' && parts.length === 3 && GAP_META[parts[1]!] && UUID.test(parts[2]!)) {
    return { kind: 'gap', code: parts[1]!, productId: parts[2]! };
  }
  if ((parts[0] === 'pq' || parts[0] === 'wh') && parts.length === 2 && UUID.test(parts[1]!)) {
    return { kind: parts[0], id: parts[1]! };
  }
  return null;
}

export async function listGroupItems(
  key: string,
  page: number,
  pageSize: number
): Promise<{ items: ProblemItemRow[]; total: number } | null> {
  const group = parseGroupKey(key);
  if (!group) return null;
  const offset = (page - 1) * pageSize;

  if (group.kind === 'gap') {
    const meta = GAP_META[group.code]!;
    const [count, rows] = await Promise.all([
      query<{ count: number }>(`SELECT count(*)::int AS count FROM master_products mp WHERE ${gapWhere(group.code)}`),
      query<{ id: string; bling_id: string; bling_sku: string | null; name: string | null; updated_at: Date }>(
        `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name, mp.updated_at
         FROM master_products mp
         WHERE ${gapWhere(group.code)}
         ORDER BY mp.updated_at DESC, mp.id
         LIMIT ${pageSize} OFFSET ${offset}`
      ),
    ]);
    return {
      total: count.rows[0]?.count ?? 0,
      items: rows.rows.map((row) => ({
        id: `gap:${group.code}:${row.id}`,
        productId: row.id,
        blingId: row.bling_id,
        sku: row.bling_sku || 'Sem SKU',
        name: row.name ?? 'Sem nome',
        message: meta.message,
        occurredAt: iso(row.updated_at),
      })),
    };
  }

  if (group.kind === 'pq') {
    const where = `q.status = 'failed' AND q.channel = $1 AND COALESCE(q.error_message, '') = $2 AND ${PUBLISH_NOT_DISMISSED}`;
    const params = [group.channel, group.message];
    const [count, rows] = await Promise.all([
      query<{ count: number }>(`SELECT count(*)::int AS count FROM publish_queue q WHERE ${where}`, params),
      query<{ id: string; product_id: string; bling_id: string; bling_sku: string | null; name: string | null; updated_at: Date }>(
        `SELECT q.id, q.product_id, mp.bling_id, mp.bling_sku, mp.name, q.updated_at
         FROM publish_queue q
         INNER JOIN master_products mp ON mp.id = q.product_id
         WHERE ${where}
         ORDER BY q.updated_at DESC, q.id
         LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
    ]);
    const message = translateProblemMessage(group.channel, group.message || null);
    return {
      total: count.rows[0]?.count ?? 0,
      items: rows.rows.map((row) => ({
        id: `pq:${row.id}`,
        productId: row.product_id,
        blingId: row.bling_id,
        sku: row.bling_sku || 'Sem SKU',
        name: row.name ?? 'Sem nome',
        message,
        occurredAt: iso(row.updated_at),
      })),
    };
  }

  const where = `w.status = 'failed' AND w.source = $1 AND w.event_type = $2 AND COALESCE(w.error_detail, '') = $3`;
  const params = [group.source, group.eventType, group.detail];
  const [count, rows] = await Promise.all([
    query<{ count: number }>(`SELECT count(*)::int AS count FROM webhook_events w WHERE ${where}`, params),
    query<{
      id: string;
      resource_id: string;
      created_at: Date;
      product_id: string | null;
      bling_id: string | null;
      bling_sku: string | null;
      name: string | null;
    }>(
      `SELECT w.id, w.resource_id, w.created_at, mp.id AS product_id, mp.bling_id, mp.bling_sku, mp.name
       FROM webhook_events w
       LEFT JOIN master_products mp ON mp.bling_id = w.resource_id
       WHERE ${where}
       ORDER BY w.created_at DESC, w.id
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);
  const message = group.detail
    ? translateProblemMessage(group.source, group.detail)
    : webhookMessage(group.eventType, group.detail);
  return {
    total: count.rows[0]?.count ?? 0,
    items: rows.rows.map((row) => ({
      id: `wh:${row.id}`,
      productId: row.product_id,
      blingId: row.bling_id ?? row.resource_id,
      sku: row.bling_sku || row.resource_id || 'Sem SKU',
      name: row.name ?? `Evento ${group.eventType}`,
      message,
      occurredAt: iso(row.created_at),
    })),
  };
}

/** Expande grupos e itens selecionados em ids de item, sem repetir. */
export async function expandSelection(groupKeys: string[], itemIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const id of itemIds) {
    if (parseItemId(id)) ids.add(id);
  }
  for (const key of groupKeys) {
    if (ids.size >= MAX_EXPANDED_ITEMS) break;
    const group = parseGroupKey(key);
    if (!group) continue;
    const limit = MAX_EXPANDED_ITEMS - ids.size;
    if (group.kind === 'gap') {
      const rows = await query<{ id: string }>(
        `SELECT mp.id FROM master_products mp WHERE ${gapWhere(group.code)} LIMIT ${group.code === 'stock' ? 1 : limit}`
      );
      for (const row of rows.rows) ids.add(`gap:${group.code}:${row.id}`);
    } else if (group.kind === 'pq') {
      const rows = await query<{ id: string }>(
        `SELECT q.id FROM publish_queue q
         WHERE q.status = 'failed' AND q.channel = $1 AND COALESCE(q.error_message, '') = $2 AND ${PUBLISH_NOT_DISMISSED}
         LIMIT ${limit}`,
        [group.channel, group.message]
      );
      for (const row of rows.rows) ids.add(`pq:${row.id}`);
    } else {
      const rows = await query<{ id: string }>(
        `SELECT w.id FROM webhook_events w
         WHERE w.status = 'failed' AND w.source = $1 AND w.event_type = $2 AND COALESCE(w.error_detail, '') = $3
         LIMIT ${limit}`,
        [group.source, group.eventType, group.detail]
      );
      for (const row of rows.rows) ids.add(`wh:${row.id}`);
    }
  }
  return [...ids];
}

export async function dismissProblems(groupKeys: string[], itemIds: string[], userId: string | null): Promise<number> {
  let dismissed = 0;
  for (const key of groupKeys) {
    const group = parseGroupKey(key);
    if (!group) continue;
    if (group.kind === 'gap') {
      const inserted = await query(
        `INSERT INTO problem_dismissals (source, code, ref_id, dismissed_by)
         SELECT 'completude', '${group.code}', mp.id, $1::uuid FROM master_products mp WHERE ${gapWhere(group.code)}
         ON CONFLICT (source, code, ref_id) DO NOTHING`,
        [userId]
      );
      dismissed += inserted.rowCount ?? 0;
    } else if (group.kind === 'pq') {
      const inserted = await query(
        `INSERT INTO problem_dismissals (source, code, ref_id, dismissed_by)
         SELECT 'publish_queue', 'failed', q.id, $3::uuid FROM publish_queue q
         WHERE q.status = 'failed' AND q.channel = $1 AND COALESCE(q.error_message, '') = $2 AND ${PUBLISH_NOT_DISMISSED}
         ON CONFLICT (source, code, ref_id) DO NOTHING`,
        [group.channel, group.message, userId]
      );
      dismissed += inserted.rowCount ?? 0;
    } else {
      const updated = await query(
        `UPDATE webhook_events SET status = 'ignored', processed_at = now()
         WHERE status = 'failed' AND source = $1 AND event_type = $2 AND COALESCE(error_detail, '') = $3`,
        [group.source, group.eventType, group.detail]
      );
      dismissed += updated.rowCount ?? 0;
    }
  }
  for (const id of itemIds) {
    const item = parseItemId(id);
    if (!item) continue;
    if (item.kind === 'wh') {
      const updated = await query(
        `UPDATE webhook_events SET status = 'ignored', processed_at = now() WHERE id = $1 AND status = 'failed'`,
        [item.id]
      );
      dismissed += updated.rowCount ?? 0;
      continue;
    }
    const [source, code, refId] =
      item.kind === 'gap' ? ['completude', item.code, item.productId] : ['publish_queue', 'failed', item.id];
    const inserted = await query(
      `INSERT INTO problem_dismissals (source, code, ref_id, dismissed_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, code, ref_id) DO NOTHING`,
      [source, code, refId, userId]
    );
    dismissed += inserted.rowCount ?? 0;
  }
  return dismissed;
}

export async function buildProblemsCsv(groupKeys: string[], itemIds: string[]): Promise<string> {
  const groups = await listProblemGroups();
  const severityLabel: Record<ProblemSeverity, string> = { critico: 'Crítico', aviso: 'Aviso', erro: 'Erro' };
  const lines = ['gravidade;tipo;canal;sku;bling_id;produto;mensagem;data'];
  const cell = (value: string | null) => {
    const text = value ?? '';
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const seen = new Set<string>();
  const push = (groupKey: string, item: ProblemItemRow) => {
    if (seen.has(item.id) || seen.size >= MAX_EXPANDED_ITEMS) return;
    seen.add(item.id);
    const group = groups.find((row) => row.key === groupKey);
    lines.push(
      [
        group ? severityLabel[group.severity] : '',
        group?.failureType ?? '',
        group?.channel ?? '',
        item.sku,
        item.blingId,
        item.name,
        item.message,
        item.occurredAt,
      ]
        .map(cell)
        .join(';')
    );
  };
  for (const key of groupKeys) {
    const page = await listGroupItems(key, 1, MAX_EXPANDED_ITEMS);
    for (const item of page?.items ?? []) push(key, item);
  }
  for (const id of itemIds) {
    if (seen.has(id)) continue;
    const log = await readProblemLog(id);
    if (log) push(log.groupKey, log.item);
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export interface ReprocessContext {
  allowErpSync: boolean;
  erpSyncRequested: boolean;
  startErpSync: () => boolean;
  recalculate: (productId: string) => Promise<void>;
  republish: (publishQueueId: string) => Promise<void>;
  replayWebhook: (webhookEventId: string) => Promise<void>;
}

export const ERP_SYNC_DENIED = 'Apenas administradores podem forçar a leitura do Bling.';
export const ERP_SYNC_BUSY = 'Já existe uma leitura completa do Bling em andamento.';

/** Reprocessa um item. Estoque vira uma única leitura completa do Bling por lote. */
export async function reprocessProblemItem(id: string, ctx: ReprocessContext): Promise<string | null> {
  const item = parseItemId(id);
  if (!item) return 'Item inválido.';
  if (item.kind === 'gap' && item.code === 'stock') {
    if (!ctx.allowErpSync) return ERP_SYNC_DENIED;
    if (ctx.erpSyncRequested) return null;
    ctx.erpSyncRequested = true;
    return ctx.startErpSync() ? null : ERP_SYNC_BUSY;
  }
  if (item.kind === 'gap') {
    await ctx.recalculate(item.productId);
    return null;
  }
  if (item.kind === 'pq') {
    await query(`DELETE FROM problem_dismissals WHERE source = 'publish_queue' AND ref_id = $1`, [item.id]);
    await ctx.republish(item.id);
    return null;
  }
  await ctx.replayWebhook(item.id);
  return null;
}

export async function readProblemLog(
  id: string
): Promise<{ groupKey: string; item: ProblemItemRow; technical: Record<string, unknown> } | null> {
  const item = parseItemId(id);
  if (!item) return null;

  if (item.kind === 'gap') {
    const meta = GAP_META[item.code]!;
    const product = await query<Record<string, unknown> & { id: string; bling_id: string; bling_sku: string | null; name: string | null; updated_at: Date }>(
      `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name, mp.ncm, mp.ncm_status, mp.ncm_fiscal_risk,
              mp.hub_category_id, mp.worst_score, mp.catalog_status, mp.updated_at
       FROM master_products mp WHERE mp.id = $1`,
      [item.productId]
    );
    const row = product.rows[0];
    if (!row) return null;
    const variant = await query(
      `SELECT bling_sku, price::text AS price, stock::text AS stock, ean, ean_status,
              gross_weight::text AS gross_weight, width::text AS width, height::text AS height, depth::text AS depth
       FROM product_variants WHERE master_product_id = $1 AND is_default = true`,
      [item.productId]
    );
    return {
      groupKey: `gap:${item.code}`,
      item: {
        id,
        productId: row.id,
        blingId: row.bling_id,
        sku: row.bling_sku || 'Sem SKU',
        name: row.name ?? 'Sem nome',
        message: meta.message,
        occurredAt: iso(row.updated_at),
      },
      technical: {
        origem: 'completude',
        regra: item.code,
        corrigirEm: meta.action === 'bling' ? BLING_PRODUCTS_URL : 'HUB',
        produto: row,
        variantePadrao: variant.rows[0] ?? null,
      },
    };
  }

  if (item.kind === 'pq') {
    const found = await query<{
      id: string;
      product_id: string;
      channel: string;
      status: string;
      error_message: string | null;
      payload_json: unknown;
      created_at: Date;
      updated_at: Date;
      bling_id: string;
      bling_sku: string | null;
      name: string | null;
    }>(
      `SELECT q.id, q.product_id, q.channel, q.status, q.error_message, q.payload_json, q.created_at, q.updated_at,
              mp.bling_id, mp.bling_sku, mp.name
       FROM publish_queue q INNER JOIN master_products mp ON mp.id = q.product_id
       WHERE q.id = $1`,
      [item.id]
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      groupKey: `pq:${encodeKey([row.channel, row.error_message ?? ''])}`,
      item: {
        id,
        productId: row.product_id,
        blingId: row.bling_id,
        sku: row.bling_sku || 'Sem SKU',
        name: row.name ?? 'Sem nome',
        message: translateProblemMessage(row.channel, row.error_message),
        occurredAt: iso(row.updated_at),
      },
      technical: {
        origem: 'publish_queue',
        id: row.id,
        canal: row.channel,
        status: row.status,
        erroOriginal: row.error_message,
        payload: row.payload_json,
        criadoEm: iso(row.created_at),
        atualizadoEm: iso(row.updated_at),
      },
    };
  }

  const found = await query<{
    id: string;
    source: string;
    event_type: string;
    resource_id: string;
    status: string;
    error_detail: string | null;
    idempotency_key: string;
    raw_payload: unknown;
    created_at: Date;
    processed_at: Date | null;
    product_id: string | null;
    bling_sku: string | null;
    name: string | null;
  }>(
    `SELECT w.id, w.source, w.event_type, w.resource_id, w.status, w.error_detail, w.idempotency_key,
            w.raw_payload, w.created_at, w.processed_at, mp.id AS product_id, mp.bling_sku, mp.name
     FROM webhook_events w LEFT JOIN master_products mp ON mp.bling_id = w.resource_id
     WHERE w.id = $1`,
    [item.id]
  );
  const row = found.rows[0];
  if (!row) return null;
  const detail = row.error_detail ?? '';
  return {
    groupKey: `wh:${encodeKey([row.source, row.event_type, detail])}`,
    item: {
      id,
      productId: row.product_id,
      blingId: row.resource_id,
      sku: row.bling_sku || row.resource_id || 'Sem SKU',
      name: row.name ?? `Evento ${row.event_type}`,
      message: detail ? translateProblemMessage(row.source, detail) : webhookMessage(row.event_type, detail),
      occurredAt: iso(row.created_at),
    },
    technical: {
      origem: 'webhook_events',
      id: row.id,
      fonte: row.source,
      evento: row.event_type,
      recurso: row.resource_id,
      status: row.status,
      erroOriginal: row.error_detail,
      idempotencyKey: row.idempotency_key,
      payload: row.raw_payload,
      recebidoEm: iso(row.created_at),
      processadoEm: iso(row.processed_at),
    },
  };
}
