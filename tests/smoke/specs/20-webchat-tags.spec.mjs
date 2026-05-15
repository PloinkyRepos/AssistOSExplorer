import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  expectWebchatSuggestion,
  openTaggedWebchat,
  selectActiveWebchatSuggestion,
  setComposer,
} from '../lib/webchat.mjs';

test.describe('WebChat @ tags', () => {
  test('Open Interpreter tag can be suggested, selected, highlighted, and optionally dispatched @external', async ({ page }) => {
    test.setTimeout(smokeConfig.flags.openInterpreter ? smokeConfig.timeouts.relay + 60_000 : smokeConfig.timeouts.test);

    await openTaggedWebchat(page);
    await setComposer(page, '@op');
    await expectWebchatSuggestion(page, {
      group: 'Agents',
      text: '@open-interpreter',
    });
    await selectActiveWebchatSuggestion(page);
    await expect(page.locator('#cmd')).toHaveValue('@open-interpreter ');
    await expect(page.locator('.wa-composer-mention', { hasText: '@open-interpreter' })).toBeVisible();

    if (!smokeConfig.flags.openInterpreter) {
      test.info().annotations.push({
        type: 'skip-external-dispatch',
        description: 'Set SMOKE_OPEN_INTERPRETER=1 to run the long relay response check.',
      });
      return;
    }

    await setComposer(page, '@open-interpreter Reply with exactly WEBCHAT_E2E_OK and no other words.');
    await page.locator('#send').click();
    await expect(page.locator('#chatList', { hasText: 'WEBCHAT_E2E_OK' })).toBeVisible({
      timeout: smokeConfig.timeouts.relay,
    });
  });
});
