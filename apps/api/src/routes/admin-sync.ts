import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { getFullSyncStatus } from '../catalog/full-sync.js';
import { enqueueErpSync, readErpSyncStatus } from '../queues/erp-sync-worker.js';

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

adminSyncRouter.get('/api/admin/sync-status', reader, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await readErpSyncStatus();
    res.status(200).json({
      status: status.status,
      total: status.total,
      processed: status.processed,
      page: status.page,
    });
  } catch (error) {
    next(error);
  }
});
