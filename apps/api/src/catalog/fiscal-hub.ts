import { query } from '../db/pool.js';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels.js';
import { validateGs1Gtin } from '../engines/gve.js';

export type FiscalQueue = 'ean' | 'ncm' | 'conflitos';

export interface FiscalHubItem {
  id: string;
  queue: FiscalQueue;
  sku: string;
  name: string;
  proposed: string;
  origin: string;
  status: string;
  firstReviewerId: string | null;
  firstReviewerEmail: string | null;
  gs1Valid: boolean | null;
}

const ORIGIN: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
  bling: 'Bling',
};

function origin(value: string): string {
  return ORIGIN[value] ?? value;
}

function startOfToday(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function loadEanMetrics(): Promise<{ valid: number; pending: number; invalid: number }> {
  const pendingPlatform = MERCADO_LIVRE_ACTIVE ? '' : `AND source_platform <> 'mercadolivre'`;
  const [valid, pending, invalid] = await Promise.all([
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM product_variants WHERE is_active = true AND ean_status = 'valid'`
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_pending_validation WHERE status = 'pending' ${pendingPlatform}`
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM product_variants
       WHERE is_active = true AND ean_status IN ('invalid', 'duplicate', 'divergent')`
    ),
  ]);
  return {
    valid: valid.rows[0]?.count ?? 0,
    pending: pending.rows[0]?.count ?? 0,
    invalid: invalid.rows[0]?.count ?? 0,
  };
}

export async function buildEanHistoryCsv(): Promise<string> {
  const rows = await query<{
    created_at: Date;
    action: string;
    ean: string | null;
    new_status: string;
    bling_sku: string | null;
    name: string | null;
    email: string | null;
  }>(
    `SELECT h.created_at, h.action, h.ean, h.new_status, mp.bling_sku, mp.name, u.email
     FROM ean_validation_history h
     LEFT JOIN master_products mp ON mp.id = h.master_product_id
     LEFT JOIN users u ON u.id = h.actor_id
     ORDER BY h.created_at DESC
     LIMIT 5000`
  );
  const cell = (value: string | null) => {
    const text = value ?? '';
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = ['data;acao;ean;status;sku;produto;autor'];
  for (const row of rows.rows) {
    lines.push(
      [
        new Date(row.created_at).toISOString(),
        row.action,
        row.ean,
        row.new_status,
        row.bling_sku,
        row.name,
        row.email,
      ]
        .map(cell)
        .join(';')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function loadFiscalHub(): Promise<{
  counts: Record<FiscalQueue, number>;
  today: { approved: number; rejected: number; awaitingSecond: number };
  items: FiscalHubItem[];
}> {
  const since = startOfToday();
  const [eans, suggestions, reviewers, conflicts, conflictAlerts, approvedEan, rejectedEan, approvedNcm] = await Promise.all([
    query<{
      id: string;
      proposed_ean: string;
      source_platform: string;
      bling_sku: string | null;
      name: string | null;
    }>(
      `SELECT epv.id, epv.proposed_ean, epv.source_platform, pv.bling_sku, mp.name
       FROM ean_pending_validation epv
       INNER JOIN product_variants pv ON pv.id = epv.variant_id
       INNER JOIN master_products mp ON mp.id = epv.master_product_id
       WHERE epv.status = 'pending'
       ORDER BY epv.created_at ASC
       LIMIT 200`
    ),
    query<{
      id: string;
      proposed_ncm: string;
      source_platform: string;
      status: string;
      first_review_by: string | null;
      bling_sku: string | null;
      name: string | null;
    }>(
      `SELECT s.id, s.proposed_ncm, s.source_platform, s.status, s.first_review_by, mp.bling_sku, mp.name
       FROM ncm_manual_suggestions s
       INNER JOIN master_products mp ON mp.id = s.master_product_id
       WHERE s.status IN ('pending_first', 'pending_second')
       ORDER BY s.created_at ASC
       LIMIT 200`
    ),
    query<{ id: string; email: string }>(`SELECT id, email FROM users`),
    query<{ id: string; bling_sku: string | null; name: string | null; ncm: string | null }>(
      `SELECT id, bling_sku, name, ncm FROM master_products
       WHERE catalog_status = 'active' AND archived_at IS NULL AND ncm_status = 'conflict'
       ORDER BY updated_at DESC
       LIMIT 200`
    ),
    query<{ master_product_id: string; conflict_ncms: string[] | null; bling_sku: string | null; name: string | null }>(
      `SELECT a.master_product_id, a.conflict_ncms, mp.bling_sku, mp.name
       FROM ncm_divergence_alerts a
       INNER JOIN master_products mp ON mp.id = a.master_product_id
       WHERE a.alert_type = 'variant_conflict' AND a.status = 'open'
       LIMIT 200`
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_validation_history WHERE action = 'human_approved' AND created_at >= $1`,
      [since]
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ean_validation_history WHERE action = 'human_rejected' AND created_at >= $1`,
      [since]
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ncm_audit_log WHERE decision = 'dual_approved' AND created_at >= $1`,
      [since]
    ),
  ]);

  const emailById = new Map(reviewers.rows.map((row) => [row.id, row.email]));
  const visible = (platform: string) => MERCADO_LIVRE_ACTIVE || platform !== 'mercadolivre';
  const items: FiscalHubItem[] = [];

  for (const row of eans.rows) {
    if (!visible(row.source_platform)) continue;
    const gs1 = validateGs1Gtin(row.proposed_ean);
    items.push({
      id: row.id,
      queue: 'ean',
      sku: row.bling_sku || 'Sem SKU',
      name: row.name ?? 'Sem nome',
      proposed: row.proposed_ean,
      origin: origin(row.source_platform),
      status: 'pending',
      firstReviewerId: null,
      firstReviewerEmail: null,
      gs1Valid: gs1.valid,
    });
  }
  for (const row of suggestions.rows) {
    if (!visible(row.source_platform)) continue;
    items.push({
      id: row.id,
      queue: 'ncm',
      sku: row.bling_sku || 'Sem SKU',
      name: row.name ?? 'Sem nome',
      proposed: row.proposed_ncm,
      origin: origin(row.source_platform),
      status: row.status,
      firstReviewerId: row.first_review_by,
      firstReviewerEmail: row.first_review_by ? emailById.get(row.first_review_by) ?? null : null,
      gs1Valid: null,
    });
  }
  const seenConflicts = new Set<string>();
  for (const row of conflicts.rows) {
    seenConflicts.add(row.id);
    items.push({
      id: row.id,
      queue: 'conflitos',
      sku: row.bling_sku || 'Sem SKU',
      name: row.name ?? 'Sem nome',
      proposed: row.ncm || 'NCM divergente entre variantes',
      origin: 'Variantes do produto',
      status: 'conflict',
      firstReviewerId: null,
      firstReviewerEmail: null,
      gs1Valid: null,
    });
  }
  for (const row of conflictAlerts.rows) {
    if (seenConflicts.has(row.master_product_id)) continue;
    items.push({
      id: row.master_product_id,
      queue: 'conflitos',
      sku: row.bling_sku || 'Sem SKU',
      name: row.name ?? 'Sem nome',
      proposed: (row.conflict_ncms ?? []).filter(Boolean).join(', ') || 'NCM divergente entre variantes',
      origin: 'Variantes do produto',
      status: 'conflict',
      firstReviewerId: null,
      firstReviewerEmail: null,
      gs1Valid: null,
    });
  }

  const counts = {
    ean: items.filter((item) => item.queue === 'ean').length,
    ncm: items.filter((item) => item.queue === 'ncm').length,
    conflitos: items.filter((item) => item.queue === 'conflitos').length,
  };
  return {
    counts,
    today: {
      approved: (approvedEan.rows[0]?.count ?? 0) + (approvedNcm.rows[0]?.count ?? 0),
      rejected: rejectedEan.rows[0]?.count ?? 0,
      awaitingSecond: items.filter((item) => item.status === 'pending_second').length,
    },
    items,
  };
}
