import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { readPublicAppCredentials, saveAppCredentials } from '../connectors/app-credentials.js';

export const appCredentialsRouter = Router();
const admin = requireRole('admin');

const providerSchema = z.string().regex(/^[a-z0-9_-]{2,40}$/);
const bodySchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  redirectUri: z.string().optional(),
  webhookSecret: z.string().optional(),
  isActive: z.boolean().optional(),
});

appCredentialsRouter.get(
  '/api/admin/integrations/:provider/credentials',
  admin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = providerSchema.parse(req.params.provider);
      res.status(200).json(await readPublicAppCredentials(provider));
    } catch (error) {
      next(error);
    }
  }
);

appCredentialsRouter.post(
  '/api/admin/integrations/:provider/credentials',
  admin,
  async (req: Request, res: Response, next: NextFunction) => {
    await writeCredentials(req, res, next);
  }
);

appCredentialsRouter.put(
  '/api/admin/integrations/:provider/credentials',
  admin,
  async (req: Request, res: Response, next: NextFunction) => {
    await writeCredentials(req, res, next);
  }
);

async function writeCredentials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', message: 'Informe o Client ID.' });
      return;
    }
    const saved = await saveAppCredentials({ provider, ...parsed.data });
    res.status(200).json(saved);
  } catch (error) {
    if (error instanceof Error && error.message === 'client_secret_required') {
      res.status(400).json({ error: 'client_secret_required', message: 'Informe o Client Secret na primeira gravação.' });
      return;
    }
    next(error);
  }
}
