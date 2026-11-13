import { DelayedError } from 'bullmq';
import { ErpDailyQuotaPausedError, quotaPauseDelayMs } from '../connectors/rate-limit-port.js';
import { logger } from '../lib/logger.js';

interface DelayableJob {
  id?: string;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
}

/** Devolve o job para daqui a 15 min, ou até o dia virar, sem contar como falha. */
export async function holdQueueForBlingQuota(job: DelayableJob, token: string | undefined, error: unknown): Promise<never> {
  if (!(error instanceof ErpDailyQuotaPausedError)) throw error;
  logger.warn(error.message, { jobId: job.id, used: error.used, state: error.state });
  await job.moveToDelayed(Date.now() + quotaPauseDelayMs(error.state), token);
  throw new DelayedError();
}
