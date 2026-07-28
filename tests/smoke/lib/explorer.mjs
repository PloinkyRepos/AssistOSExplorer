import { expect } from './fixtures.mjs';
import { signIn } from './auth.mjs';
import { smokeConfig } from './config.mjs';

export async function openDashboard(page, account = smokeConfig.primaryUser) {
  await signIn(page, account, '/dashboard');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/API Route not found|Unexpected token/i);
}

export async function openExplorer(page, options = {}) {
  const {
    account = smokeConfig.primaryUser,
    hash = '',
  } = options;
  const suffix = hash ? `#${String(hash).replace(/^#/, '')}` : '';
  await signIn(page, account, `/explorer/index.html${suffix}`);
  await expect(page.locator('#page_content')).toBeVisible();
  await page.waitForFunction(() => {
    return Boolean(window.webSkel && document.querySelector('#page_content')?.children.length);
  }, null, { timeout: smokeConfig.timeouts.navigation });
  await expect(page.locator('#before_webskel_loader')).toHaveCount(0);
}

export async function assertExplorerHealthy(page) {
  await expect(page.locator('#page_content')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Explorer failed to load|API Route not found/i);
}
