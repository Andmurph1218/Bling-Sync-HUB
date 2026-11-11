import { NextFunction, Request, Response, Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { query } from '../db/pool.js';

export const reportsRouter = Router();
const reader = requireRole('admin', 'operator', 'fiscal_approver');

const PERIODS = new Set([7, 30, 90]);

function dayKey(value: Date | string): string {
  const date = new Date(value);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

reportsRouter.get('/api/reports/completeness', reader, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requested = Number(req.query.days ?? 30);
    const days = PERIODS.has(requested) ? requested : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [readiness, quality] = await Promise.all([
      query<{ created_at: Date | string; score_ns: number; score_ml: number }>(
        `SELECT created_at, score_ns, score_ml
         FROM channel_readiness_history
         WHERE created_at >= $1
         ORDER BY created_at ASC
         LIMIT 5000`,
        [since]
      ),
      query<{ created_at: Date | string; source: string }>(
        `SELECT created_at, source
         FROM quality_history
         WHERE created_at >= $1
         ORDER BY created_at ASC
         LIMIT 5000`,
        [since]
      ),
    ]);
    const byDay = new Map<string, { ns: number; ml: number; samples: number }>();
    for (const row of readiness.rows) {
      const key = dayKey(row.created_at);
      const current = byDay.get(key) ?? { ns: 0, ml: 0, samples: 0 };
      current.ns += Number(row.score_ns) || 0;
      current.ml += Number(row.score_ml) || 0;
      current.samples += 1;
      byDay.set(key, current);
    }
    const bySource = new Map<string, number>();
    for (const row of quality.rows) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
    }
    res.status(200).json({
      periodDays: days,
      readiness: {
        source: 'channel_readiness_history',
        points: [...byDay.entries()].map(([day, value]) => ({
          day,
          scoreNs: Math.round(value.ns / value.samples),
          scoreMl: Math.round(value.ml / value.samples),
          samples: value.samples,
        })),
      },
      quality: {
        source: 'quality_history',
        bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
      },
    });
  } catch (error) {
    next(error);
  }
});
