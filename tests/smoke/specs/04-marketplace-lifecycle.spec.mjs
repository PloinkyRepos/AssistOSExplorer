import { test, expect } from '../lib/fixtures.mjs';
import { openExplorer } from '../lib/explorer.mjs';
import { smokeConfig } from '../lib/config.mjs';

test.describe('Marketplace lifecycle controls', () => {
  test('Configure stays gated while a no-wait agent starts and unlocks after refresh', async ({ page }) => {
    let marketplaceReads = 0;
    await page.route('**/api/marketplace', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const payload = await response.json();
      const agents = payload?.marketplace?.agents;
      const searchAgent = Array.isArray(agents)
        ? agents.find((agent) => agent?.ref === 'proxies/searchAgent')
        : null;
      if (!searchAgent) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'search_agent_fixture_missing' }),
        });
        return;
      }

      marketplaceReads += 1;
      Object.assign(searchAgent, marketplaceReads === 1
        ? {
            active: true,
            status: 'starting',
            statusDetail: 'Background startup is in progress.',
            running: false,
          }
        : {
            active: true,
            status: 'running',
            running: true,
          });
      delete searchAgent.statusDetail;
      if (marketplaceReads === 1) {
        searchAgent.statusDetail = 'Background startup is in progress.';
      }

      await route.fulfill({ response, json: payload });
    });

    await openExplorer(page, { hash: 'marketplace-modal' });
    const marketplace = page.locator('marketplace-modal');
    await expect(marketplace).toBeVisible({ timeout: smokeConfig.timeouts.navigation });

    const proxiesToggle = marketplace.locator('[data-repo-tree-toggle][data-repo-name="proxies"]');
    await expect(proxiesToggle).toBeVisible();
    if (await proxiesToggle.getAttribute('aria-expanded') !== 'true') await proxiesToggle.click();

    const row = marketplace.locator('.marketplace-agent-row').filter({
      has: marketplace.getByText('searchAgent', { exact: true }),
    });
    const status = row.locator('.marketplace-agent-status');
    const configure = row.getByRole('button', { name: 'Configure' });
    const mode = row.locator('[data-enable-mode-for="proxies/searchAgent"]');

    await expect(status).toHaveText('Starting up');
    await expect(status).toHaveAttribute('title', 'Background startup is in progress.');
    await expect(configure).toBeDisabled();
    await expect(configure).toHaveAttribute('aria-disabled', 'true');
    await expect(mode).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Disable' })).toBeEnabled();

    await expect(status).toHaveText('Running', { timeout: 2 * smokeConfig.timeouts.expect });
    await expect(configure).toBeEnabled();
    await expect(configure).toHaveAttribute('aria-disabled', 'false');
    expect(marketplaceReads).toBeGreaterThanOrEqual(2);
  });
});
