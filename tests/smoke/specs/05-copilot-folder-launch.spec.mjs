import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { openExplorer } from '../lib/explorer.mjs';
import { setComposer, waitForWebchatIdle } from '../lib/webchat.mjs';

const BOT_MESSAGE = '#chatList > .wa-message.in:not(.wa-typing):not(.wa-task-item) .wa-message-bubble';
const STARTUP_FAILURE = /\[input error\]|bwrap:|Agent process exited repeatedly|open \/proc\/\d+\/ns/i;

function directoryRow(page, directoryPath) {
  return page.locator(`tr[data-entry-path="${directoryPath}"]`);
}

async function createDirectory(page, directoryName, directoryPath) {
  let promptMessage = '';
  page.once('dialog', async (dialog) => {
    promptMessage = dialog.message();
    await dialog.accept(directoryName);
  });
  await page.locator('#toolbarMenuButton').click();
  await page.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  expect(promptMessage).toMatch(/Enter name for the new directory/i);
  await expect(directoryRow(page, directoryPath)).toHaveCount(1, {
    timeout: smokeConfig.timeouts.navigation,
  });
}

async function deleteDirectoryIfPresent(page, directoryPath) {
  const row = directoryRow(page, directoryPath);
  if (await row.count() === 0) return;
  await row.locator('.action-menu-trigger').click();
  const deleteButton = row.getByRole('menuitem', { name: 'Delete', exact: true });
  await expect(deleteButton).toBeVisible({ timeout: smokeConfig.timeouts.action });
  page.once('dialog', async (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(row).toHaveCount(0, { timeout: smokeConfig.timeouts.navigation });
}

test.describe('Copilot launch from Explorer', () => {
  test('opens a working Copilot from a newly created folder', async ({ page }) => {
    test.setTimeout(Math.max(smokeConfig.timeouts.test, 180_000));
    const directoryName = `copilot-smoke-${smokeConfig.runId}`;
    const directoryPath = `/${directoryName}`;
    let copilotPage = null;

    await openExplorer(page);
    await expect(page.locator('#toolbarMenuButton')).toBeEnabled();
    await createDirectory(page, directoryName, directoryPath);

    try {
      const row = directoryRow(page, directoryPath);
      await row.locator('.action-menu-trigger').click();
      const openCopilot = row.getByRole('menuitem', {
        name: 'Open Copilot here',
        exact: true,
      });
      await expect(openCopilot).toBeVisible({ timeout: smokeConfig.timeouts.navigation });

      const popupPromise = page.waitForEvent('popup', {
        timeout: smokeConfig.timeouts.navigation,
      });
      await openCopilot.click();
      copilotPage = await popupPromise;
      await copilotPage.waitForLoadState('domcontentloaded');

      const launchUrl = new URL(copilotPage.url());
      expect(launchUrl.pathname).toBe('/webchat');
      expect(launchUrl.searchParams.get('agent')).toBe('achilles-cli');
      const requestedDirectory = launchUrl.searchParams.get('workspace-dir')
        || launchUrl.searchParams.get('dir')
        || '';
      expect(
        requestedDirectory === directoryName
          || requestedDirectory.endsWith(`/${directoryName}`),
        `Copilot launch directory should identify ${directoryPath}; received ${requestedDirectory}`,
      ).toBe(true);

      await expect(copilotPage.locator('#cmd')).toBeEditable({
        timeout: smokeConfig.timeouts.navigation,
      });
      await expect(copilotPage.locator('#send')).toBeVisible();
      await expect(copilotPage.locator('#chatList')).not.toContainText(STARTUP_FAILURE);

      await waitForWebchatIdle(copilotPage);
      const messageCount = await copilotPage.locator(BOT_MESSAGE).count();
      await setComposer(copilotPage, '/help');
      await copilotPage.locator('#send').click();

      await expect.poll(
        async () => copilotPage.locator(BOT_MESSAGE).count(),
        {
          message: 'Copilot should answer the local /help command',
          timeout: smokeConfig.timeouts.navigation,
        },
      ).toBeGreaterThan(messageCount);
      await waitForWebchatIdle(copilotPage);

      const replies = await copilotPage.locator(BOT_MESSAGE).evaluateAll(
        (messages, firstNewMessage) => messages
          .slice(firstNewMessage)
          .map((message) => message.textContent?.trim() || '')
          .filter(Boolean),
        messageCount,
      );
      expect(replies.length).toBeGreaterThan(0);
      expect(replies.join('\n')).toMatch(/help|command|permissions|session/i);
      await expect(copilotPage.locator('#chatList')).not.toContainText(STARTUP_FAILURE);
    } finally {
      await copilotPage?.close().catch(() => {});
      await deleteDirectoryIfPresent(page, directoryPath);
    }
  });
});
