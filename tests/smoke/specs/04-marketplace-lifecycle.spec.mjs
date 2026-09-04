import { test, expect } from '../lib/fixtures.mjs';
import { openExplorer } from '../lib/explorer.mjs';
import { smokeConfig } from '../lib/config.mjs';

test.describe('Marketplace lifecycle controls', () => {
  test('Configure stays gated while a no-wait agent starts and unlocks after refresh', async ({ page }) => {
    let marketplaceReads = 0;
    let streamReads = 0;
    let lifecycle = {active: true, status: 'starting', running: false};
    const startingDetail = 'Background startup is in progress.';
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
      Object.assign(searchAgent, lifecycle);
      delete searchAgent.statusDetail;
      if (lifecycle.status === 'starting') searchAgent.statusDetail = startingDetail;

      await route.fulfill({ response, json: payload });
    });
    // Snapshot polling and the NDJSON stream must describe the same controlled
    // runtime. Real inactive evidence must not race the synthetic startup state.
    await page.route('**/status/data?follow=1', async (route) => {
      const snapshotUrl = new URL(route.request().url());
      snapshotUrl.search = '';
      const response = await route.fetch({url: snapshotUrl.toString()});
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      expect(Array.isArray(payload.runtimes)).toBe(true);
      const runtimes = payload.runtimes.filter((runtime) => (
        runtime.repoName !== 'proxies' || runtime.agentName !== 'searchAgent'
      ));
      runtimes.push({
        repoName: 'proxies',
        agentName: 'searchAgent',
        enabled: lifecycle.active,
        state: {status: lifecycle.status, running: lifecycle.running},
      });
      streamReads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: `${JSON.stringify({...payload, runtimes})}\n`,
      });
    });

    await openExplorer(page, { hash: 'marketplace-modal' });
    const marketplace = page.locator('marketplace-modal');
    await expect(marketplace).toBeVisible({ timeout: smokeConfig.timeouts.navigation });

    const proxiesToggle = marketplace.locator('[data-repo-tree-toggle][data-repo-name="proxies"]');
    await expect(proxiesToggle).toBeVisible();
    if (await proxiesToggle.getAttribute('aria-expanded') !== 'true') await proxiesToggle.click();

    const row = marketplace.locator('[data-marketplace-agent-ref="proxies/searchAgent"]');
    const status = row.locator('.marketplace-agent-status');
    const configure = row.getByRole('button', { name: 'Configure' });
    const mode = row.locator('[data-enable-mode-for="proxies/searchAgent"]');

    await expect(status).toHaveText('Starting up');
    await expect(status).toHaveAttribute('title', 'Background startup is in progress.');
    await expect(configure).toBeDisabled();
    await expect(configure).toHaveAttribute('aria-disabled', 'true');
    await expect(mode).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Disable' })).toBeEnabled();
    await expect.poll(() => marketplaceReads).toBeGreaterThanOrEqual(2);
    await expect.poll(() => streamReads).toBeGreaterThanOrEqual(1);
    await expect(status).toHaveText('Starting up');
    await expect(configure).toBeDisabled();

    lifecycle = {active: true, status: 'running', running: true};
    await expect(status).toHaveText('Running', { timeout: 2 * smokeConfig.timeouts.expect });
    await expect(status).toHaveAttribute('aria-label', 'searchAgent status: Running');
    await expect(status).not.toHaveAttribute('title');
    await expect(configure).toBeEnabled();
    await expect(configure).toHaveAttribute('aria-disabled', 'false');
    await expect(configure).not.toHaveAttribute('title');

    // Running cancels snapshot polling; subsequent transitions must be applied
    // by the real incremental stream consumer, without rebuilding this row.
    await row.evaluate((element) => { element.dataset.lifecycleFixtureRow = 'retained'; });
    const runningReads = streamReads;
    lifecycle = {active: true, status: 'stopped', running: false};
    await expect.poll(() => streamReads).toBeGreaterThan(runningReads);
    await expect(status).toHaveText('Stopped');
    await expect(configure).toBeDisabled();
    await expect(configure).toHaveAttribute('aria-disabled', 'true');
    await expect(mode).toBeDisabled();
    lifecycle = {active: false, status: 'inactive', running: false};
    await expect(status).toHaveText('Disabled');
    await expect(status).toHaveAttribute('aria-label', 'searchAgent status: Disabled');
    await expect(configure).toBeDisabled();
    await expect(mode).toBeEnabled();
    await expect(row.getByRole('button', {name: 'Enable', exact: true})).toBeEnabled();
    await expect(row).toHaveAttribute('data-lifecycle-fixture-row', 'retained');
  });
});
