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

test.describe('DPU and OnlyOffice @external', () => {
  test.skip(!smokeConfig.flags.onlyoffice, 'Set SMOKE_ONLYOFFICE=1 to run OnlyOffice/DPU smoke checks.');

  test('Explorer-created Confidential document is stored in DPU before OnlyOffice session creation', async ({ browser }) => {
    expect(
      fs.existsSync(smokeConfig.dpuDataRoot),
      `DPU data root should exist at ${smokeConfig.dpuDataRoot}. Set SMOKE_WORKSPACE_ROOT or SMOKE_DPU_DATA_ROOT for local deployments.`
    ).toBe(true);

    const fileName = `smoke-onlyoffice-${smokeConfig.runId}.doc`;
    const documentPath = `/Confidential/My Space/${fileName}`;
    const context = await browser.newContext({ baseURL: smokeConfig.baseURL });
    const page = await context.newPage();

    try {
      await openExplorer(page, { hash: 'file-exp/Confidential/My%20Space' });
      await expect(page.locator('#toolbarMenuButton')).toBeEnabled();

      const createdPath = await page.evaluate(async ({ name }) => {
        const fileExp = document.querySelector('file-exp')?.webSkelPresenter;
        if (!fileExp) {
          throw new Error('Explorer file-exp presenter is not available.');
        }
        const { createDpuFile } = await import('/explorer/web-components/pages/file-exp/file-exp-dpu-provider.js');
        const created = await createDpuFile(fileExp, fileExp.state.path, name, { content: '' });
        const pathValue = created?.path || fileExp.joinPath(fileExp.state.path, created?.key || created?.name || name);
        const entries = await fileExp.loadDirectoryContent(fileExp.state.path);
        if (entries !== null) {
          await fileExp.setEntries(entries);
        }
        fileExp.invalidate();
        return pathValue;
      }, { name: fileName });
      expect(createdPath).toBe(documentPath);

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
    } finally {
      await context.close();
    }
  });
});
