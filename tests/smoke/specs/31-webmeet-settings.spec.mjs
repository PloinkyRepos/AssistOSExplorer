import { test, expect } from '../lib/fixtures.mjs';
import { openWebMeet } from '../lib/webmeet.mjs';

test.describe('WebMeet settings', () => {
  test('dashboard header exposes audio/video and privacy settings', async ({ page }) => {
    await openWebMeet(page);

    const settingsButton = page.locator('.modal-header #webmeetMediaSettingsButton');
    await expect(settingsButton).toBeVisible();

    await settingsButton.click();

    const settingsPanel = page.locator('#webmeetMediaSettingsPanel');
    await expect(settingsPanel).toBeVisible();
    const settingsDialog = page.locator('dialog.webmeet-settings-modal-dialog');
    await expect(settingsDialog).toBeVisible();
    await page.locator('#webmeetSettingsFullscreenButton').click();
    await expect(settingsDialog).toHaveClass(/is-fullscreen/);
    await expect(settingsPanel).toContainText('Audio & video');
    await expect(settingsPanel).toContainText('Background & privacy');
    await expect(page.locator('#webmeetVoiceProcessingMode')).toHaveValue('auto');
    await expect(page.locator('#webmeetVoiceProcessingMode option').first()).toHaveText('Automatic, recommended');
    await expect(page.locator('#webmeetAutomaticParticipantVolume')).toBeChecked();
    await expect(page.locator('#webmeetAudioHealthValue')).toHaveText('Good');

    const effectSelect = page.locator('#webmeetBackgroundEffectSelect');
    await expect(effectSelect).toBeVisible();

    await effectSelect.selectOption('blur');
    await expect(page.locator('#webmeetBackgroundBlurRow')).toBeVisible();

    await effectSelect.selectOption('image');
    await expect(page.locator('#webmeetBackgroundImageRow')).toBeVisible();
  });

  test('settings controls expose inline help on hover and focus', async ({ page }) => {
    await openWebMeet(page);

    await page.locator('.modal-header #webmeetMediaSettingsButton').click();

    const voiceProcessingHelpButton = page.getByRole('button', { name: 'About Voice processing' });
    const voiceProcessingTooltip = page.locator('#webmeetSettingHelpVoiceProcessing');
    await voiceProcessingHelpButton.hover();
    await expect(voiceProcessingTooltip).toBeVisible();

    const echoHelpButton = page.getByRole('button', { name: 'About Echo cancellation' });
    const echoTooltip = page.locator('#webmeetSettingHelpEchoCancellation');
    await echoHelpButton.focus();
    await expect(echoTooltip).toBeVisible();
  });
});
