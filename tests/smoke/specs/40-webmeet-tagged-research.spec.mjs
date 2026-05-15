import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  createRoom,
  deleteRoomIfPresent,
  expectWebMeetSuggestion,
  joinRoom,
  openWebMeet,
  selectActiveWebMeetSuggestion,
  sendWebMeetChat,
} from '../lib/webmeet.mjs';

test.describe('WebMeet @ tags', () => {
  test('Open Interpreter tag can be suggested, selected, highlighted, and optionally dispatched @external', async ({ page }) => {
    test.setTimeout(smokeConfig.flags.openInterpreter ? smokeConfig.timeouts.relay + 60_000 : smokeConfig.timeouts.test);

    const roomTitle = `e2e-tags-${smokeConfig.runId}`;
    try {
      await openWebMeet(page);
      await createRoom(page, roomTitle);
      await joinRoom(page, roomTitle);

      await page.locator('#webmeetChatInput').fill('@op');
      await page.locator('#webmeetChatInput').evaluate((input) => {
        input.selectionStart = input.value.length;
        input.selectionEnd = input.value.length;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expectWebMeetSuggestion(page, {
        group: 'Agents',
        text: '@open-interpreter',
      });
      await selectActiveWebMeetSuggestion(page);
      await expect(page.locator('#webmeetChatInput')).toHaveValue('@open-interpreter ');
      await expect(page.locator('.webmeet-chat-mention', { hasText: '@open-interpreter' })).toBeVisible();

      if (!smokeConfig.flags.openInterpreter) {
        test.info().annotations.push({
          type: 'skip-external-dispatch',
          description: 'Set SMOKE_OPEN_INTERPRETER=1 to run the long relay response check.',
        });
        return;
      }

      await sendWebMeetChat(page, '@open-interpreter Reply with exactly WEBMEET_E2E_OK and no other words.');
      await expect(page.locator('#webmeetChatList', { hasText: 'WEBMEET_E2E_OK' })).toBeVisible({
        timeout: smokeConfig.timeouts.relay,
      });
    } finally {
      await deleteRoomIfPresent(page, roomTitle).catch(() => null);
    }
  });
});
