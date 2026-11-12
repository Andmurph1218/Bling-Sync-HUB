import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { listWarehouseSummaries } from '../catalog/warehouse-stock.js';
import { logger } from '../lib/logger.js';
import { discoverBlingWarehousesAndStores } from './oauth.js';

export const warehousesRouter = Router();

warehousesRouter.get(
  '/api/warehouses',
  requireRole('admin', 'operator'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ warehouses: await listWarehouseSummaries() });
    } catch (error) {
      next(error);
    }
  }
);

/** Lê GET /depositos no Bling e cadastra os novos como não classificados. Não escreve no ERP. */
warehousesRouter.post(
  '/api/admin/warehouses/discover',
  requireRole('admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      try {
        await discoverBlingWarehousesAndStores();
      } catch (error) {
        logger.error('Leitura dos depósitos no Bling falhou', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({
          error: 'bling_unavailable',
          message: 'Não foi possível ler os depósitos no Bling. Verifique a conexão do ERP.',
        });
        return;
      }
      res.status(200).json({ warehouses: await listWarehouseSummaries() });
    } catch (error) {
      next(error);
    }
  }
);
