import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { getFullSyncStatus } from '../catalog/full-sync.js';
import { logger } from '../lib/logger.js';
import { enqueueEnrichment } from '../queues/enrichment-worker.js';
import { enqueueErpSync, readErpSyncStatus } from '../queues/erp-sync-worker.js';
import { reconcileAll } from '../services/reconciliation.service.js';

export const adminSyncRouter = Router();
const admin = requireRole('admin');
const reader = requireRole('admin', 'operator');

adminSyncRouter.get('/api/admin/sync-full', admin, (_req: Request, res: Response) => {
  res.status(200).json(getFullSyncStatus());
});

adminSyncRouter.post('/api/admin/sync-full', admin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accepted = await enqueueErpSync();
    res.status(202).json(accepted);
  } catch (error) {
    next(error);
  }
});

adminSyncRouter.post('/api/admin/enrich-catalog', admin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accepted = await enqueueEnrichment();
    res.status(202).json(accepted);
  } catch (error) {
    next(error);
  }
});

let reconciling = false;

adminSyncRouter.post('/api/admin/reconcile-now', admin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (reconciling) {
      res.status(202).json({ accepted: true, status: 'processing' });
      return;
    }
    reconciling = true;
    const run = reconcileAll()
      .catch((error: unknown) => {
        logger.error('Reconciliação manual falhou', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        reconciling = false;
      });
    if (process.env.VITEST === 'true') await run;
    res.status(202).json({ accepted: true, status: 'processing' });
  } catch (error) {
    reconciling = false;
    next(error);
  }
});

adminSyncRouter.get('/api/admin/sync-status', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await readErpSyncStatus();
    res.status(200).json({
      status: status.status,
      total: status.total,
      processed: status.processed,
      page: status.page,
      lastCompletedPage: status.lastCompletedPage,
      errorMessage: status.errorMessage,
    });
  } catch (error) {
    next(error);
  }
});
