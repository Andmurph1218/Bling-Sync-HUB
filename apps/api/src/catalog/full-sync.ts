import { BlingProductPayload, BlingStockBalanceItem, BlingVariacaoPayload } from '../contracts/fixtures/bling.fixtures.js';
import { ErpConnector } from '../connectors/strategy/types.js';
import { query } from '../db/pool.js';
import { isAllowedImageHost, EnqueueImageCandidate } from '../engines/iqre.js';
import { runFullProductCatalogPipeline } from '../orchestrator/pipeline.js';
import { evaluateCatalogChecklist } from './completeness.js';

const DEFAULT_PAGE_SIZE = 20;
const STOCK_CHUNK = 20;
const MAX_PAGES = 2000;
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
}

export interface FullSyncHooks {
  upsertProduct?: (
    payload: BlingProductPayload,
    stockBySku: Record<string, BlingStockBalanceItem>
  ) => Promise<{ masterProductId: string; variantIdsBySku: Record<string, string> }>;
  scoreProduct?: (masterProductId: string) => Promise<boolean>;
  pageSize?: number;
  startPage?: number;
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

function asProduct(raw: unknown): BlingProductPayload | null {
  if (!raw || typeof raw !== 'object' || !('id' in raw)) return null;
  const payload = raw as BlingProductPayload;
  if (payload.codigo == null || String(payload.codigo).trim() === '') {
    payload.codigo = `BLING-${payload.id}`;
  }
  return payload;
}

function parentId(payload: BlingProductPayload): string | null {
  const parent = (payload as { variacao?: { produtoPai?: { id?: number | string } } }).variacao?.produtoPai?.id;
  if (parent === undefined || parent === null || String(parent).trim() === '') return null;
  return String(parent);
}

async function defaultAlreadyImported(externalId: string): Promise<boolean> {
  const found = await query(`SELECT 1 FROM master_products WHERE bling_id = $1 LIMIT 1`, [externalId]);
  return Boolean(found.rows[0]);
}

async function hydrateVariations(erp: ErpConnector, payload: BlingProductPayload): Promise<void> {
  if (payload.formato !== 'V' || (payload.variacoes ?? []).length > 0 || !erp.listChildIds) return;
  const childIds = await erp.listChildIds(String(payload.id));
  const variations: BlingVariacaoPayload[] = [];
  for (const childId of childIds) {
    let child: BlingProductPayload | null = null;
    try {
      child = asProduct(await erp.pullCatalogProduct(childId));
    } catch (error) {
      await recordSyncFailure(childId, error);
      continue;
    }
    if (!child || child.tipo !== 'P') continue;
    const named = child as BlingProductPayload & { variacao?: { nome?: string; ordem?: number } };
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

function imageCandidates(payload: BlingProductPayload): EnqueueImageCandidate[] {
  const midia = (payload as {
    midia?: { imagens?: { externas?: Array<{ link?: string }>; internas?: Array<{ link?: string }> } };
  }).midia;
  const links = [...(midia?.imagens?.internas ?? []), ...(midia?.imagens?.externas ?? [])]
    .map((image) => image.link?.trim() ?? '')
    .filter((link) => link.length > 0 && isAllowedImageHost(link));
  return links.map((source_url) => ({ source_url, source_platform: 'bling' }));
}

async function defaultUpsert(
  payload: BlingProductPayload,
  stockBySku: Record<string, BlingStockBalanceItem>
): Promise<{ masterProductId: string; variantIdsBySku: Record<string, string> }> {
  const report = await runFullProductCatalogPipeline({
    blingPayload: payload,
    stockBalancesBySku: stockBySku,
    imagesToEnqueue: imageCandidates(payload),
  });
  return { masterProductId: report.masterProductId, variantIdsBySku: report.variantIdsBySku };
}

async function defaultScore(masterProductId: string): Promise<boolean> {
  const found = await query<{
    bling_id: string;
    bling_sku: string | null;
    ncm_status: string;
    ncm_fiscal_risk: boolean;
    hub_category_id: string | null;
    price: string | null;
    ean_status: string | null;
    has_cover: boolean;
  }>(
    `SELECT mp.bling_id, mp.bling_sku, mp.ncm_status, mp.ncm_fiscal_risk, mp.hub_category_id,
            pv.price::text AS price, pv.ean_status,
            EXISTS (
              SELECT 1 FROM product_images pi
              WHERE pi.master_product_id = mp.id AND pi.is_cover_eligible = true
            ) AS has_cover
     FROM master_products mp
     LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
     WHERE mp.id = $1`,
    [masterProductId]
  );
  const row = found.rows[0];
  if (!row) return false;
  const checklist = evaluateCatalogChecklist({
    blingId: row.bling_id,
    sku: row.bling_sku,
    hasCoverImage: row.has_cover,
    hubCategoryId: row.hub_category_id,
    mappedPlatforms: [],
    greenPlatforms: [],
    eanStatus: row.ean_status,
    eanRequired: false,
    ncmStatus: row.ncm_status,
    ncmFiscalRisk: row.ncm_fiscal_risk,
    price: row.price === null ? null : Number(row.price),
    hasDuplicateCandidate: false,
    channels: ['nuvemshop'],
  });
  await query(
    `UPDATE master_products
     SET worst_score = $2, has_fiscal_risk = $3, updated_at = now()
     WHERE id = $1`,
    [masterProductId, checklist.percent, row.ncm_fiscal_risk || row.ncm_status !== 'valid']
  ).catch(() => undefined);
  return checklist.ready;
}

async function recordSyncFailure(externalId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const product = await query<{ id: string }>(
      `SELECT id FROM master_products WHERE bling_id = $1 LIMIT 1`,
      [externalId]
    );
    const productId = product.rows[0]?.id ?? null;
    if (productId) {
      await query(`UPDATE master_products SET needs_review = true, updated_at = now() WHERE id = $1`, [productId]);
    }
    await query(
      `INSERT INTO sync_logs (product_id, platform, direction, status, error_detail, idempotency_key)
       VALUES ($1, 'bling', 'pull', 'failed', $2, $3)`,
      [productId, message.slice(0, 500), `bling-detail:${externalId}:${Date.now()}`]
    );
  } catch {
    // A falha de log não pode interromper o cursor da sync.
  }
}

async function stockForBatch(
  erp: ErpConnector,
  batch: BlingProductPayload[]
): Promise<Map<string, BlingStockBalanceItem>> {
  const balances = new Map<string, BlingStockBalanceItem>();
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
      balances.set(row.externalId, row.raw as BlingStockBalanceItem);
    }
  }
  return balances;
}

function stockBySku(payload: BlingProductPayload, balances: Map<string, BlingStockBalanceItem>): Record<string, BlingStockBalanceItem> {
  const mapped: Record<string, BlingStockBalanceItem> = {};
  const parent = balances.get(String(payload.id));
  if (parent && payload.codigo) mapped[payload.codigo] = parent;
  for (const variation of payload.variacoes ?? []) {
    const balance = balances.get(String(variation.id));
    if (balance && variation.codigo) mapped[variation.codigo] = balance;
  }
  return mapped;
}

/**
 * Percorre o catálogo do ERP página a página. Cada lote é gravado e descartado
 * antes da página seguinte. Não publica em marketplace.
 */
export async function runFullCatalogSync(erp: ErpConnector, hooks: FullSyncHooks = {}): Promise<FullSyncReport> {
  const pageSize = hooks.pageSize ?? DEFAULT_PAGE_SIZE;
  const startPage = hooks.startPage && hooks.startPage > 0 ? Math.floor(hooks.startPage) : 1;
  const upsertProduct = hooks.upsertProduct ?? defaultUpsert;
  const scoreProduct = hooks.scoreProduct ?? defaultScore;
  const alreadyImported = hooks.alreadyImported ?? defaultAlreadyImported;
  const report: FullSyncReport = { ...emptyReport(), status: 'running', startedAt: new Date().toISOString(), errors: [] };
  let previousFirst = '';
  let reachedEnd = false;

  const publish = () => hooks.onProgress?.({ ...report, errors: [...report.errors] });
  publish();

  try {
    for (let page = startPage; page <= MAX_PAGES; page += 1) {
      const listed = await erp.listCatalogPage(page, pageSize);
      report.pages = page;
      if (listed.externalIds.length === 0) {
        reachedEnd = true;
        break;
      }
      if (listed.externalIds[0] === previousFirst) {
        note(report, `A página ${page} repetiu o primeiro produto. A paginação parou.`, true);
        reachedEnd = true;
        break;
      }
      previousFirst = listed.externalIds[0] ?? '';

      const batch: BlingProductPayload[] = [];
      for (const externalId of listed.externalIds) {
        report.seen += 1;
        try {
          if (hooks.skipExisting && (await alreadyImported(externalId))) {
            report.skippedExisting += 1;
            continue;
          }
          process.stderr.write(`pull ${externalId}\n`);
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
            continue;
          }
          await hydrateVariations(erp, payload);
          batch.push(payload);
        } catch (error) {
          await recordSyncFailure(externalId, error);
          note(report, `${externalId}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }

      let balances = new Map<string, BlingStockBalanceItem>();
      try {
        balances = await stockForBatch(erp, batch);
      } catch (error) {
        note(report, `saldos: ${error instanceof Error ? error.message : String(error)}`, false);
      }

      for (const payload of batch) {
        try {
          const saved = await upsertProduct(payload, stockBySku(payload, balances));
          report.upserted += 1;
          report.variants += Object.keys(saved.variantIdsBySku).length;
          const ready = await scoreProduct(saved.masterProductId);
          if (ready) report.ready += 1;
          else report.incomplete += 1;
        } catch (error) {
          note(report, `${payload.codigo}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
        publish();
      }

      publish();
      if (listed.done) {
        reachedEnd = true;
        break;
      }
    }
    if (!reachedEnd) {
      note(report, `Limite de ${MAX_PAGES} páginas atingido.`, true);
    }
    report.status = 'done';
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
