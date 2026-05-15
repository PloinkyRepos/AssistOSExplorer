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
  await signIn(page, account, '/dashboard');
  await page.goto(taggedWebchatPath(), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#cmd')).toBeVisible();
  await expect(page.locator('#send')).toBeVisible();
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

export async function uploadOneFile(page, testInfo, name = `smoke-${smokeConfig.runId}.txt`) {
  const fixtureDir = testInfo.outputPath('fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const filePath = path.join(fixtureDir, name);
  fs.writeFileSync(filePath, `smoke upload ${smokeConfig.runId}\n`);

  await page.locator('#fileUploadInput').setInputFiles(filePath);
  await expect(page.locator('.wa-file-preview-name', { hasText: name })).toBeVisible();

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/uploads')
  ));
  await page.locator('#send').click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.relativePath).toBe(name);
  expect(payload.workspacePath).toMatch(/^uploads\/[A-Za-z0-9_-]{1,128}\//);
  expect(payload.downloadUrl).toContain('/webchat/uploads');
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
  await expect(page.locator('.wa-file-preview-name', { hasText: relativePath })).toBeVisible();

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/uploads')
  ));
  await page.locator('#send').click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.relativePath).toBe(relativePath);
  expect(payload.workspacePath).toMatch(/^uploads\/[A-Za-z0-9_-]{1,128}\//);
  return { folderPath, folderName, relativePath, payload };
}
