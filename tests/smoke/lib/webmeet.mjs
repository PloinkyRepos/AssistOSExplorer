import { expect } from './fixtures.mjs';
import { openExplorer } from './explorer.mjs';
import { smokeConfig } from './config.mjs';

export async function openWebMeet(page, account = smokeConfig.primaryUser) {
  await openExplorer(page, { account });
  const toolButton = page.locator('#webmeetToolButton');
  if (await toolButton.isVisible({ timeout: 12_000 }).catch(() => false)) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      toolButton.click(),
    ]);
  } else {
    await page.goto('/explorer/index.html#webmeet-dashboard-page', { waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('.webmeet-dashboard-modal')).toBeVisible({ timeout: smokeConfig.timeouts.navigation });
  await expect(page.locator('#webmeetCreateRoomButton')).toBeVisible();
}

export async function createRoom(page, title) {
  await page.locator('#webmeetCreateRoomButton').click();
  await expect(page.locator('[data-id="roomTitleInput"]')).toBeVisible();
  await page.locator('[data-id="roomTitleInput"]').fill(title);
  await page.locator('[data-local-action="confirmCreate"]').click();
  await expect(page.locator('#webmeetMeetingList .webmeet-list-item', { hasText: title }).first()).toBeVisible();
}

export async function joinRoom(page, title) {
  await page.locator('#webmeetMeetingList .webmeet-list-item', { hasText: title }).first().locator('.webmeet-meeting-row').click();
/*  await expect(page.locator('#webmeetActiveRoomTitle')).toContainText(title);*/
  await expect(page.locator('#webmeetChatInput')).toBeVisible();
}

export async function sendWebMeetChat(page, message) {
  await page.locator('#webmeetChatInput').fill(message);
  await page.locator('.webmeet-compose [data-local-action="sendChat"]').click();
  await expect(page.locator('#webmeetChatList', { hasText: message })).toBeVisible();
}

export async function expectWebMeetSuggestion(page, { group, text }) {
  await expect(page.locator('.webmeet-chat-suggest-menu')).toBeVisible();
  if (group) {
    await expect(page.locator('.webmeet-chat-suggest-group', { hasText: group })).toBeVisible();
  }
  await expect(page.locator('.webmeet-chat-suggest-item', { hasText: text }).first()).toBeVisible();
}

export async function selectActiveWebMeetSuggestion(page) {
  await page.keyboard.press('Enter');
}

export async function deleteRoomIfPresent(page, title) {
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  const item = page.locator('#webmeetMeetingList .webmeet-list-item', { hasText: title }).first();
  if (!await item.isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await item.locator('[data-local-action="deleteMeeting"]').click();
  await expect(page.locator('#webmeetMeetingList .webmeet-list-item', { hasText: title })).toHaveCount(0);
}

export async function enableMedia(page) {
  await page.locator('#webmeetMicButton').click();
  await page.locator('#webmeetCameraButton').click();
  await expect(page.locator('#webmeetVideoGrid video').first()).toBeVisible({ timeout: smokeConfig.timeouts.media });
}

export async function expectIncreasingRtpStats(page) {
  const first = await page.evaluate(async () => {
    const pcs = window.__e2ePeerConnections || [];
    const rows = [];
    for (const pc of pcs) {
      const stats = await pc.getStats();
      stats.forEach((entry) => {
        if (entry.type === 'outbound-rtp' || entry.type === 'inbound-rtp') {
          rows.push({
            type: entry.type,
            kind: entry.kind || entry.mediaType || '',
            packets: entry.packetsSent || entry.packetsReceived || 0,
            frames: entry.framesEncoded || entry.framesDecoded || 0,
          });
        }
      });
    }
    return rows;
  });
  await page.waitForTimeout(2_500);
  const second = await page.evaluate(async () => {
    const pcs = window.__e2ePeerConnections || [];
    const rows = [];
    for (const pc of pcs) {
      const stats = await pc.getStats();
      stats.forEach((entry) => {
        if (entry.type === 'outbound-rtp' || entry.type === 'inbound-rtp') {
          rows.push({
            type: entry.type,
            kind: entry.kind || entry.mediaType || '',
            packets: entry.packetsSent || entry.packetsReceived || 0,
            frames: entry.framesEncoded || entry.framesDecoded || 0,
          });
        }
      });
    }
    return rows;
  });
  const before = first.reduce((sum, row) => sum + row.packets + row.frames, 0);
  const after = second.reduce((sum, row) => sum + row.packets + row.frames, 0);
  expect(after).toBeGreaterThan(before);
}
