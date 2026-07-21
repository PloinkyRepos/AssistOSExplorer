import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { openExplorer } from '../lib/explorer.mjs';

function readDpuState() {
  const statePath = path.join(smokeConfig.dpuDataRoot, 'state.json');
  if (!fs.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function findDpuObjectByName(name) {
  const state = readDpuState();
  const objects = state?.objects && typeof state.objects === 'object'
    ? Object.values(state.objects)
    : [];
  return objects.find((object) => object?.name === name && object?.type === 'file') || null;
}

function hasPlainWorkspaceCopy(documentPath) {
  if (!smokeConfig.workspaceRoot) {
    return false;
  }
  return fs.existsSync(path.join(smokeConfig.workspaceRoot, documentPath.replace(/^\/+/, '')));
}

async function frameBodyText(frame) {
  try {
    return await frame.locator('body').innerText({ timeout: 1000 });
  } catch {
    return '';
  }
}

async function collectOnlyOfficeFrameText(page) {
  const entries = [];
  for (const frame of page.frames()) {
    const url = frame.url();
    const text = await frameBodyText(frame);
    if (
      !/onlyoffice|web-apps|documenteditor|doceditor|sdkjs|127\.0\.0\.1:8082|127\.0\.0\.1:18082/i.test(url) &&
      !/ONLYOFFICE|Download failed|Word count|Page \d+ of/i.test(text)
    ) {
      continue;
    }
    entries.push({
      url,
      text,
    });
  }
  return entries;
}

async function expectOnlyOfficeEditorLoadsDocument(page) {
  await expect(page.locator('iframe').first()).toBeVisible({
    timeout: smokeConfig.timeouts.navigation,
  });

  await expect.poll(async () => {
    const frameText = await collectOnlyOfficeFrameText(page);
    const combinedText = frameText.map((entry) => entry.text).join('\n');
    if (/Download failed/i.test(combinedText)) {
      return 'download failed';
    }
    if (frameText.some((entry) => (
      /DocsAPI|documenteditor|web-apps/i.test(entry.url) ||
      /ONLYOFFICE|Word count|Page \d+ of/i.test(entry.text)
    ))) {
      return 'loaded';
    }
    return 'waiting';
  }, {
    timeout: smokeConfig.timeouts.navigation,
    message: 'OnlyOffice editor iframe should load without a Document Server download failure.',
  }).toBe('loaded');

  const stabilityDeadline = Date.now() + Math.min(15_000, smokeConfig.timeouts.navigation);
  while (Date.now() < stabilityDeadline) {
    const frameText = await collectOnlyOfficeFrameText(page);
    const combinedText = frameText.map((entry) => entry.text).join('\n');
    expect(combinedText).not.toMatch(/Download failed/i);
    await page.waitForTimeout(500);
  }
}

test.describe('DPU and OnlyOffice @external', () => {
  test.skip(!smokeConfig.flags.onlyoffice, 'Set SMOKE_ONLYOFFICE=1 to run OnlyOffice/DPU smoke checks.');

  test('Explorer-created Confidential document is stored in DPU and opens in OnlyOffice', async ({ page }) => {
    expect(
      fs.existsSync(smokeConfig.dpuDataRoot),
      `DPU data root should exist at ${smokeConfig.dpuDataRoot}. Set SMOKE_WORKSPACE_ROOT or SMOKE_DPU_DATA_ROOT for local deployments.`
    ).toBe(true);

    const fileName = `smoke-onlyoffice-${smokeConfig.runId}.doc`;
    const documentPath = `/Confidential/My Space/${fileName}`;

      await openExplorer(page, { hash: 'file-exp/Confidential/My%20Space' });
      await expect(page.locator('#toolbarMenuButton')).toBeEnabled();

      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept(fileName);
      });
      await page.locator('#toolbarMenuButton').click();
      await page.getByRole('menuitem', { name: 'New File' }).click();
      expect(dialogMessage).toMatch(/Enter name for the new file/i);

      await page.waitForFunction((expectedPath) => {
        const presenter = document.querySelector('file-exp')?.webSkelPresenter;
        const entries = Array.isArray(presenter?.state?.entries) ? presenter.state.entries : [];
        return entries.some((entry) => entry?.path === expectedPath);
      }, documentPath, { timeout: smokeConfig.timeouts.action });

      await expect.poll(() => Boolean(findDpuObjectByName(fileName)), {
        timeout: smokeConfig.timeouts.action,
        message: `DPU state should contain ${fileName}`,
      }).toBe(true);
      const dpuObject = findDpuObjectByName(fileName);
      expect(dpuObject.mimeType).toBe('application/msword');

      const blobPath = path.join(smokeConfig.dpuDataRoot, 'blobs', dpuObject.id);
      expect(fs.existsSync(blobPath), `DPU blob should exist at ${blobPath}`).toBe(true);
      const blob = fs.readFileSync(blobPath);
      expect(blob.subarray(0, 7).toString('ascii')).toBe('DPUENC1');
      expect(blob.includes(Buffer.from(fileName))).toBe(false);
      expect(hasPlainWorkspaceCopy(documentPath), `${documentPath} should not be stored as a normal workspace file`).toBe(false);

      const response = await page.request.get(`/services/onlyoffice/office/session?path=${encodeURIComponent(documentPath)}`);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.preview).toMatchObject({
        storageKind: 'dpu',
        requestedPath: documentPath,
        objectId: dpuObject.id,
      });

      await page.evaluate(async ({ path }) => {
        const fileExp = document.querySelector('file-exp')?.webSkelPresenter;
        if (!fileExp) {
          throw new Error('Explorer file-exp presenter is not available.');
        }
        await fileExp.openFile(path);
      }, { path: documentPath });
      await expectOnlyOfficeEditorLoadsDocument(page);
  });
});
