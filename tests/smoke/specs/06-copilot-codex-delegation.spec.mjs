import crypto from 'node:crypto';

import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  createDirectory,
  deleteDirectoryIfPresent,
  directoryRow,
  openCopilotForDirectory,
} from '../lib/copilot.mjs';
import { assertExplorerDirectory, openExplorer } from '../lib/explorer.mjs';
import { setComposer, waitForWebchatIdle } from '../lib/webchat.mjs';

const BOT_MESSAGE = '#chatList > .wa-message.in:not(.wa-typing):not(.wa-task-item) .wa-message-bubble';

async function taskSummaries(page) {
  return page.locator('.wa-task-item[data-task-id]').evaluateAll((items) => items.map((item) => ({
    id: item.dataset.taskId || '',
    agent: (item.querySelector('.wa-task-summary-agent')?.textContent || '').trim(),
    description: (item.querySelector('.wa-task-summary-description')?.textContent || '').trim(),
    status: (item.querySelector('.wa-task-status')?.textContent || '').trim(),
  })));
}

test.describe('Copilot delegated Codex task', () => {
  test.skip(!smokeConfig.flags.codexDelegation, 'set SMOKE_CODEX_DELEGATION=1 to run the real Codex delegation gate');

  test('delegates a folder-scoped file task specifically to codexAgent', async ({ page }, testInfo) => {
    test.setTimeout(Math.max(
      smokeConfig.timeouts.test,
      smokeConfig.timeouts.relay + 180_000,
    ));
    const correlation = crypto.randomUUID();
    const marker = `CODEX_DELEGATION_OK_${correlation}`;
    const directoryName = `copilot-codex-${smokeConfig.runId}`;
    const directoryPath = `/${directoryName}`;
    const filename = `codex-proof-${correlation}.txt`;
    const filePath = `${directoryPath}/${filename}`;
    let copilotPage = null;

    await openExplorer(page);
    await expect(page.locator('#toolbarMenuButton')).toBeEnabled();
    await createDirectory(page, directoryName, directoryPath);

    try {
      copilotPage = await openCopilotForDirectory(page, directoryPath);
      await expect(copilotPage.locator('#cmd')).toBeEditable({
        timeout: smokeConfig.timeouts.navigation,
      });
      await waitForWebchatIdle(copilotPage);

      const baselineTaskIds = new Set(
        (await taskSummaries(copilotPage)).map((task) => task.id),
      );
      const baselineBotCount = await copilotPage.locator(BOT_MESSAGE).count();
      const prompt = [
        'Delegate this task specifically to Codex/codexAgent.',
        `In the current project directory create exactly ${filename} whose complete contents are ${marker} followed by a newline.`,
        'Modify nothing else.',
        `After verifying the file, reply exactly ${marker}.`,
      ].join(' ');

      await setComposer(copilotPage, prompt);
      await copilotPage.locator('#send').click();

      await expect.poll(async () => {
        const messages = await copilotPage.locator(BOT_MESSAGE).allTextContents();
        return messages.slice(baselineBotCount).some((text) => /Task started\./.test(text));
      }, {
        timeout: smokeConfig.timeouts.relay,
        message: 'Copilot should acknowledge a structured delegated task',
      }).toBe(true);

      let delegatedTask = null;
      await expect.poll(async () => {
        const created = (await taskSummaries(copilotPage)).filter((task) => (
          !baselineTaskIds.has(task.id)
          && task.agent === 'codexAgent'
          && task.description.includes(filename)
          && task.description.includes(marker)
        ));
        delegatedTask = created.length === 1 ? created[0] : null;
        return created.length;
      }, {
        timeout: smokeConfig.timeouts.relay,
        message: 'Copilot should create exactly one new codexAgent task for the unique file request',
      }).toBe(1);

      const taskCard = copilotPage.locator(`.wa-task-item[data-task-id="${delegatedTask.id}"]`);
      await expect(taskCard.locator('.wa-task-summary-agent')).toHaveText('codexAgent');
      await expect(taskCard.locator('.wa-task-status')).toHaveText('COMPLETED', {
        timeout: smokeConfig.timeouts.relay,
      });

      await copilotPage.locator('#tasksBtn').click();
      const taskListItem = copilotPage.locator('.wa-task-list-item').filter({
        hasText: filename,
      });
      await expect(taskListItem).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
      await taskListItem.click();
      await expect(copilotPage.locator('#taskDetail .wa-task-meta')).toContainText('codexAgent · execute-task', {
        timeout: smokeConfig.timeouts.navigation,
      });
      await expect(copilotPage.locator('#taskDetail .wa-task-log')).toContainText(marker, {
        timeout: smokeConfig.timeouts.relay,
      });

      await directoryRow(page, directoryPath).click();
      await assertExplorerDirectory(page, directoryPath);
      await page.locator('#refreshButton').click();
      const proofRow = directoryRow(page, filePath);
      await expect(proofRow).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
      await proofRow.click();
      await expect(page.locator('#editorFileName')).toHaveText(filename, {
        timeout: smokeConfig.timeouts.navigation,
      });
      await expect(page.locator('#filePreview')).toHaveText(marker, {
        timeout: smokeConfig.timeouts.navigation,
      });

      await testInfo.attach('copilot-codex-delegation-evidence.json', {
        body: Buffer.from(JSON.stringify({
          directoryPath,
          filePath,
          marker,
          taskId: delegatedTask.id,
          targetAgent: delegatedTask.agent,
          taskStatus: 'COMPLETED',
          taskTool: 'execute-task',
          filePreviewVerified: true,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await copilotPage?.close().catch(() => {});
      await openExplorer(page).catch(() => {});
      await deleteDirectoryIfPresent(page, directoryPath);
    }
  });
});
