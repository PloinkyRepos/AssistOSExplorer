import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  createRoom,
  deleteRoomIfPresent,
  joinRoom,
  openWebMeet,
  sendWebMeetChat,
} from '../lib/webmeet.mjs';

test.describe('WebMeet @ tags', () => {
  test('provider-looking @ tags stay ordinary meeting chat', async ({ page }) => {
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
      await page.waitForTimeout(1_000);
      await expect(page.locator('.webmeet-chat-suggest-group', { hasText: 'Agents' })).toHaveCount(0);
      await expect(page.locator('.webmeet-chat-suggest-item', { hasText: '@open-interpreter' })).toHaveCount(0);
      await expect(page.locator('#webmeetChatInput')).toHaveValue('@op');

      const message = `@open-interpreter ordinary-chat-${smokeConfig.runId}`;
      await sendWebMeetChat(page, message);
      await expect(page.locator('#webmeetChatList', { hasText: message })).toBeVisible();
      await expect(page.locator('#webmeetChatList .webmeet-chat-mention', { hasText: '@open-interpreter' })).toHaveCount(0);
    } finally {
      await deleteRoomIfPresent(page, roomTitle).catch(() => null);
    }
  });
});
