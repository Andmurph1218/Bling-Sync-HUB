import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startErpSyncWorker } from './queues/erp-sync-worker.js';
import { startPublishWorker } from './queues/publish-queue.js';
import { startBatchWorker } from './catalog/batch-jobs.js';
import { startImportWorker } from './catalog/import-jobs.js';
import { startDuplicateDetector } from './services/duplicate-detector.service.js';

const app = createApp();
const host = process.env.HOST ?? '0.0.0.0';
if (process.env.VITEST !== 'true') {
  startPublishWorker();
  startErpSyncWorker();
  startDuplicateDetector();
  startBatchWorker();
  startImportWorker();
}

app.listen(env.PORT, host, () => {
  logger.info('JH Sync Hub API iniciada', {
    port: env.PORT,
    host,
    env: env.NODE_ENV,
  });
});
