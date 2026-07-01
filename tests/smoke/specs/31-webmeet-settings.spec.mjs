import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  createRoom,
  deleteRoomIfPresent,
  joinRoom,
  openWebMeet,
} from '../lib/webmeet.mjs';

test.describe('WebMeet settings', () => {
  test('dashboard header exposes audio/video and privacy settings', async ({ page }) => {
    const roomTitle = `e2e-settings-panel-${smokeConfig.runId}`;
    try {
      await openWebMeet(page);
      await createRoom(page, roomTitle);
      await joinRoom(page, roomTitle);

      const settingsButton = page.locator('#webmeetMediaSettingsButton');
      await expect(settingsButton).toBeVisible();

      await settingsButton.click();

      const settingsPanel = page.locator('#webmeetMediaSettingsPanel');
      await expect(settingsPanel).toBeVisible();
      const settingsDialog = page.locator('dialog.webmeet-settings-modal-dialog');
      await expect(settingsDialog).toBeVisible();
      await page.locator('#webmeetSettingsFullscreenButton').click();
      await expect(settingsDialog).toHaveClass(/is-fullscreen/);
      await expect(settingsPanel).toContainText('Audio & video');
      await expect(settingsPanel).toContainText('Camera background');
      await expect(settingsPanel).toContainText('Avatar');
      await expect(page.locator('#webmeetVoiceProcessingMode')).toHaveValue('auto');
      await expect(page.locator('#webmeetVoiceProcessingMode option').first()).toHaveText('Voice Focus, recommended');
      await expect(page.locator('#webmeetAutomaticParticipantVolume')).toBeChecked();
      await expect(page.locator('#webmeetAudioHealthIndicator')).toHaveAttribute('data-health', 'good');
      await expect(page.locator('#webmeetMicButton')).toHaveAttribute('title', 'Toggle Microphone - Audio: Good');

      const effectSelect = page.locator('#webmeetBackgroundEffectSelect');
      await expect(effectSelect).toBeVisible();

      await effectSelect.selectOption('blur');
      await expect(page.locator('#webmeetBackgroundBlurRow')).toBeVisible();

      await effectSelect.selectOption('image');
      await expect(page.locator('#webmeetBackgroundImageRow')).toBeVisible();
    } finally {
      await deleteRoomIfPresent(page, roomTitle).catch(() => null);
    }
  });

  test('settings controls expose inline help on hover and focus', async ({ page }) => {
    const roomTitle = `e2e-settings-help-${smokeConfig.runId}`;
    try {
      await openWebMeet(page);
      await createRoom(page, roomTitle);
      await joinRoom(page, roomTitle);

      await page.locator('#webmeetMediaSettingsButton').click();

      const voiceProcessingHelpButton = page.getByRole('button', { name: 'About Voice processing' });
      const voiceProcessingTooltip = page.locator('#webmeetSettingHelpVoiceProcessing');
      await voiceProcessingHelpButton.hover();
      await expect(voiceProcessingTooltip).toBeVisible();

      const echoHelpButton = page.getByRole('button', { name: 'About Echo cancellation' });
      const echoTooltip = page.locator('#webmeetSettingHelpEchoCancellation');
      await echoHelpButton.focus();
      await expect(echoTooltip).toBeVisible();
    } finally {
      await deleteRoomIfPresent(page, roomTitle).catch(() => null);
    }
  });
});
