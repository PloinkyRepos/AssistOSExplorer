import { test, expect } from '../lib/fixtures.mjs';
import {
  openTaggedWebchat,
  setComposer,
} from '../lib/webchat.mjs';

test.describe('WebChat @ tags', () => {
  test('provider-looking @ tags are not offered as dispatch suggestions', async ({ page }) => {
    await openTaggedWebchat(page);
    await setComposer(page, '@op');
    await page.waitForTimeout(1_000);
    await expect(page.locator('.wa-slash-menu-group', { hasText: 'Agents' })).toHaveCount(0);
    await expect(page.locator('.wa-slash-menu-item', { hasText: '@open-interpreter' })).toHaveCount(0);
    await expect(page.locator('#cmd')).toHaveValue('@op');
  });
});
