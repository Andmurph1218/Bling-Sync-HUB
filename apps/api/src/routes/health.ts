import { Router, Request, Response } from 'express';
import { checkDbHealth } from '../db/pool.js';
import { checkRedisHealth } from '../lib/redis.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const [postgres, redis] = await Promise.all([checkDbHealth(), checkRedisHealth()]);
  const healthy = postgres.ok && redis.ok;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: '@bling-sync/api',
    phase: 0,
    timestamp: new Date().toISOString(),
    dependencies: {
      postgres,
      redis,
    },
  });
});
