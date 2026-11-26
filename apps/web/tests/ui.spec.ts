import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import AxeBuilder from '@axe-core/playwright';

const base = 'http://localhost:3100';
const sessionUser = { id: 'ui-test', name: 'Operador de teste', email: 'ui@example.test', roles: ['admin'], permissions: [] };
const api = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.statusCode = request.url === '/auth/me' ? 200 : 503;
  response.end(JSON.stringify(request.url === '/auth/me' ? { user: sessionUser } : { message: 'Test fixture only' }));
});
test.beforeAll(async () => { await new Promise<void>((resolve, reject) => { api.once('error', reject); api.listen(3101, '127.0.0.1', resolve); }); });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve())); });
const operational = {
  kpis: {
    monitoredProducts: { value: 32853, variantsCount: 40000 },
    readyToPublish: { value: 120, totalEvaluated: 32853 },
    actionPendings: { value: 500, breakdown: { ncmPendingFirst: 300 } },
    syncFailures: { value: 0 },
  },
  channels: { oauth: [], syncOwners: [], enrichmentControls: [], warehouses: [] },
  recentWebhooks: [], catalogProducts: [], emptySkuCount: 10, contentIncompleteCount: 500,
};
const home = {
  cards: {
    products: { value: 32853 }, ready: { value: 120 }, incomplete: { value: 500 },
    publicationsToday: { value: 0, failed: 0, sent: 0, queued: 0 },
  },
  totalVariants: 40000, completenessPct: 68,
  gaps: { missingSku: 10, missingCover: 3000, missingNcm: 300, missingCategory: 32000 },
  readiness: { averageScore: 68, readyToPublish: 120 },
  activeChannels: [{ id: 'nuvemshop', name: 'Nuvemshop', connected: true, enabled: true, statusLabel: 'Conectado', linkedCount: 80 }],
  linkedNuvemshop: 80, channels: [], livePublishing: false,
};

async function fixtures(page: Page, theme: 'light' | 'dark') {
  await page.context().addCookies([{ name: 'bling_hub_sid', value: 'ui-test-only', url: base }]);
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/auth/me') data = { user: { id: 'ui-test', name: 'Operador de teste', email: 'ui@example.test', roles: ['admin'], permissions: [] } };
    else if (path === '/api/dashboard/operational-state') data = operational;
    else if (path === '/api/catalog/home') data = home;
    else if (path === '/api/admin/sync-status') data = { status: 'idle', total: 0, processed: 0 };
    else if (path === '/api/duplicates') data = { total: 0, items: [] };
    else if (path === '/api/integrations/channels') data = { catalogMode: { badge: 'Shadow' }, channels: [], warehouses: [] };
    else if (path === '/api/admin/enrich-catalog') data = { started: true };
    else if (path.startsWith('/api/') || path.startsWith('/auth/')) return route.fulfill({ status: 503, json: { message: 'Indisponível no teste' } });
    else return route.continue();
    return route.fulfill({ json: data });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`dashboard ${theme} ${width}px: dados, links e geometria`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await fixtures(page, theme);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible();
      await expect(page.locator('article').filter({ hasText: 'Total no catálogo' })).toContainText('32.853');
      await expect(page.getByRole('link', { name: /Sem SKU/ }).first()).toHaveAttribute('href', '/catalogo?pendencia=sku');
      await expect(page.getByText('Maior gargalo')).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('article').filter({ hasText: 'Total no catálogo' }).locator('span[aria-hidden="true"]').last()).toHaveText('32.853');
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(accessibility.violations.map((issue) => ({ id: issue.id, nodes: issue.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
      await page.screenshot({ path: `test-results/dashboard-${theme}-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }

  test(`modal ${theme}: foco, Escape, saída e restauração`, async ({ page }) => {
    await fixtures(page, theme);
    await page.goto(`${base}/canais`);
    const trigger = page.getByRole('button', { name: 'Adicionar canal', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Catálogo de integrações' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const count = await dialog.getByRole('button').count();
    for (let i = 0; i < count + 2; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

test('movimento reduzido: barras instantâneas e toast responsivo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page, 'light');
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible();
  expect(await page.locator('.ui-progress').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.getByRole('button', { name: 'Enriquecer Catálogo', exact: true }).click();
  const notification = page.locator('[data-sonner-toast]').filter({ hasText: 'Enriquecimento iniciado' });
  await expect(notification).toBeVisible();
  const box = await notification.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/toast-mobile.png', fullPage: true });
});
