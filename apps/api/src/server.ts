import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startEnrichmentWorker } from './queues/enrichment-worker.js';
import { startErpSyncWorker } from './queues/erp-sync-worker.js';
import { startImageWorker } from './queues/image-worker.js';
import { startPublishWorker } from './queues/publish-queue.js';
import { startBatchWorker } from './catalog/batch-jobs.js';
import { startImportWorker } from './catalog/import-jobs.js';
import { startStuckPublishDetector } from './queues/stuck-publish.js';
import { startDuplicateDetector } from './services/duplicate-detector.service.js';

const app = createApp();
const host = process.env.HOST ?? '0.0.0.0';
if (process.env.VITEST !== 'true') {
  startPublishWorker();
  startErpSyncWorker();
  startEnrichmentWorker();
  startImageWorker();
  startDuplicateDetector();
  startStuckPublishDetector();
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
