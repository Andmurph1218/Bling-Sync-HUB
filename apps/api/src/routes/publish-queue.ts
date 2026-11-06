import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { createPublishJobs, isLivePublishingEnabled } from '../queues/publish-queue.js';
import { query } from '../db/pool.js';

export const publishQueueRouter = Router();
const admin = requireRole('admin');

const bodySchema = z.object({
  jobs: z
    .array(
      z.object({
        productId: z.string().uuid(),
        channel: z.enum(['mercadolivre', 'nuvemshop', 'shopee', 'amazon', 'tiktok']),
        payload: z.object({
          sku: z.string().min(1),
          price: z.number(),
          stock: z.number().int(),
          attributes: z.array(z.object({ id: z.string(), value_name: z.string() })).default([]),
        }),
      })
    )
    .min(1)
    .max(20),
});

publishQueueRouter.post('/api/admin/publish-queue', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', message: 'Informe de 1 a 20 jobs com produto, canal e payload.' });
      return;
    }
    const ids = await createPublishJobs(parsed.data.jobs);
    const rows = [];
    for (const id of ids) {
      const one = await query<{ id: string; status: string; error_message: string | null; channel: string }>(
        `SELECT id, status, error_message, channel FROM publish_queue WHERE id = $1`,
        [id]
      );
      if (one.rows[0]) rows.push(one.rows[0]);
    }
    res.status(202).json({
      livePublishing: isLivePublishingEnabled(),
      jobs: rows,
    });
  } catch (error) {
    next(error);
  }
});
