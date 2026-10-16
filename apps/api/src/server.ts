import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info('Bling Sync HUB API iniciada', {
    port: env.PORT,
    env: env.NODE_ENV,
  });
});
