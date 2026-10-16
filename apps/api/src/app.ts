import express, { Express, NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { webhooksRouter } from './routes/webhooks.js';
import { dashboardRouter } from './routes/dashboard.js';
import { logger } from './lib/logger.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(cookieParser());

  // Rota de webhooks registrada antes do express.json() para ler o raw body intacto na validação HMAC
  app.use(webhooksRouter);

  app.use(express.json({ limit: '2mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(dashboardRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Erro interno do servidor';
    logger.error('Erro não tratado na requisição HTTP', { error: message });
    res.status(500).json({
      error: 'internal_server_error',
      message,
    });
  });

  return app;
}
