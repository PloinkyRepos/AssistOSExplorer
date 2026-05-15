import { test, expect } from '../lib/fixtures.mjs';
import { assertExplorerHealthy, openDashboard, openExplorer } from '../lib/explorer.mjs';
import { openTaggedWebchat } from '../lib/webchat.mjs';

test.describe('router, auth, and primary surfaces', () => {
  test('dashboard and Explorer shell load through the router', async ({ page }) => {
    await openDashboard(page);
    await openExplorer(page);
    await assertExplorerHealthy(page);
    await expect(page.locator('body')).not.toContainText(/API Route not found|Unexpected token/i);
  });

  test('routed WebChat shell loads for the configured smoke agent', async ({ page }) => {
    await openTaggedWebchat(page);
    await expect(page.locator('#cmd')).toBeEditable();
    await expect(page.locator('#chatList')).toBeVisible();
  });
});
