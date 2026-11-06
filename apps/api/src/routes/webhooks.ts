import express, { Router, Request, Response, NextFunction } from 'express';
import {
  ingestWebhookController,
  processWebhookEventById,
  WebhookSource,
} from '../engines/wig.js';
import { loadAppCredentials } from '../connectors/app-credentials.js';
import { logger } from '../lib/logger.js';

export const webhooksRouter = Router();

async function getWebhookSecretForSource(source: WebhookSource): Promise<string> {
  const stored = await loadAppCredentials(source).catch(() => null);
  if (stored?.webhookSecret) return stored.webhookSecret;
  if (source === 'bling' && stored?.clientSecret) return stored.clientSecret;
  if (process.env.VITEST) {
    if (source === 'bling') return 'bling_dev_webhook_secret';
    if (source === 'mercadolivre') return 'ml_dev_webhook_secret';
    return 'ns_dev_webhook_secret';
  }
  return '';
}

function extractSignatureHeader(req: Request, source: WebhookSource): string | undefined {
  if (source === 'bling') {
    const h = req.headers['x-bling-signature-256'];
    return Array.isArray(h) ? h[0] : h;
  }
  if (source === 'nuvemshop') {
    const h = req.headers['x-linkedstore-hmac-sha256'];
    return Array.isArray(h) ? h[0] : h;
  }
  const h = req.headers['x-signature'] ?? req.headers['x-ml-signature'];
  return Array.isArray(h) ? h[0] : h;
}

/**
 * Rota de entrada de Webhooks (WIG — Seção 8.9):
 * Usa express.raw({ type: '*\/*' }) para preservar os bytes exatos do corpo antes da validação HMAC.
 */
webhooksRouter.post(
  '/webhooks/:source',
  express.raw({ type: '*/*', limit: '2mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sourceParam = req.params.source;
      if (
        sourceParam !== 'bling' &&
        sourceParam !== 'mercadolivre' &&
        sourceParam !== 'nuvemshop'
      ) {
        res.status(400).json({ error: 'invalid_webhook_source' });
        return;
      }

      const rawBody: Buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
            'utf8'
          );

      const signatureHeader = extractSignatureHeader(req, sourceParam);
      const secret = await getWebhookSecretForSource(sourceParam);

      const outcome = await ingestWebhookController({
        source: sourceParam,
        rawBody,
        signatureHeader,
        secret,
        queueDispatcher: process.env.VITEST ? undefined : {
          enqueue: async (webhookEventId: string) => {
            setImmediate(() => {
              processWebhookEventById(webhookEventId).catch((err) => {
                logger.error('Falha ao processar webhook em background', {
                  webhookEventId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            });
          },
        },
      });

      if (outcome.httpStatus === 401) {
        res.status(401).json({ error: 'invalid_hmac_signature' });
        return;
      }

      res.status(200).json({
        status: outcome.duplicate ? 'duplicate_ignored' : 'accepted',
        webhookEventId: outcome.webhookEventId,
        idempotencyKey: outcome.idempotencyKey,
      });
    } catch (error) {
      next(error);
    }
  }
);
