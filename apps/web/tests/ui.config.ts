import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: __dirname,
  testMatch: 'ui.spec.ts',
  outputDir: '../test-results',
  workers: 1,
  timeout: 45_000,
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../../node_modules/next/dist/bin/next dev -p 3100',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://localhost:3100/login',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { API_INTERNAL_URL: 'http://127.0.0.1:3101' },
  },
});
