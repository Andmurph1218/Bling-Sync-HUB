import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { extractOpaqueToken, requireAuth, requireRole } from '../auth/middleware.js';
import { authenticateUser, createUser, revokeSessionByToken } from '../auth/service.js';
import { ROLES } from '../auth/types.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  roles: z.array(z.enum(ROLES)).min(1),
});

const updateWarehouseControlSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['unclassified', 'seller', 'ml_full', 'other']),
  include_in_push: z.boolean(),
});

const updateSyncOwnerSchema = z.object({
  stock_price: z.enum(['bling_native', 'hub']),
  content: z.enum(['bling_native', 'hub']),
});

authRouter.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
      return;
    }

    const result = await authenticateUser(parsed.data.email, parsed.data.password);
    if (!result) {
      res.status(401).json({ error: 'invalid_credentials', message: 'E-mail ou senha inválidos' });
      return;
    }

    res.cookie(env.SESSION_COOKIE_NAME, result.opaqueToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.SESSION_COOKIE_SECURE,
      expires: result.expiresAt,
      path: '/',
    });

    res.status(200).json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        roles: result.user.roles,
      },
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractOpaqueToken(req);
    if (token) {
      await revokeSessionByToken(token);
    }
    res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({ status: 'logged_out' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    },
  });
});

authRouter.post(
  '/admin/users',
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
        return;
      }
      const created = await createUser(parsed.data);
      res.status(201).json({ user: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Rota administrativa de classificação de depósito (Seção 6 e 9.1):
 * Operador e aprovador fiscal recebem 403.
 * A mudança e o registro em control_changes ocorrem na mesma transação.
 */
authRouter.put(
  '/admin/controls/warehouses/:warehouseId',
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const warehouseId = req.params.warehouseId;
      if (!warehouseId) {
        res.status(400).json({ error: 'invalid_warehouse_id' });
        return;
      }

      const parsed = updateWarehouseControlSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
        return;
      }

      if (parsed.data.role !== 'seller' && parsed.data.include_in_push) {
        res.status(400).json({
          error: 'invalid_warehouse_rule',
          message: 'Apenas depósitos com role = seller podem ter include_in_push = true',
        });
        return;
      }

      const adminUser = req.user!;

      const updated = await withTransaction(async (client) => {
        const existingRes = await client.query<{
          role: string;
          include_in_push: boolean;
        }>(
          `SELECT role, include_in_push
           FROM stock_warehouses
           WHERE bling_warehouse_id = $1
           FOR UPDATE`,
          [warehouseId]
        );

        const prev = existingRes.rows[0] ?? null;

        await client.query(
          `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (bling_warehouse_id) DO UPDATE
             SET name = EXCLUDED.name,
                 role = EXCLUDED.role,
                 include_in_push = EXCLUDED.include_in_push`,
          [warehouseId, parsed.data.name, parsed.data.role, parsed.data.include_in_push]
        );

        if (!prev || prev.role !== parsed.data.role) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('stock_warehouse', $1, 'role', $2, $3, 'admin', $4)`,
            [warehouseId, prev ? prev.role : null, parsed.data.role, adminUser.id]
          );
        }

        if (!prev || prev.include_in_push !== parsed.data.include_in_push) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('stock_warehouse', $1, 'include_in_push', $2, $3, 'admin', $4)`,
            [
              warehouseId,
              prev ? String(prev.include_in_push) : null,
              String(parsed.data.include_in_push),
              adminUser.id,
            ]
          );
        }

        return {
          bling_warehouse_id: warehouseId,
          name: parsed.data.name,
          role: parsed.data.role,
          include_in_push: parsed.data.include_in_push,
        };
      });

      res.status(200).json({ warehouse: updated });
    } catch (error) {
      next(error);
    }
  }
);

authRouter.put(
  '/admin/controls/sync-owner/:platform',
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const platform = req.params.platform;
      if (platform !== 'mercadolivre' && platform !== 'nuvemshop') {
        res.status(400).json({ error: 'invalid_platform' });
        return;
      }

      const parsed = updateSyncOwnerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
        return;
      }

      const adminUser = req.user!;

      const updated = await withTransaction(async (client) => {
        const existingRes = await client.query<{
          stock_price: string;
          content: string;
        }>(
          `SELECT stock_price, content
           FROM channel_sync_owners
           WHERE platform = $1
           FOR UPDATE`,
          [platform]
        );
        const prev = existingRes.rows[0] ?? null;

        await client.query(
          `INSERT INTO channel_sync_owners (platform, stock_price, content)
           VALUES ($1, $2, $3)
           ON CONFLICT (platform) DO UPDATE
             SET stock_price = EXCLUDED.stock_price,
                 content = EXCLUDED.content`,
          [platform, parsed.data.stock_price, parsed.data.content]
        );

        if (!prev || prev.stock_price !== parsed.data.stock_price) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('channel_sync_owner', $1, 'stock_price', $2, $3, 'admin', $4)`,
            [platform, prev ? prev.stock_price : null, parsed.data.stock_price, adminUser.id]
          );
        }

        if (!prev || prev.content !== parsed.data.content) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('channel_sync_owner', $1, 'content', $2, $3, 'admin', $4)`,
            [platform, prev ? prev.content : null, parsed.data.content, adminUser.id]
          );
        }

        return {
          platform,
          stock_price: parsed.data.stock_price,
          content: parsed.data.content,
        };
      });

      res.status(200).json({ syncOwner: updated });
    } catch (error) {
      next(error);
    }
  }
);

const updateChannelStoreSchema = z.object({
  bling_loja_id: z.string().min(1),
  name: z.string().min(1),
});

authRouter.put(
  '/admin/controls/stores/:platform',
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const platform = req.params.platform;
      if (platform !== 'mercadolivre' && platform !== 'nuvemshop') {
        res.status(400).json({ error: 'invalid_platform' });
        return;
      }

      const parsed = updateChannelStoreSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
        return;
      }

      const adminUser = req.user!;

      const updated = await withTransaction(async (client) => {
        const existingRes = await client.query<{
          bling_loja_id: string;
          name: string;
        }>(
          `SELECT bling_loja_id, name
           FROM channel_stores
           WHERE platform = $1
           FOR UPDATE`,
          [platform]
        );
        const prev = existingRes.rows[0] ?? null;

        await client.query(
          `INSERT INTO channel_stores (platform, bling_loja_id, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (platform) DO UPDATE
             SET bling_loja_id = EXCLUDED.bling_loja_id,
                 name = EXCLUDED.name`,
          [platform, parsed.data.bling_loja_id, parsed.data.name]
        );

        if (!prev || prev.bling_loja_id !== parsed.data.bling_loja_id) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('channel_store', $1, 'bling_loja_id', $2, $3, 'admin', $4)`,
            [platform, prev ? prev.bling_loja_id : null, parsed.data.bling_loja_id, adminUser.id]
          );
        }

        if (!prev || prev.name !== parsed.data.name) {
          await client.query(
            `INSERT INTO control_changes (target, target_key, field, old_value, new_value, origin, changed_by)
             VALUES ('channel_store', $1, 'name', $2, $3, 'admin', $4)`,
            [platform, prev ? prev.name : null, parsed.data.name, adminUser.id]
          );
        }

        return {
          platform,
          bling_loja_id: parsed.data.bling_loja_id,
          name: parsed.data.name,
        };
      });

      res.status(200).json({ store: updated });
    } catch (error) {
      next(error);
    }
  }
);

authRouter.get(
  '/admin/controls/summary',
  requireRole('admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await withTransaction(async (client) => {
        const [warehouses, stores, owners, enrichment, changes] = await Promise.all([
          client.query(`SELECT bling_warehouse_id, name, role, include_in_push FROM stock_warehouses ORDER BY bling_warehouse_id ASC`),
          client.query(`SELECT platform, bling_loja_id, name FROM channel_stores ORDER BY platform ASC`),
          client.query(`SELECT platform, stock_price, content FROM channel_sync_owners ORDER BY platform ASC`),
          client.query(`SELECT platform, mode, kill_switch, max_replaces_per_run FROM enrichment_controls ORDER BY platform ASC`),
          client.query(`SELECT target, target_key, field, old_value, new_value, origin, changed_by, changed_at FROM control_changes ORDER BY changed_at DESC LIMIT 20`),
        ]);
        return {
          warehouses: warehouses.rows,
          stores: stores.rows,
          syncOwners: owners.rows,
          enrichmentControls: enrichment.rows,
          recentControlChanges: changes.rows,
        };
      });
      res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  }
);

authRouter.get(
  '/fiscal/capabilities',
  requireRole('fiscal_approver', 'admin'),
  (req: Request, res: Response) => {
    res.status(200).json({
      allowed: true,
      roleScope: 'fiscal_approver',
      userId: req.user!.id,
      capabilities: ['approve_ean', 'reject_ean', 'first_review_ncm', 'second_review_ncm'],
    });
  }
);

authRouter.get(
  '/operator/capabilities',
  requireRole('operator', 'admin'),
  (req: Request, res: Response) => {
    res.status(200).json({
      allowed: true,
      roleScope: 'operator',
      userId: req.user!.id,
      capabilities: ['matching_resolution', 'content_suggestions', 'image_rights', 'manual_push'],
    });
  }
);
