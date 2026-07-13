import { test, expect, attachPageDiagnostics, installRtcProbe } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { trySignIn } from '../lib/auth.mjs';
import {
  createRoom,
  deleteRoomIfPresent,
  enableMedia,
  expectIncreasingRtpStats,
  expectRelayIceSelected,
  joinRoom,
  openWebMeet,
  sendWebMeetChat,
} from '../lib/webmeet.mjs';

test.describe('WebMeet rooms', () => {
  test('two Explorer accounts can join one room and exchange chat', async ({ page, browser }, testInfo) => {
    const roomTitle = `e2e-room-${smokeConfig.runId}`;
    const ownerMessage = `chat-from-owner-${smokeConfig.runId}`;
    const memberMessage = `chat-from-member-${smokeConfig.runId}`;
    let memberContext = null;
    let memberPage = null;
    let memberDiagnostics = null;

    try {
      await openWebMeet(page);
      await createRoom(page, roomTitle);
      await joinRoom(page, roomTitle);

      memberContext = await browser.newContext({
        baseURL: smokeConfig.baseURL,
        ignoreHTTPSErrors: true,
        permissions: ['camera', 'microphone'],
      });
      await installRtcProbe(memberContext);
      memberPage = await memberContext.newPage();
      memberDiagnostics = attachPageDiagnostics(memberPage, testInfo, 'webmeet-secondary');

      const secondaryLoginOk = await trySignIn(memberPage, smokeConfig.secondaryUser, '/dashboard');
      test.skip(!secondaryLoginOk, `Secondary smoke account ${smokeConfig.secondaryUser.username} cannot log in.`);

      await openWebMeet(memberPage, smokeConfig.secondaryUser, { expectCreateRoom: false });
      await joinRoom(memberPage, roomTitle);

      await sendWebMeetChat(page, ownerMessage);
      await expect(memberPage.locator('#webmeetChatList', { hasText: ownerMessage })).toBeVisible();

      await sendWebMeetChat(memberPage, memberMessage);
      await expect(page.locator('#webmeetChatList', { hasText: memberMessage })).toBeVisible();

      if (smokeConfig.flags.webmeetMedia) {
        await enableMedia(page);
        await enableMedia(memberPage);
        await expectIncreasingRtpStats(page);
        await expectIncreasingRtpStats(memberPage);
        if (smokeConfig.flags.webmeetRequireRelay) {
          await expectRelayIceSelected(page);
          await expectRelayIceSelected(memberPage);
        }
      }
    } finally {
      if (memberDiagnostics) {
        await memberDiagnostics.flush();
      }
      if (memberContext) {
        await memberContext.close();
      }
      await deleteRoomIfPresent(page, roomTitle).catch(() => null);
    }
  });
});
