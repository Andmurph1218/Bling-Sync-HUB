import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { query } from '../db/pool.js';

function asPayload(value: unknown): {
  price: number | null;
  stock: number | null;
  title: string | null;
  images: string[];
  status: string | null;
  alerts: Array<{ kind: string; message: string }>;
} {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  return {
    price: typeof record.price === 'number' ? record.price : null,
    stock: typeof record.stock === 'number' ? record.stock : null,
    title: typeof record.title === 'string' ? record.title : null,
    images: asImages(record.images),
    status: typeof record.status === 'string' ? record.status : null,
    alerts: Array.isArray(record.alerts)
      ? record.alerts.flatMap((alert) => {
          if (!alert || typeof alert !== 'object') return [];
          const item = alert as { kind?: unknown; message?: unknown };
          if (typeof item.kind !== 'string' || typeof item.message !== 'string') return [];
          return [{ kind: item.kind, message: item.message }];
        })
      : [],
  };
}

function asImages(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
}

export const reconciliationRouter = Router();
const reader = requireRole('admin', 'operator');
const writer = requireRole('admin', 'operator');

reconciliationRouter.get('/api/divergences', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await query<{
      product_id: string;
      erp_id: string;
      erp_sku: string | null;
      name: string | null;
      marketplace: string;
      payload_json: unknown;
    }>(
      `SELECT s.product_id, mp.erp_id, mp.erp_sku, mp.name, s.marketplace, s.payload_json
       FROM marketplace_listings_snapshot s
       INNER JOIN master_products mp ON mp.id = s.product_id
       ORDER BY s.last_synced_at DESC
       LIMIT 200`
    );
    const items = found.rows.flatMap((row) => asPayload(row.payload_json).alerts.map((alert) => ({
      id: `${row.product_id}:${row.marketplace}:${alert.kind}`,
      productId: row.product_id,
      erpId: row.erp_id,
      sku: row.erp_sku && row.erp_sku.trim() !== '' ? row.erp_sku : 'Sem SKU',
      name: row.name ?? 'Sem nome',
      marketplace: row.marketplace,
      kind: alert.kind,
      message: alert.message,
    })));
    res.status(200).json({ total: items.length, items });
  } catch (error) {
    next(error);
  }
});

reconciliationRouter.get('/api/catalog/products/:id/places', reader, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await query<{
      location_type: string;
      store_id: string;
      quantity: number;
      user_product_id: string;
    }>(
      `SELECT l.location_type, l.store_id, l.quantity, l.user_product_id
       FROM ml_stock_locations l
       INNER JOIN platform_variant_links pvl ON pvl.user_product_id = l.user_product_id
       WHERE pvl.master_product_id = $1 AND pvl.platform = 'mercadolivre'
       ORDER BY l.location_type, l.store_id`,
      [req.params.id]
    );
    res.status(200).json({
      supported: found.rows.length > 0,
      places: found.rows.map((row) => ({
        locationType: row.location_type,
        storeId: row.store_id,
        quantity: Number(row.quantity) || 0,
        userProductId: row.user_product_id,
        readOnly: row.location_type === 'meli_facility',
        label: row.location_type === 'meli_facility' ? 'Full, somente leitura' : row.location_type,
      })),
    });
  } catch (error) {
    next(error);
  }
});

reconciliationRouter.get('/api/catalog/products/:id/channel-snapshots', reader, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await query<{
      marketplace: string;
      external_id: string;
      payload_json: unknown;
      last_synced_at: Date | string;
    }>(
      `SELECT marketplace, external_id, payload_json, last_synced_at
       FROM marketplace_listings_snapshot
       WHERE product_id = $1
       ORDER BY marketplace`,
      [req.params.id]
    );
    res.status(200).json({
      snapshots: found.rows.map((row) => {
        const payload = asPayload(row.payload_json);
        return {
          marketplace: row.marketplace,
          externalId: row.external_id,
          price: payload.price,
          stock: payload.stock,
          title: payload.title,
          images: payload.images,
          status: payload.status,
          lastSyncedAt: new Date(row.last_synced_at).toISOString(),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

const importSchema = z.object({
  marketplace: z.string().min(2),
  url: z.string().url(),
});

reconciliationRouter.post(
  '/api/catalog/products/:id/images/import-channel',
  writer,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = importSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const snapshot = await query<{ payload_json: unknown }>(
        `SELECT payload_json FROM marketplace_listings_snapshot WHERE product_id = $1 AND marketplace = $2`,
        [req.params.id, parsed.data.marketplace]
      );
      const allowed = asPayload(snapshot.rows[0]?.payload_json).images.includes(parsed.data.url);
      if (!allowed) {
        res.status(404).json({ error: 'image_not_in_snapshot' });
        return;
      }
      const platform = parsed.data.marketplace === 'mercadolivre' || parsed.data.marketplace === 'nuvemshop'
        ? parsed.data.marketplace
        : 'erp';
      await query(
        `INSERT INTO product_images (
           master_product_id, source_url, url_normalized, source_platform, is_cover_eligible, rights_status
         ) VALUES ($1, $2, $2, $3, true, 'owned')
         ON CONFLICT (master_product_id, url_normalized)
         DO UPDATE SET is_cover_eligible = true, updated_at = now()`,
        [req.params.id, parsed.data.url, platform]
      );
      const current = asPayload(snapshot.rows[0]?.payload_json);
      await query(
        `UPDATE marketplace_listings_snapshot
         SET payload_json = $3
         WHERE product_id = $1 AND marketplace = $2`,
        [req.params.id, parsed.data.marketplace, JSON.stringify({ ...current, alerts: current.alerts.filter((alert) => alert.kind !== 'enrichment') })]
      );
      res.status(201).json({ imported: true, url: parsed.data.url });
    } catch (error) {
      next(error);
    }
  }
);
