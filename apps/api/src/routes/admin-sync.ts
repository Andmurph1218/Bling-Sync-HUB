import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { getFullSyncStatus, startFullCatalogSync } from '../catalog/full-sync.js';
import { createErpConnector } from '../connectors/strategy/factory.js';

export const adminSyncRouter = Router();
const admin = requireRole('admin');

adminSyncRouter.get('/api/admin/sync-full', admin, (_req: Request, res: Response) => {
  res.status(200).json(getFullSyncStatus());
});

adminSyncRouter.post('/api/admin/sync-full', admin, (_req: Request, res: Response, next: NextFunction) => {
  try {
    const erp = createErpConnector('bling');
    const started = startFullCatalogSync(erp);
    res.status(started.started ? 202 : 409).json(started.report);
  } catch (error) {
    next(error);
  }
});
