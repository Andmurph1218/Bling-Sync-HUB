import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { createMarketplaceConnector } from '../connectors/strategy/factory.js';
import { ConnectorNotInstalledError } from '../connectors/strategy/types.js';

export const marketplaceAttributesRouter = Router();

const reader = requireRole('admin', 'operator');

marketplaceAttributesRouter.get(
  '/api/marketplace/:id/category-attributes',
  reader,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId.trim() : '';
      if (!categoryId) {
        res.status(400).json({ error: 'category_required', message: 'Informe a categoria do canal.' });
        return;
      }
      let connector;
      try {
        connector = createMarketplaceConnector(req.params.id);
      } catch {
        res.status(404).json({ error: 'marketplace_not_registered', message: 'Canal não registrado.' });
        return;
      }
      const attributes = await connector.getCategoryAttributes(categoryId);
      res.json({ id: connector.id, categoryId, attributes });
    } catch (error) {
      if (error instanceof ConnectorNotInstalledError) {
        res.status(409).json({ error: 'connector_not_installed', message: 'Este canal ainda não tem credencial.' });
        return;
      }
      next(error);
    }
  }
);
