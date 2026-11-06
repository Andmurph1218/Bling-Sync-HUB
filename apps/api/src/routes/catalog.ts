import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { query, withTransaction } from '../db/pool.js';
import { lookupChannelAttributeSpecs } from '../catalog/channel-attributes.js';
import { listCatalog, CatalogTab } from '../catalog/list.js';
import { listProblems } from '../catalog/problems.js';
import { buildPublishPreview, recalculateCompleteness, PublishChannel } from '../catalog/publish-preview.js';
import { enqueueReadyProducts } from '../queues/publish-queue.js';
import { buildCatalogWorkbook, importCatalogWorkbook } from '../catalog/spreadsheet.js';
import { createErpConnector } from '../connectors/strategy/factory.js';
import { STOCK_LAUNCH_WARNING } from '../connectors/strategy/bling-erp.js';
import { ErpRejectedError } from '../connectors/strategy/types.js';

export const catalogRouter = Router();

const TABS = ['todos', 'publicados', 'completude', 'rejeitados', 'arquivados', 'ready'] as const;

function parseTab(value: unknown): CatalogTab {
  return TABS.includes(value as CatalogTab) ? (value as CatalogTab) : 'todos';
}

catalogRouter.get('/api/problems', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = await listProblems();
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/home', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const listed = await listCatalog({ tab: 'todos', sku: '', name: '', brand: '', page: 1, pageSize: 1 });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [unlinked, sentToday, failedToday, queued, problems, oauth, lastOk, lastError] = await Promise.all([
      query<{ count: number }>(`SELECT count(*)::int AS count FROM matching_queue WHERE status = 'pending'`),
      query<{ count: number }>(
        `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'completed' AND created_at >= $1`,
        [startOfDay.toISOString()]
      ),
      query<{ count: number }>(
        `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'failed' AND created_at >= $1`,
        [startOfDay.toISOString()]
      ),
      query<{ count: number }>(
        `SELECT count(*)::int AS count FROM push_jobs WHERE status IN ('pending', 'locked') AND created_at >= $1`,
        [startOfDay.toISOString()]
      ),
      query<{ count: number }>(`SELECT count(*)::int AS count FROM push_jobs WHERE status = 'failed'`),
      query<{ provider: string; expires_at: Date | string; has_refresh: boolean }>(
        `SELECT provider, expires_at, (refresh_token_enc IS NOT NULL) AS has_refresh FROM oauth_tokens`
      ),
      query<{ last_ok: Date | string | null }>(
        `SELECT max(created_at) AS last_ok FROM push_jobs WHERE status = 'completed'`
      ),
      query<{ last_error: Date | string | null }>(
        `SELECT max(created_at) AS last_error FROM push_jobs WHERE status = 'failed'`
      ),
    ]);
    const publicationsToday =
      (sentToday.rows[0]?.count ?? 0) +
      (failedToday.rows[0]?.count ?? 0) +
      (queued.rows[0]?.count ?? 0);
    const active = listed.counts.todos;
    const ready = listed.counts.ready;
    res.status(200).json({
      cards: {
        products: { value: listed.counts.todos, href: '/catalogo' },
        ready: { value: listed.counts.ready, href: '/catalogo?status=ready' },
        incomplete: { value: listed.counts.completude, href: '/completude' },
        unlinked: { value: unlinked.rows[0]?.count ?? 0, href: '/vinculos' },
        syncProblems: { value: problems.rows[0]?.count ?? 0, href: '/problemas' },
        publicationsToday: {
          value: publicationsToday,
          sent: sentToday.rows[0]?.count ?? 0,
          failed: failedToday.rows[0]?.count ?? 0,
          queued: queued.rows[0]?.count ?? 0,
          href: '/publicacoes',
        },
      },
      completenessPct: active === 0 ? 0 : Math.round((ready / active) * 100),
      gaps: listed.gaps,
      channels: oauth.rows,
      lastSyncOk: lastOk.rows[0]?.last_ok ?? null,
      lastSyncError: lastError.rows[0]?.last_error ?? null,
      counts: listed.counts,
    });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/products', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 50);
    const listed = await listCatalog({
      tab: parseTab(req.query.status),
      sku: String(req.query.sku ?? ''),
      name: String(req.query.name ?? ''),
      brand: String(req.query.brand ?? ''),
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      gap: String(req.query.pendencia ?? '') || undefined,
    });
    res.status(200).json(listed);
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/products/:blingId/variants', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query<{
      id: string;
      bling_sku: string;
      price: string | null;
      stock: string | null;
      ean: string | null;
    }>(
      `SELECT pv.id, pv.bling_sku, pv.price::text AS price, pv.stock::text AS stock, pv.ean
       FROM product_variants pv
       INNER JOIN master_products mp ON mp.id = pv.master_product_id
       WHERE mp.bling_id = $1 AND mp.catalog_status = 'active'
       ORDER BY pv.is_default DESC, pv.bling_sku ASC`,
      [req.params.blingId]
    );
    res.status(200).json({
      variants: rows.rows.map((row) => ({
        id: row.id,
        sku: row.bling_sku,
        price: row.price,
        stock: row.stock === null ? null : Math.floor(Number(row.stock)),
        ean: row.ean,
      })),
    });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/products/:blingId/sheet', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listed = await listCatalog({
      tab: 'todos',
      sku: '',
      name: '',
      brand: '',
      page: 1,
      pageSize: 1,
      blingId: req.params.blingId,
    });
    const archived = listed.items[0]
      ? { items: [] as typeof listed.items }
      : await listCatalog({
          tab: 'arquivados',
          sku: '',
          name: '',
          brand: '',
          page: 1,
          pageSize: 1,
          blingId: req.params.blingId,
        });
    const item = listed.items[0] ?? archived.items[0];
    if (!item) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const [images, links, prices, category] = await Promise.all([
      query<{ url_normalized: string; is_cover_eligible: boolean; position_ml: number | null; position_ns: number | null; rights_status: string }>(
        `SELECT url_normalized, is_cover_eligible, position_ml, position_ns, rights_status
         FROM product_images WHERE master_product_id = $1
         ORDER BY is_cover_eligible DESC, position_ml`,
        [item.id]
      ),
      query<{ platform: string; sync_status: string; platform_product_id: string }>(
        `SELECT platform, sync_status, platform_product_id FROM platform_links WHERE master_product_id = $1`,
        [item.id]
      ),
      query<{ platform: string; store_price: string | null; store_promotional_price: string | null }>(
        `SELECT vcp.platform, vcp.store_price::text AS store_price, vcp.store_promotional_price::text AS store_promotional_price
         FROM variant_channel_prices vcp
         INNER JOIN product_variants pv ON pv.id = vcp.variant_id
         WHERE pv.master_product_id = $1 AND pv.is_default = true`,
        [item.id]
      ),
      query<{ id: string; name: string }>(
        `SELECT c.id, c.name
         FROM hub_categories c
         INNER JOIN master_products mp ON mp.hub_category_id = c.id
         WHERE mp.id = $1`,
        [item.id]
      ),
    ]);
    res.status(200).json({
      item,
      images: images.rows,
      links: links.rows,
      storePrices: prices.rows,
      category: category.rows[0] ?? null,
    });
  } catch (error) {
    next(error);
  }
});

async function setArchived(ids: string[], archived: boolean): Promise<number> {
  let count = 0;
  for (const id of ids) {
    const updated = archived
      ? await query<{ id: string }>(
          `UPDATE master_products
           SET archived_at = now(), updated_at = now()
           WHERE id = $1 AND catalog_status = 'active'
           RETURNING id`,
          [id]
        )
      : await query<{ id: string }>(
          `UPDATE master_products
           SET archived_at = NULL, updated_at = now()
           WHERE id = $1 AND catalog_status = 'active'
           RETURNING id`,
          [id]
        );
    count += updated.rows.length;
  }
  return count;
}

catalogRouter.post(
  '/api/catalog/products/:id/archive',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await setArchived([req.params.id], true);
      if (count === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ archived: true, erpUntouched: true });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/products/:id/unarchive',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await setArchived([req.params.id], false);
      if (count === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ archived: false, erpUntouched: true });
    } catch (error) {
      next(error);
    }
  }
);

const bulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

catalogRouter.post(
  '/api/catalog/products/archive-bulk',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const count = await setArchived(parsed.data.ids, true);
      res.status(200).json({ archived: count, erpUntouched: true });
    } catch (error) {
      next(error);
    }
  }
);

const sendListSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  channel: z.enum(['mercadolivre', 'nuvemshop']).default('mercadolivre'),
});

catalogRouter.post(
  '/api/catalog/products/send-list',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = sendListSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const result = await enqueueReadyProducts(parsed.data.ids, parsed.data.channel);
      res.status(202).json({ ...result, published: false });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/products/recalculate-completeness',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const items = await recalculateCompleteness(parsed.data.ids);
      res.status(200).json({ items, published: false });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/publish/batch',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = sendListSchema.safeParse(req.body ?? { ids: req.body?.ids, channel: 'mercadolivre' });
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const result = await enqueueReadyProducts(parsed.data.ids, parsed.data.channel);
      res.status(202).json({ ...result, published: false });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/:id/simulate',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!z.string().uuid().safeParse(req.params.id).success) {
        res.status(400).json({ error: 'invalid_product_id' });
        return;
      }
      const channel = req.query.channel === 'nuvemshop' ? 'nuvemshop' : 'mercadolivre';
      const preview = await buildPublishPreview(req.params.id, channel as PublishChannel);
      if (!preview) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json(preview);
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/products/:id/simulate-publish',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const channel = req.query.channel === 'nuvemshop' ? 'nuvemshop' : 'mercadolivre';
      const preview = await buildPublishPreview(req.params.id, channel as PublishChannel);
      if (!preview) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json(preview);
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get(
  '/api/catalog/publish-queue',
  requireRole('operator', 'admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await query<{
        id: string;
        channel: string;
        status: string;
        error_message: string | null;
        sku: string;
        name: string | null;
        bling_id: string;
      }>(
        `SELECT pq.id, pq.channel, pq.status, pq.error_message, mp.bling_sku AS sku, mp.name, mp.bling_id
         FROM publish_queue pq
         INNER JOIN master_products mp ON mp.id = pq.product_id
         ORDER BY pq.created_at DESC
         LIMIT 50`
      );
      res.status(200).json({ items: rows.rows, published: false });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get('/api/catalog/lookup', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sku = String(req.query.sku ?? '').trim();
    if (!sku) {
      res.status(200).json({ found: false });
      return;
    }
    const found = await query<{ id: string; bling_id: string; name: string | null; bling_sku: string }>(
      `SELECT id, bling_id, name, bling_sku FROM master_products WHERE bling_sku = $1 AND catalog_status = 'active' LIMIT 1`,
      [sku]
    );
    const row = found.rows[0];
    res.status(200).json(row ? { found: true, product: row } : { found: false });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/check-exists', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const term = String(req.query.term ?? '').trim();
    if (!term) {
      res.status(400).json({ error: 'term_required' });
      return;
    }
    const found = await query<{ id: string; bling_id: string; bling_sku: string; name: string | null; ean: string | null }>(
      `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name, pv.ean
       FROM master_products mp
       LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
       WHERE mp.catalog_status = 'active'
         AND (lower(mp.bling_sku) = lower($1) OR pv.ean = $1)
       LIMIT 1`,
      [term]
    );
    const row = found.rows[0];
    res.status(200).json(
      row
        ? {
            exists: true,
            product: { id: row.id, blingId: row.bling_id, sku: row.bling_sku, name: row.name, ean: row.ean },
          }
        : { exists: false }
    );
  } catch (error) {
    next(error);
  }
});

catalogRouter.post(
  '/api/catalog/products',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z
        .object({
          sku: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(300),
          price: z.number().finite().nonnegative(),
          stock: z.number().finite().nonnegative(),
          imageUrl: z.string().trim().max(2000).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const existing = await query<{ bling_id: string }>(
        `SELECT mp.bling_id
         FROM master_products mp
         LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
         WHERE mp.catalog_status = 'active'
           AND (lower(mp.bling_sku) = lower($1) OR pv.ean = $1)
         LIMIT 1`,
        [parsed.data.sku]
      );
      if (existing.rows[0]) {
        res.status(409).json({
          error: 'already_exists',
          product: { blingId: existing.rows[0].bling_id },
        });
        return;
      }
      let erpId = '';
      let stockWarning: string | null = null;
      try {
        const createdErp = await createErpConnector('bling').createProduct({
          name: parsed.data.name,
          sku: parsed.data.sku,
          price: parsed.data.price,
          stock: parsed.data.stock,
        });
        erpId = createdErp.erp_id;
        stockWarning = createdErp.stockWarning;
      } catch (error) {
        if (error instanceof ErpRejectedError) {
          res.status(422).json({ error: 'bling_rejected', message: `Erro no Bling: ${error.message}` });
          return;
        }
        throw error;
      }
      if (!erpId || erpId.startsWith('local-')) {
        res.status(422).json({ error: 'bling_rejected', message: 'Erro no Bling: o ERP não devolveu um ID oficial.' });
        return;
      }
      const created = await query<{ id: string; bling_id: string }>(
        `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
         VALUES ($1, $2, $3, 'P', 'S')
         RETURNING id, bling_id`,
        [erpId, parsed.data.sku, parsed.data.name]
      );
      const product = created.rows[0]!;
      await query(
        `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, stock)
         VALUES ($1, $2, true, 'S', $3, $4)`,
        [product.id, parsed.data.sku, parsed.data.price, parsed.data.stock]
      );
      if (parsed.data.imageUrl && /^https?:\/\//i.test(parsed.data.imageUrl)) {
        await query(
          `INSERT INTO product_images (
             master_product_id, source_url, url_normalized, source_platform, is_cover_eligible, rights_status
           ) VALUES ($1, $2, $2, 'bling', true, 'owned')`,
          [product.id, parsed.data.imageUrl]
        );
      }
      if (stockWarning) {
        await query(
          `INSERT INTO sync_logs (product_id, platform, direction, status, error_detail, idempotency_key)
           VALUES ($1, 'bling', 'outbound', 'failed', $2, $3)`,
          [product.id, STOCK_LAUNCH_WARNING, `bling-stock:${erpId}`]
        );
      }
      res.status(201).json({
        id: product.id,
        blingId: product.bling_id,
        sku: parsed.data.sku,
        price: parsed.data.price,
        stock: parsed.data.stock,
        stockWarning,
      });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get('/api/catalog/export', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const file = await buildCatalogWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="catalogo.xlsx"');
    res.status(200).send(file);
  } catch (error) {
    next(error);
  }
});

catalogRouter.post(
  '/api/catalog/import',
  requireRole('operator', 'admin'),
  express.raw({ type: () => true, limit: '8mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (file.length < 4) {
        res.status(400).json({ error: 'invalid_file' });
        return;
      }
      const report = await importCatalogWorkbook(file);
      res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get('/api/catalog/categories', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query<{ id: string; parent_id: string | null; name: string }>(
      `SELECT id, parent_id, name FROM hub_categories ORDER BY name ASC`
    );
    res.status(200).json({ categories: rows.rows });
  } catch (error) {
    next(error);
  }
});

const categorySchema = z.object({
  name: z.string().min(2),
  parentId: z.string().uuid().nullable().optional(),
});

catalogRouter.post(
  '/api/catalog/categories',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = categorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const created = await query<{ id: string; name: string; parent_id: string | null }>(
        `INSERT INTO hub_categories (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id`,
        [parsed.data.name.trim(), parsed.data.parentId ?? null]
      );
      res.status(201).json({ category: created.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.put(
  '/api/catalog/products/:id/category',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z.string().uuid().nullable().safeParse(req.body?.hubCategoryId ?? null);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const hubCategoryId = parsed.data;
      const updated = await query(
        `UPDATE master_products SET hub_category_id = $2, updated_at = now()
         WHERE id = $1 AND catalog_status = 'active'`,
        [req.params.id, hubCategoryId]
      );
      if ((updated.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ hubCategoryId });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get('/api/catalog/channel-attributes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const platform = req.query.platform === 'nuvemshop' ? 'nuvemshop' : 'mercadolivre';
    const channelCategoryId = String(req.query.channelCategoryId ?? '');
    res.status(200).json(lookupChannelAttributeSpecs(platform, channelCategoryId));
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/api/catalog/categories/:id/channels', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const maps = await query<{
      id: string;
      platform: string;
      channel_category_id: string;
      channel_category_name: string;
      channel_attribute_id: string | null;
      channel_attribute_name: string | null;
      required: boolean | null;
      mode: string | null;
      fixed_value: string | null;
      source_field: string | null;
      attribute_map_id: string | null;
    }>(
      `SELECT cm.id, cm.platform, cm.channel_category_id, cm.channel_category_name,
              am.id AS attribute_map_id, am.channel_attribute_id, am.channel_attribute_name,
              am.required, am.mode, am.fixed_value, am.source_field
       FROM channel_category_maps cm
       LEFT JOIN channel_attribute_maps am ON am.channel_category_map_id = cm.id
       WHERE cm.hub_category_id = $1
       ORDER BY cm.platform, am.channel_attribute_id`,
      [req.params.id]
    );
    res.status(200).json({ rows: maps.rows });
  } catch (error) {
    next(error);
  }
});

const saveChannelSchema = z.object({
  channelCategoryId: z.string().min(1),
  channelCategoryName: z.string().min(1),
  attributes: z.array(z.object({
    channelAttributeId: z.string().min(1),
    channelAttributeName: z.string().min(1),
    required: z.boolean(),
    mode: z.enum(['fixed', 'dynamic', 'manual']),
    fixedValue: z.string().nullable().optional(),
    sourceField: z.string().nullable().optional(),
    valueMaps: z.array(z.object({ hubValue: z.string().min(1), channelValue: z.string().min(1) })).optional(),
  })),
});

catalogRouter.put(
  '/api/catalog/categories/:id/channels/:platform',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const platform = req.params.platform;
      if (platform !== 'mercadolivre' && platform !== 'nuvemshop') {
        res.status(400).json({ error: 'invalid_platform' });
        return;
      }
      const parsed = saveChannelSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      await withTransaction(async (client) => {
        const mapRes = await client.query<{ id: string }>(
          `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (hub_category_id, platform) DO UPDATE
             SET channel_category_id = EXCLUDED.channel_category_id,
                 channel_category_name = EXCLUDED.channel_category_name
           RETURNING id`,
          [req.params.id, platform, parsed.data.channelCategoryId, parsed.data.channelCategoryName]
        );
        const mapId = mapRes.rows[0]!.id;
        await client.query(`DELETE FROM channel_attribute_maps WHERE channel_category_map_id = $1`, [mapId]);
        for (const attribute of parsed.data.attributes) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO channel_attribute_maps (
               channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value, source_field
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              mapId,
              attribute.channelAttributeId,
              attribute.channelAttributeName,
              attribute.required,
              attribute.mode,
              attribute.fixedValue ?? null,
              attribute.sourceField ?? null,
            ]
          );
          for (const value of attribute.valueMaps ?? []) {
            await client.query(
              `INSERT INTO channel_attribute_value_maps (channel_attribute_map_id, hub_value, channel_value)
               VALUES ($1, $2, $3)`,
              [inserted.rows[0]!.id, value.hubValue, value.channelValue]
            );
          }
        }
      });
      res.status(200).json({ saved: true });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.post(
  '/api/catalog/products/:id/cover',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z.object({ url: z.string().trim().min(8).max(2000) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const product = await query<{ id: string; bling_id: string }>(
        `SELECT id, bling_id FROM master_products WHERE id = $1 AND catalog_status = 'active'`,
        [req.params.id]
      );
      const row = product.rows[0];
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await query(
        `INSERT INTO product_images (
           master_product_id, source_url, url_normalized, source_platform, is_cover_eligible, rights_status
         ) VALUES ($1, $2, $2, 'bling', true, 'owned')
         ON CONFLICT (master_product_id, url_normalized)
         DO UPDATE SET is_cover_eligible = true, updated_at = now()`,
        [row.id, parsed.data.url]
      );
      const listed = await listCatalog({
        tab: 'todos',
        sku: '',
        name: '',
        brand: '',
        page: 1,
        pageSize: 1,
        blingId: row.bling_id,
      });
      res.status(200).json({
        checklist: listed.items[0]?.checklist ?? null,
        recalculatedOnRead: true,
      });
    } catch (error) {
      next(error);
    }
  }
);

catalogRouter.get('/api/catalog/problems', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query<{
      id: string;
      bling_id: string;
      bling_sku: string;
      name: string | null;
      platform: string;
      job_kind: string;
      created_at: Date | string;
    }>(
      `SELECT j.id, mp.bling_id, mp.bling_sku, mp.name, j.platform, j.job_kind, j.created_at
       FROM push_jobs j
       INNER JOIN master_products mp ON mp.id = j.master_product_id
       WHERE j.status = 'failed'
       ORDER BY j.created_at DESC
       LIMIT 100`
    );
    const total = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM push_jobs WHERE status = 'failed'`
    );
    res.status(200).json({ total: total.rows[0]?.count ?? 0, items: rows.rows });
  } catch (error) {
    next(error);
  }
});
