import { InboundProduct, InboundStockBalance, InboundVariant } from '../connectors/strategy/inbound.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';
import { isAllowedImageHost, EnqueueImageCandidate } from '../engines/iqre.js';
import { checklistForChannels } from './publish-preview.js';
import { applyVariantStockBalancesFromBling, isNewerHubSync, runFullProductCatalogPipeline } from '../orchestrator/pipeline.js';
import { StockBalanceItem } from '../contracts/mappers.js';

const DEFAULT_PAGE_SIZE = 20;
const STOCK_CHUNK = 20;
const MAX_PAGES = 5000;
const MAX_ERRORS = 30;

export interface FullSyncReport {
  status: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  pages: number;
  seen: number;
  upserted: number;
  variants: number;
  skippedService: number;
  skippedChild: number;
  skippedMissing: number;
  skippedExisting: number;
  failed: number;
  ready: number;
  incomplete: number;
  errors: string[];
  catalogDone: boolean;
  catalogTotal: number | null;
  stopReason: string | null;
  stockUpdated: number;
  archivedVariations: number;
}

export interface FullSyncHooks {
  upsertProduct?: (
    payload: InboundProduct,
    stockBySku: Record<string, InboundStockBalance>
  ) => Promise<{ masterProductId: string; variantIdsBySku: Record<string, string> }>;
  scoreProduct?: (masterProductId: string) => Promise<boolean>;
  pageSize?: number;
  startPage?: number;
  maxPages?: number;
  delayMs?: number;
  skipExisting?: boolean;
  alreadyImported?: (externalId: string) => Promise<boolean>;
  onProgress?: (report: FullSyncReport) => void;
}

function emptyReport(): FullSyncReport {
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    pages: 0,
    seen: 0,
    upserted: 0,
    variants: 0,
    skippedService: 0,
    skippedChild: 0,
    skippedMissing: 0,
    skippedExisting: 0,
    failed: 0,
    ready: 0,
    incomplete: 0,
    errors: [],
    catalogDone: false,
    catalogTotal: null,
    stopReason: null,
    stockUpdated: 0,
    archivedVariations: 0,
  };
}

let currentReport: FullSyncReport = emptyReport();
let running: Promise<FullSyncReport> | null = null;

export function getFullSyncStatus(): FullSyncReport {
  return currentReport;
}

function note(report: FullSyncReport, message: string, countsAsFailure: boolean): void {
  if (countsAsFailure) report.failed += 1;
  if (report.errors.length < MAX_ERRORS) report.errors.push(message.slice(0, 240));
}

function asProduct(raw: unknown): InboundProduct | null {
  if (!raw || typeof raw !== 'object' || !('id' in raw)) return null;
  const payload = raw as InboundProduct;
  if (payload.codigo == null || String(payload.codigo).trim() === '') {
    payload.codigo = `BLING-${payload.id}`;
  }
  return payload;
}

function parentId(payload: InboundProduct): string | null {
  const parent = (payload as { variacao?: { produtoPai?: { id?: number | string } } }).variacao?.produtoPai?.id;
  if (parent === undefined || parent === null || String(parent).trim() === '') return null;
  return String(parent);
}

async function defaultAlreadyImported(externalId: string): Promise<boolean> {
  const found = await query(`SELECT 1 FROM master_products WHERE erp_id = $1 LIMIT 1`, [externalId]);
  return Boolean(found.rows[0]);
}

async function hydrateVariations(erp: ErpConnector, payload: InboundProduct): Promise<void> {
  if (payload.formato !== 'V' || (payload.variacoes ?? []).length > 0 || !erp.listChildIds) return;
  const childIds = await erp.listChildIds(String(payload.id));
  const variations: InboundVariant[] = [];
  for (const childId of childIds) {
    let child: InboundProduct | null = null;
    try {
      child = asProduct(await erp.pullCatalogProduct(childId));
    } catch (error) {
      await recordSyncFailure(childId, error);
      continue;
    }
    if (!child || child.tipo !== 'P') continue;
    const declaredParent = parentId(child);
    if (declaredParent !== null && declaredParent !== String(payload.id)) continue;
    const named = child as InboundProduct & { variacao?: { nome?: string; ordem?: number } };
    variations.push({
      id: named.id,
      nome: named.nome,
      codigo: named.codigo,
      preco: named.preco,
      precoCusto: named.precoCusto,
      tipo: 'P',
      situacao: named.situacao,
      formato: named.formato === 'E' ? 'E' : 'S',
      gtin: named.gtin,
      pesoLiquido: named.pesoLiquido,
      pesoBruto: named.pesoBruto,
      dimensoes: named.dimensoes,
      tributacao: named.tributacao,
      variacao: {
        nome: named.variacao?.nome?.trim() || named.nome || 'Variação',
        ordem: named.variacao?.ordem ?? variations.length + 1,
        produtoPai: { id: Number(payload.id) },
      },
    });
  }
  payload.variacoes = variations;
  if (variations.length === 0) payload.formato = 'S';
}

function imageCandidates(payload: InboundProduct): EnqueueImageCandidate[] {
  const midia = (payload as {
    midia?: { imagens?: { externas?: Array<{ link?: string }>; internas?: Array<{ link?: string }> } };
  }).midia;
  const links = [...(midia?.imagens?.internas ?? []), ...(midia?.imagens?.externas ?? [])]
    .map((image) => image.link?.trim() ?? '')
    .filter((link) => link.length > 0 && isAllowedImageHost(link, 'erp'));
  return links.map((source_url) => ({ source_url, source_platform: 'erp' }));
}

async function defaultUpsert(
  payload: InboundProduct,
  stockBySku: Record<string, InboundStockBalance>
): Promise<{ masterProductId: string; variantIdsBySku: Record<string, string> }> {
  const report = await runFullProductCatalogPipeline({
    inboundPayload: payload,
    stockBalancesBySku: stockBySku,
    imagesToEnqueue: imageCandidates(payload),
  });
  return { masterProductId: report.masterProductId, variantIdsBySku: report.variantIdsBySku };
}

async function recordSyncFailure(externalId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const product = await query<{ id: string }>(
      `SELECT id FROM master_products WHERE erp_id = $1 LIMIT 1`,
      [externalId]
    );
    const productId = product.rows[0]?.id ?? null;
    if (productId) {
      await query(`UPDATE master_products SET needs_review = true, updated_at = now() WHERE id = $1`, [productId]);
    }
    await query(
      `INSERT INTO sync_logs (product_id, platform, direction, status, error_detail, idempotency_key)
       VALUES ($1, 'erp', 'pull', 'failed', $2, $3)`,
      [productId, message.slice(0, 500), `erp-detail:${externalId}:${Date.now()}`]
    );
  } catch {
    // A falha de log não pode interromper o cursor da sync.
  }
}

async function stockForBatch(
  erp: ErpConnector,
  batch: InboundProduct[]
): Promise<Map<string, InboundStockBalance>> {
  const balances = new Map<string, InboundStockBalance>();
  if (!erp.pullStockBalances) return balances;
  const ids: string[] = [];
  for (const payload of batch) {
    ids.push(String(payload.id));
    for (const variation of payload.variacoes ?? []) ids.push(String(variation.id));
  }
  for (let offset = 0; offset < ids.length; offset += STOCK_CHUNK) {
    const chunk = ids.slice(offset, offset + STOCK_CHUNK);
    const rows = await erp.pullStockBalances(chunk);
    for (const row of rows) {
      balances.set(row.externalId, row.raw as InboundStockBalance);
    }
  }
  return balances;
}

function stockBySku(payload: InboundProduct, balances: Map<string, InboundStockBalance>): Record<string, InboundStockBalance> {
  const mapped: Record<string, InboundStockBalance> = {};
  const attached = (payload as { estoqueSaldos?: unknown }).estoqueSaldos;
  if (Array.isArray(attached)) {
    for (const raw of attached) {
      const item = raw as StockBalanceItem;
      const id = item.produto?.id;
      if (id !== undefined && id !== null) balances.set(String(id), raw);
    }
  }
  const parent = balances.get(String(payload.id));
  if (parent && payload.codigo) mapped[payload.codigo] = parent;
  for (const variation of payload.variacoes ?? []) {
    const balance = balances.get(String(variation.id));
    if (balance && variation.codigo) mapped[variation.codigo] = balance;
  }
  return mapped;
}

async function archiveVariationProduct(externalId: string): Promise<number> {
  try {
    const updated = await query(
      `UPDATE master_products
       SET archived_at = COALESCE(archived_at, now())
       WHERE erp_id = $1 AND archived_at IS NULL`,
      [externalId]
    );
    return updated.rowCount ?? 0;
  } catch {
    return 0;
  }
}

/** Atualiza preço e estoque de um produto que já está no HUB, pelo SKU da variante. */
export async function refreshMissingCommerce(
  erp: ErpConnector,
  externalId: string
): Promise<{ price: number | null; stock: number | null }> {
  const current = await query<{ id: string; erp_sku: string | null; is_default: boolean; price: string | null; stock: string | null }>(
    `SELECT pv.id, pv.erp_sku, pv.is_default, pv.price::text AS price, pv.stock::text AS stock
     FROM product_variants pv
     JOIN master_products mp ON mp.id = pv.master_product_id
     WHERE mp.erp_id = $1 AND mp.archived_at IS NULL`,
    [externalId]
  );
  if (current.rows.length === 0) return { price: null, stock: null };
  const complete = current.rows.every((row) => Number(row.price) > 0 && row.stock !== null);
  if (complete) {
    const priced = current.rows.find((row) => row.is_default) ?? current.rows[0];
    return {
      price: priced?.price == null ? null : Number(priced.price),
      stock: priced?.stock == null ? null : Number(priced.stock),
    };
  }
  if (!erp.readCommerce) return { price: null, stock: null };
  let snapshot: Awaited<ReturnType<NonNullable<ErpConnector['readCommerce']>>>;
  try {
    snapshot = await erp.readCommerce(externalId);
  } catch {
    return { price: null, stock: null };
  }
  if (!snapshot) return { price: null, stock: null };
  const stamp = await query<{ last_bling_sync: Date | null }>(
    `SELECT last_bling_sync FROM master_products WHERE erp_id = $1`,
    [externalId]
  );
  const stale = isNewerHubSync(snapshot.changedAt, stamp.rows[0]?.last_bling_sync ?? null);
  let price: number | null = null;
  for (const line of snapshot.lines) {
    if (stale) break;
    if (line.price === null || line.price <= 0) continue;
    const target = current.rows.find((row) => (row.erp_sku ?? '').trim() === line.sku)
      ?? current.rows.find((row) => row.is_default)
      ?? current.rows[0];
    if (!target) continue;
    await query(
      `UPDATE product_variants SET price = $2, updated_at = now() WHERE id = $1`,
      [target.id, line.price]
    );
    if (line.sku === snapshot.sku || target.is_default) price = line.price;
  }
  const balances = new Map<string, InboundStockBalance>();
  for (const balance of snapshot.balances) balances.set(balance.externalId, balance.raw as InboundStockBalance);
  await refreshStoredStock(balances, snapshot.sku, snapshot.changedAt);
  const stockRow = await query<{ stock: string | null }>(
    `SELECT pv.stock::text AS stock
     FROM product_variants pv
     JOIN master_products mp ON mp.id = pv.master_product_id
     WHERE mp.erp_id = $1
     ORDER BY pv.is_default DESC
     LIMIT 1`,
    [externalId]
  );
  return { price, stock: stockRow.rows[0]?.stock == null ? null : Number(stockRow.rows[0].stock) };
}

async function refreshStoredStock(
  balances: Map<string, InboundStockBalance>,
  sku = '',
  observedAt?: Date | null
): Promise<number> {
  let updated = 0;
  for (const [externalId, raw] of balances) {
    try {
      const found = await query<{ id: string }>(
        `SELECT pv.id
         FROM product_variants pv
         JOIN master_products mp ON mp.id = pv.master_product_id
         WHERE mp.archived_at IS NULL
           AND (
             pv.bling_variant_id = $1
             OR pv.erp_sku = $1
             OR ($2 <> '' AND pv.erp_sku = $2 AND mp.erp_id = $1)
             OR (mp.erp_id = $1 AND pv.is_default = true)
           )
         ORDER BY CASE WHEN pv.erp_sku = $2 THEN 0 WHEN pv.is_default THEN 1 ELSE 2 END
         LIMIT 1`,
        [externalId, sku]
      );
      const variantId = found.rows[0]?.id;
      if (!variantId) continue;
      await applyVariantStockBalancesFromBling(variantId, raw as StockBalanceItem, observedAt);
      updated += 1;
    } catch {
      // A página segue mesmo se um saldo não puder ser gravado. O relatório guarda o erro.
    }
  }
  return updated;
}

/**
 * Percorre o catálogo do ERP página a página. Cada lote é gravado e descartado
 * antes da página seguinte. Não publica em marketplace.
 */
export async function runFullCatalogSync(erp: ErpConnector, hooks: FullSyncHooks = {}): Promise<FullSyncReport> {
  const pageSize = hooks.pageSize ?? DEFAULT_PAGE_SIZE;
  const startPage = hooks.startPage && hooks.startPage > 0 ? Math.floor(hooks.startPage) : 1;
  const lastPage = hooks.maxPages && hooks.maxPages > 0
    ? Math.min(MAX_PAGES, startPage + Math.floor(hooks.maxPages) - 1)
    : MAX_PAGES;
  const upsertProduct = hooks.upsertProduct ?? defaultUpsert;
  const alreadyImported = hooks.alreadyImported ?? defaultAlreadyImported;
  const report: FullSyncReport = { ...emptyReport(), status: 'running', startedAt: new Date().toISOString(), errors: [] };
  let previousFirst = '';
  let catalogDone = false;
  const pause = async () => {
    if (hooks.delayMs && hooks.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, hooks.delayMs));
    }
  };

  const publish = () => hooks.onProgress?.({ ...report, errors: [...report.errors] });
  publish();

  try {
    for (let page = startPage; page <= lastPage; page += 1) {
      await pause();
      const listed = await erp.listCatalogPage(page, pageSize);
      report.pages = page;
      if (typeof listed.total === 'number' && listed.total > 0) report.catalogTotal = listed.total;
      if (listed.externalIds.length === 0) {
        report.stopReason = 'pagina_vazia';
        catalogDone = true;
        break;
      }
      if (listed.externalIds[0] === previousFirst) {
        report.stopReason = 'pagina_repetida';
        note(report, `A página ${page} repetiu o primeiro produto. A paginação parou.`, true);
        catalogDone = true;
        break;
      }
      previousFirst = listed.externalIds[0] ?? '';
      const childIds = new Set(listed.childIds ?? []);

      const batch: InboundProduct[] = [];
      const existingIds: string[] = [];
      for (const externalId of listed.externalIds) {
        report.seen += 1;
        try {
          if (childIds.has(externalId)) {
            report.skippedChild += 1;
            report.archivedVariations += await archiveVariationProduct(externalId);
            continue;
          }
          if (hooks.skipExisting && (await alreadyImported(externalId))) {
            report.skippedExisting += 1;
            existingIds.push(externalId);
            continue;
          }
          process.stderr.write(`pull ${externalId}\n`);
          await pause();
          const raw = await erp.pullCatalogProduct(externalId);
          const payload = asProduct(raw);
          if (!payload) {
            report.skippedMissing += 1;
            continue;
          }
          if (payload.tipo !== 'P') {
            report.skippedService += 1;
            continue;
          }
          if (parentId(payload)) {
            report.skippedChild += 1;
            report.archivedVariations += await archiveVariationProduct(String(payload.id));
            continue;
          }
          await hydrateVariations(erp, payload);
          batch.push(payload);
        } catch (error) {
          await recordSyncFailure(externalId, error);
          note(report, `${externalId}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }

      let balances = new Map<string, InboundStockBalance>();
      try {
        balances = await stockForBatch(erp, batch);
        if (existingIds.length > 0 && erp.pullStockBalances) {
          const existingProducts = existingIds.map((id) => ({ id, variacoes: [] }) as unknown as InboundProduct);
          const existingBalances = await stockForBatch(erp, existingProducts);
          for (const [id, raw] of existingBalances) balances.set(id, raw);
          report.stockUpdated += await refreshStoredStock(existingBalances);
        }
      } catch (error) {
        note(report, `saldos: ${error instanceof Error ? error.message : String(error)}`, false);
      }

      const savedIds: string[] = [];
      for (const payload of batch) {
        try {
          const saved = await upsertProduct(payload, stockBySku(payload, balances));
          report.upserted += 1;
          report.variants += Object.keys(saved.variantIdsBySku).length;
          if (hooks.scoreProduct) {
            const ready = await hooks.scoreProduct(saved.masterProductId);
            if (ready) report.ready += 1;
            else report.incomplete += 1;
          } else {
            savedIds.push(saved.masterProductId);
          }
        } catch (error) {
          note(report, `${payload.codigo}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
        publish();
      }
      if (savedIds.length > 0) {
        const checks = await checklistForChannels(savedIds);
        for (const id of savedIds) {
          const scores = checks.get(id) ?? [];
          const ready = scores.length > 0 && scores.every((score) => score.percent === 100);
          const percent = scores.length === 0 ? 0 : Math.min(...scores.map((score) => score.percent));
          await query(
            `UPDATE master_products
             SET worst_score = $2,
                 has_fiscal_risk = (ncm_fiscal_risk OR ncm_status <> 'valid'),
                 updated_at = now()
             WHERE id = $1`,
            [id, percent]
          ).catch(() => undefined);
          if (ready) report.ready += 1;
          else report.incomplete += 1;
        }
      }

      publish();
      if (listed.done) {
        report.stopReason = listed.externalIds.length === 0 ? 'pagina_vazia' : 'ultima_pagina_curta';
        catalogDone = true;
        break;
      }
    }
    if (!catalogDone && hooks.maxPages == null) {
      report.stopReason = 'limite_de_paginas';
      note(report, `Limite de ${MAX_PAGES} páginas atingido.`, true);
    }
    if (!catalogDone && hooks.maxPages != null && report.stopReason == null) {
      report.stopReason = 'fatia';
    }
    report.catalogDone = catalogDone;
    report.status = catalogDone ? 'done' : 'running';
  } catch (error) {
    report.status = 'failed';
    note(report, error instanceof Error ? error.message : String(error), true);
  }
  report.finishedAt = new Date().toISOString();
  publish();
  return report;
}

export function startFullCatalogSync(erp: ErpConnector): { started: boolean; report: FullSyncReport } {
  if (running) return { started: false, report: currentReport };
  currentReport = { ...emptyReport(), status: 'running', startedAt: new Date().toISOString() };
  running = runFullCatalogSync(erp, {
    onProgress: (report) => {
      currentReport = report;
    },
  })
    .then((report) => {
      currentReport = report;
      return report;
    })
    .finally(() => {
      running = null;
    });
  return { started: true, report: currentReport };
}
