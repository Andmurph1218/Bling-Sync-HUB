import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { query } from '../db/pool.js';

export const integrationCatalogRouter = Router();
const admin = requireRole('admin');

const slugSchema = z.string().regex(/^[a-z0-9_-]{2,40}$/);

interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  category: 'Marketplace' | 'ERP' | 'Logística';
  logo_url: string | null;
  is_installed: boolean;
  is_available: boolean;
  has_credentials: boolean;
  has_token: boolean;
  token_valid: boolean;
}

integrationCatalogRouter.get('/api/admin/integrations', admin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query<CatalogRow>(
      `SELECT c.id, c.name, c.slug, c.category, c.logo_url, c.is_installed, c.is_available,
              (cred.client_id IS NOT NULL AND cred.is_active = true) AS has_credentials,
              (tok.provider IS NOT NULL) AS has_token,
              (
                tok.provider IS NOT NULL
                AND (
                  c.slug = 'nuvemshop'
                  OR (c.slug = 'bling' AND tok.refresh_token_enc IS NOT NULL)
                  OR (tok.expires_at IS NOT NULL AND tok.expires_at > now())
                )
              ) AS token_valid
       FROM integration_catalog c
       LEFT JOIN channel_app_credentials cred ON cred.provider = c.slug
       LEFT JOIN oauth_tokens tok ON tok.provider = c.slug
       ORDER BY c.category, c.name`
    );
    const apps = rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      logoUrl: row.logo_url,
      isInstalled: row.has_credentials || row.is_installed,
      isAvailable: row.is_available,
      hasCredentials: row.has_credentials,
      hasToken: row.has_token,
      tokenValid: row.token_valid,
      health: !row.is_available ? 'soon' : row.has_credentials && row.token_valid ? 'ok' : row.has_credentials ? 'attention' : 'available',
    }));
    const order = ['Marketplace', 'ERP', 'Logística'] as const;
    const groups = order.map((category) => ({
      category,
      apps: apps.filter((app) => app.category === category),
    }));
    res.status(200).json({ groups });
  } catch (error) {
    next(error);
  }
});

integrationCatalogRouter.post(
  '/api/admin/integrations/:slug/request',
  admin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = slugSchema.safeParse(req.params.slug);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_slug' });
        return;
      }
      const saved = await query<{ id: string }>(
        `INSERT INTO integration_requests (slug, requested_by) VALUES ($1, $2) RETURNING id`,
        [parsed.data, req.user?.id ?? null]
      );
      res.status(201).json({ id: saved.rows[0]?.id, slug: parsed.data, requested: true });
    } catch (error) {
      next(error);
    }
  }
);
