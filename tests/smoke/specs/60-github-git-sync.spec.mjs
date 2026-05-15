import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { openExplorer } from '../lib/explorer.mjs';

test.describe('GitHub Git plugin @external', () => {
  test.skip(!smokeConfig.flags.github, 'Set SMOKE_GITHUB=1 to run GitHub smoke checks.');

  test('Git modal exposes GitHub authentication controls without leaking tokens', async ({ page }) => {
    await openExplorer(page);
    const gitButton = page.locator('#gitButton');
    await expect(gitButton).toBeVisible();
    await gitButton.click();
    await expect(page.locator('#gitSettingsButton')).toBeVisible();
    await page.locator('#gitSettingsButton').click();
    await expect(page.locator('#gitCredentials')).toBeVisible();
    await expect(page.locator('#gitCredentialsAuthMethodGithub')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/ghp_|github_pat_|x-access-token/i);
  });
});
