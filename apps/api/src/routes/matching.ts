import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { query } from '../db/pool.js';
import { createMarketplaceConnector } from '../connectors/strategy/factory.js';
import { RemoteListing } from '../connectors/strategy/types.js';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels.js';

export const matchingRouter = Router();

const linkSchema = z.object({
  productId: z.string().uuid(),
  listingId: z.string().min(3).max(40),
  title: z.string().max(300).optional(),
  price: z.number().nullable().optional(),
  status: z.string().max(40).optional(),
});

function money(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

matchingRouter.get(
  '/api/matching/search',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sku = String(req.query.sku ?? '').trim();
      if (sku.length < 1) {
        res.status(400).json({ error: 'sku_required' });
        return;
      }
      const product = await query<{
        id: string;
        bling_id: string;
        bling_sku: string;
        name: string | null;
        price: string | null;
        stock: string | null;
        ean: string | null;
        link_status: string | null;
        listing_id: string | null;
      }>(
        `SELECT mp.id, mp.bling_id, mp.bling_sku, mp.name,
                pv.price::text AS price, pv.stock::text AS stock, pv.ean,
                cl.link_status, cl.listing_id
         FROM master_products mp
         LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
         LEFT JOIN channel_listing_links cl ON cl.product_id = mp.id AND cl.channel = 'mercadolivre'
         WHERE mp.catalog_status = 'active'
           AND (mp.bling_sku = $1 OR pv.ean = $1)
         ORDER BY CASE WHEN mp.bling_sku = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [sku]
      );
      const row = product.rows[0] ?? null;
      let listings: RemoteListing[] = [];
      let warning: string | null = null;
      try {
        const connector = createMarketplaceConnector('mercadolivre');
        listings = await connector.searchListings({ sku, ean: row?.ean ?? null });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        warning = /authenticate data|Credencial OAuth ausente|Falha ao renovar|mercadolivre_http_401/.test(message)
          ? 'O Mercado Livre precisa ser reautorizado antes da busca de anúncios.'
          : 'Não foi possível consultar o Mercado Livre agora.';
      }
      const listing = listings[0] ?? null;
      res.status(200).json({
        published: false,
        warning,
        hub: row
          ? {
              id: row.id,
              blingId: row.bling_id,
              sku: row.bling_sku || 'Sem SKU',
              name: row.name ?? 'Sem nome',
              ean: row.ean,
              price: money(row.price),
              stock: row.stock === null ? null : Math.floor(Number(row.stock)),
              status: row.link_status === 'vinculado' ? 'Vinculado' : 'Sem vínculo',
              listingId: row.listing_id,
            }
          : null,
        listing: listing
          ? { id: listing.id, title: listing.title, price: listing.price, status: listing.status }
          : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

matchingRouter.post(
  '/api/matching/link',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = linkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const product = await query<{ id: string }>(
        `SELECT id FROM master_products WHERE id = $1 AND catalog_status = 'active'`,
        [parsed.data.productId]
      );
      if (!product.rows[0]) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const saved = await query<{ id: string }>(
        `INSERT INTO channel_listing_links (
           product_id, channel, listing_id, listing_title, listing_price, listing_status, link_status
         ) VALUES ($1, 'mercadolivre', $2, $3, $4, $5, 'vinculado')
         ON CONFLICT (product_id, channel)
         DO UPDATE SET
           listing_id = EXCLUDED.listing_id,
           listing_title = EXCLUDED.listing_title,
           listing_price = EXCLUDED.listing_price,
           listing_status = EXCLUDED.listing_status,
           link_status = 'vinculado'
         RETURNING id`,
        [
          parsed.data.productId,
          parsed.data.listingId,
          parsed.data.title ?? null,
          parsed.data.price ?? null,
          parsed.data.status ?? null,
        ]
      );
      const queued = await query<{ count: number }>(
        `SELECT count(*)::int AS count FROM publish_queue WHERE product_id = $1`,
        [parsed.data.productId]
      );
      res.status(200).json({
        id: saved.rows[0]?.id,
        status: 'Vinculado',
        published: false,
        queued: queued.rows[0]?.count ?? 0,
      });
    } catch (error) {
      next(error);
    }
  }
);

function activePlatformSql(): string {
  return MERCADO_LIVRE_ACTIVE ? `pl.platform IN ('mercadolivre', 'nuvemshop')` : `pl.platform = 'nuvemshop'`;
}

matchingRouter.get(
  '/api/matching/links',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = String(req.query.q ?? '').trim().toLowerCase();
      const status = String(req.query.status ?? 'todos');
      const platformSql = activePlatformSql();
      const [rows, active, orphans, unlinked] = await Promise.all([
        query<{
          id: string;
          platform: string;
          platform_product_id: string;
          match_method: string;
          sync_status: string;
          confirmed_at: Date | null;
          last_synced_at: Date | null;
          bling_id: string;
          bling_sku: string | null;
          name: string | null;
          price: string | null;
          platform_price: string | null;
        }>(
          `SELECT pl.id, pl.platform, pl.platform_product_id, pl.match_method, pl.sync_status,
                  pl.confirmed_at, pl.last_synced_at, mp.bling_id, mp.bling_sku, mp.name,
                  pv.price::text AS price, pvl.platform_price::text AS platform_price
           FROM platform_links pl
           INNER JOIN master_products mp ON mp.id = pl.master_product_id
           LEFT JOIN product_variants pv ON pv.master_product_id = mp.id AND pv.is_default = true
           LEFT JOIN platform_variant_links pvl
             ON pvl.platform = pl.platform AND pvl.platform_product_id = pl.platform_product_id AND pvl.variant_id = pv.id
           WHERE ${platformSql}
             AND ($1 = '' OR lower(COALESCE(mp.bling_sku, '')) LIKE $2 OR lower(pl.platform_product_id) LIKE $2 OR lower(COALESCE(mp.name, '')) LIKE $2)
             AND (
               $3 = 'todos'
               OR ($3 = 'ativos' AND pl.sync_status <> 'channel_deleted')
               OR ($3 = 'orfaos' AND (
                 pl.sync_status = 'channel_deleted'
                 OR (pv.price > 0 AND pvl.platform_price IS NOT NULL AND abs(pvl.platform_price - pv.price) / pv.price > 0.15)
               ))
             )
           ORDER BY pl.last_synced_at DESC NULLS LAST
           LIMIT 200`,
          [term, `%${term}%`, status]
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM platform_links pl WHERE ${platformSql} AND pl.sync_status <> 'channel_deleted'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM platform_links pl WHERE ${platformSql} AND pl.sync_status = 'channel_deleted'`
        ),
        query<{ count: number }>(
          `SELECT count(*)::int AS count FROM master_products mp
           WHERE mp.catalog_status = 'active' AND mp.archived_at IS NULL
             AND mp.id NOT IN (
               SELECT master_product_id FROM platform_links pl
               WHERE ${platformSql} AND pl.sync_status <> 'channel_deleted'
             )`
        ),
      ]);
      const items = rows.rows.map((row) => {
        const hubPrice = row.price === null ? null : Number(row.price);
        const channelPrice = row.platform_price === null ? null : Number(row.platform_price);
        const divergent = hubPrice !== null && hubPrice > 0 && channelPrice !== null && Math.abs(channelPrice - hubPrice) / hubPrice > 0.15;
        const visual = row.sync_status === 'channel_deleted' ? 'orphan' : divergent ? 'divergent' : 'active';
        return {
          id: row.id,
          platform: row.platform,
          externalId: row.platform_product_id,
          method: row.match_method,
          status: visual,
          createdAt: row.confirmed_at ?? row.last_synced_at,
          sku: row.bling_sku || 'Sem SKU',
          name: row.name ?? 'Sem nome',
          blingId: row.bling_id,
        };
      });
      res.status(200).json({
        kpis: {
          active: active.rows[0]?.count ?? 0,
          orphans: orphans.rows[0]?.count ?? 0,
          unlinked: unlinked.rows[0]?.count ?? 0,
        },
        items,
      });
    } catch (error) {
      next(error);
    }
  }
);

matchingRouter.get(
  '/api/matching/products',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = String(req.query.q ?? '').trim().toLowerCase();
      if (term.length < 2) {
        res.status(200).json({ items: [] });
        return;
      }
      const rows = await query<{ id: string; bling_sku: string | null; name: string | null }>(
        `SELECT id, bling_sku, name FROM master_products
         WHERE catalog_status = 'active'
           AND (lower(COALESCE(bling_sku, '')) LIKE $1 OR lower(COALESCE(name, '')) LIKE $1)
         ORDER BY bling_sku NULLS LAST
         LIMIT 8`,
        [`%${term}%`]
      );
      res.status(200).json({
        items: rows.rows.map((row) => ({ id: row.id, sku: row.bling_sku || 'Sem SKU', name: row.name ?? 'Sem nome' })),
      });
    } catch (error) {
      next(error);
    }
  }
);

matchingRouter.post(
  '/api/matching/links',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z.object({
        productId: z.string().uuid(),
        externalId: z.string().trim().min(1).max(80),
        platform: z.enum(['nuvemshop', 'mercadolivre']).default('nuvemshop'),
      }).safeParse(req.body);
      if (!parsed.success || (!MERCADO_LIVRE_ACTIVE && parsed.data?.platform === 'mercadolivre')) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const data = parsed.data!;
      const inserted = await query<{ id: string }>(
        `INSERT INTO platform_links (
           master_product_id, platform, platform_product_id, match_method, match_confidence, confirmed_by, confirmed_at, sync_status, last_synced_at
         ) VALUES ($1, $2, $3, 'manual', 100, $4, now(), 'linked', now())
         ON CONFLICT (platform, platform_product_id) DO UPDATE
           SET master_product_id = EXCLUDED.master_product_id,
               match_method = 'manual',
               confirmed_by = EXCLUDED.confirmed_by,
               confirmed_at = now(),
               sync_status = 'linked',
               last_synced_at = now()
         RETURNING id`,
        [data.productId, data.platform, data.externalId, req.user?.id ?? null]
      );
      res.status(200).json({ id: inserted.rows[0]?.id, published: false });
    } catch (error) {
      next(error);
    }
  }
);

matchingRouter.delete(
  '/api/matching/links/:id',
  requireRole('operator', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await query(`DELETE FROM platform_links WHERE id = $1`, [req.params.id]);
      if ((removed.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json({ removed: true, marketplaceUntouched: true });
    } catch (error) {
      next(error);
    }
  }
);
