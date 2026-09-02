import fs from 'node:fs';
import path from 'node:path';

import { expect } from './fixtures.mjs';
import { signIn } from './auth.mjs';
import { smokeConfig } from './config.mjs';

export function taggedWebchatPath() {
  const params = new URLSearchParams({
    agent: smokeConfig.webchatAgent,
    'research-tags': '1',
    'forward-envelope': '1',
    'tag-relay-agent': 'researchRelay',
    'tag-relay-submit-tool': 'research_task_submit',
    'tag-relay-list-tool': 'research_relay_list_backends',
    'tag-relay-tags': 'open-interpreter',
    'workspace-dir': '.',
  });
  return `/webchat?${params.toString()}`;
}

export async function openTaggedWebchat(page, account = smokeConfig.primaryUser) {
  await signIn(page, account, '/');
  await page.goto(taggedWebchatPath(), { waitUntil: 'load' });
  await expect(page.locator('#cmd')).toBeVisible();
  await cancelWebchatGenerationIfActive(page);
  await waitForWebchatIdle(page);
}

export async function waitForWebchatIdle(page, timeout = smokeConfig.timeouts.navigation) {
  await expect(page.locator('#typingIndicator')).toHaveAttribute('aria-hidden', 'true', { timeout });
  await expect(page.locator('#cancelBtn')).toBeHidden({ timeout });
  await expect(page.locator('#send')).toBeVisible();
}

export async function cancelWebchatGenerationIfActive(page) {
  await page.waitForTimeout(1_000);
  const cancelButton = page.locator('#cancelBtn');
  const active = await cancelButton.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!active) return;
  await cancelButton.click();
  await waitForWebchatIdle(page);
}

async function captureNextUploadResponse(page) {
  const pattern = '**/uploads**';
  let handler;
  const promise = new Promise((resolve, reject) => {
    handler = async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      try {
        const response = await route.fetch();
        const body = await response.text();
        let payload = null;
        try {
          payload = JSON.parse(body);
        } catch (error) {
          reject(error);
        }
        resolve({ status: response.status(), payload, body });
        await route.fulfill({ response, body });
      } catch (error) {
        reject(error);
        await route.abort().catch(() => {});
      } finally {
        await page.unroute(pattern, handler).catch(() => {});
      }
    };
  });
  await page.route(pattern, handler);
  return promise;
}

export async function setComposer(page, value) {
  await page.locator('#cmd').focus();
  await page.locator('#cmd').fill(value);
  await page.locator('#cmd').evaluate((input) => {
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function expectWebchatSuggestion(page, { group, text }) {
  await expect(page.locator('.wa-slash-menu')).toBeVisible();
  if (group) {
    await expect(page.locator('.wa-slash-menu-group', { hasText: group })).toBeVisible();
  }
  await expect(page.locator('.wa-slash-menu-item', { hasText: text }).first()).toBeVisible();
}

export async function expectNoWebchatSuggestion(page, text) {
  await page.waitForTimeout(1_000);
  await expect(page.locator('.wa-slash-menu-item', { hasText: text })).toHaveCount(0);
}

export async function selectActiveWebchatSuggestion(page) {
  await page.keyboard.press('Enter');
}

async function confirmDefaultUploadDestination(page) {
  const dialog = page.getByRole('dialog', { name: 'Choose upload destination' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Upload here' });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
}

export async function uploadOneFile(page, testInfo, name = `smoke-${smokeConfig.runId}.txt`) {
  const fixtureDir = testInfo.outputPath('fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const filePath = path.join(fixtureDir, name);
  fs.writeFileSync(filePath, `smoke upload ${smokeConfig.runId}\n`);

  await page.locator('#fileUploadInput').setInputFiles(filePath);
  await confirmDefaultUploadDestination(page);
  await expect(page.locator('.wa-file-preview-name', { hasText: name })).toBeVisible();

  const responsePromise = captureNextUploadResponse(page);
  await page.locator('#send').click();
  const { status, payload } = await responsePromise;
  expect(status, `WebChat upload failed: ${payload?.error || 'unknown error'}`).toBe(201);
  expect(payload.relativePath).toBe(name);
  expect(payload.workspacePath).toBe(name);
  expect(payload.downloadUrl).toBe(`/workspace-files/${encodeURIComponent(name)}`);
  await cancelWebchatGenerationIfActive(page);
  return { filePath, name, payload };
}

export async function uploadFolder(page, testInfo, folderName = `smoke-folder-${smokeConfig.runId}`) {
  const fixtureRoot = testInfo.outputPath('fixtures');
  const folderPath = path.join(fixtureRoot, folderName);
  fs.mkdirSync(path.join(folderPath, 'nested'), { recursive: true });
  const leafName = 'folder-note.txt';
  const relativePath = `${folderName}/nested/${leafName}`;
  fs.writeFileSync(path.join(folderPath, 'nested', leafName), `smoke folder upload ${smokeConfig.runId}\n`);

  await page.locator('#folderUploadInput').setInputFiles(folderPath);
  await confirmDefaultUploadDestination(page);
  await expect(page.locator('.wa-file-preview-name', { hasText: relativePath })).toBeVisible();

  const responsePromise = captureNextUploadResponse(page);
  await page.locator('#send').click();
  const { status, payload } = await responsePromise;
  expect(status, `WebChat upload failed: ${payload?.error || 'unknown error'}`).toBe(201);
  expect(payload.relativePath).toBe(relativePath);
  expect(payload.workspacePath).toBe(relativePath);
  await cancelWebchatGenerationIfActive(page);
  return { folderPath, folderName, relativePath, payload };
}
