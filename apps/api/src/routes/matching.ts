import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { query } from '../db/pool.js';
import { createMarketplaceConnector } from '../connectors/strategy/factory.js';
import { RemoteListing } from '../connectors/strategy/types.js';

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
