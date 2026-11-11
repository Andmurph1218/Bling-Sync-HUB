import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { duplicateConflictLabel, DuplicateConflictType } from '../services/duplicate-detector.service.js';
import { query } from '../db/pool.js';

export const duplicatesRouter = Router();
const reader = requireRole('admin', 'operator');
const writer = requireRole('admin', 'operator');

const resolveSchema = z.object({
  action: z.enum(['link', 'archive']),
});

duplicatesRouter.get('/api/duplicates', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await query<{
      id: string;
      product_id: string;
      erp_sku: string | null;
      name: string | null;
      conflict_type: DuplicateConflictType;
      marketplace: string | null;
      external_id: string;
    }>(
      `SELECT a.id, a.product_id, mp.erp_sku, mp.name, a.conflict_type, a.marketplace, a.external_id
       FROM duplicate_alerts a
       INNER JOIN master_products mp ON mp.id = a.product_id
       WHERE a.status = 'open'
       ORDER BY a.created_at DESC
       LIMIT 200`
    );
    const items = found.rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      sku: row.erp_sku && row.erp_sku.trim() !== '' ? row.erp_sku : 'Sem SKU',
      name: row.name ?? 'Sem nome',
      conflictType: row.conflict_type,
      marketplace: row.marketplace,
      externalId: row.external_id,
      label: duplicateConflictLabel({
        conflictType: row.conflict_type,
        marketplace: row.marketplace,
        externalId: row.external_id,
      }),
    }));
    res.status(200).json({ total: items.length, items });
  } catch (error) {
    next(error);
  }
});

duplicatesRouter.post('/api/duplicates/:id/resolve', writer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const alert = await query<{
      id: string;
      product_id: string;
      conflict_type: DuplicateConflictType;
      marketplace: string | null;
      external_id: string;
      status: string;
    }>(
      `SELECT id, product_id, conflict_type, marketplace, external_id, status
       FROM duplicate_alerts WHERE id = $1`,
      [req.params.id]
    );
    const row = alert.rows[0];
    if (!row || row.status !== 'open') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (parsed.data.action === 'link') {
      if (row.conflict_type !== 'marketplace' || !row.marketplace) {
        res.status(400).json({ error: 'link_requires_marketplace' });
        return;
      }
      await query(
        `INSERT INTO channel_listing_links (product_id, channel, listing_id, link_status)
         VALUES ($1, $2, $3, 'vinculado')
         ON CONFLICT (product_id, channel)
         DO UPDATE SET listing_id = EXCLUDED.listing_id, link_status = 'vinculado'`,
        [row.product_id, row.marketplace, row.external_id]
      );
    } else {
      if (row.conflict_type === 'marketplace') {
        res.status(400).json({ error: 'archive_requires_erp' });
        return;
      }
      await query(
        `UPDATE master_products SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1`,
        [row.product_id]
      );
    }
    await query(
      `UPDATE duplicate_alerts
       SET status = 'resolved', resolved_at = now()
       WHERE status = 'open' AND (id = $1 OR (product_id = $2 AND conflict_type <> 'marketplace'))`,
      [row.id, row.product_id]
    );
    res.status(200).json({ id: row.id, status: 'resolved', action: parsed.data.action });
  } catch (error) {
    next(error);
  }
});
