import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { getWithoutKeepAlive } from '../lib/api-probe.mjs';
import { dpuData } from '../lib/dpu-data.mjs';
import { dpuSnapshotPersistenceAdvanced } from '../lib/dpu-persistence.mjs';
import { assertExplorerDirectory, openExplorer } from '../lib/explorer.mjs';
import { resolvePloinkyExecutable } from '../lib/ploinky-executable.mjs';

const execFileAsync = promisify(execFile);

function readDpuState() {
  if (!dpuData.exists('state.json')) {
    return null;
  }
  return dpuData.readJson('state.json');
}

function listDpuFileObjects() {
  const state = readDpuState();
  const objects = state?.confidentialObjects && typeof state.confidentialObjects === 'object'
    ? Object.values(state.confidentialObjects)
    : [];
  return objects.filter((object) => object?.type === 'file' && object?.id);
}

function findDpuObjectByName(name, excludedIds = new Set()) {
  return listDpuFileObjects().find((object) => (
    object?.name === name && !excludedIds.has(object.id)
  )) || null;
}

function findDpuObjectById(objectId) {
  return listDpuFileObjects().find((object) => object.id === objectId) || null;
}

function readDpuObjectSnapshot(objectId) {
  const object = findDpuObjectById(objectId);
  if (!object?.id) {
    return null;
  }
  if (!dpuData.exists('blobs', object.id)) {
    return null;
  }
  const blob = dpuData.readBuffer('blobs', object.id);
  return {
    id: object.id,
    updatedAt: object.updatedAt || '',
    blobPath: dpuData.describe('blobs', object.id),
    blobBytes: blob.length,
    blobSha256: crypto.createHash('sha256').update(blob).digest('hex'),
  };
}

function hasPlainWorkspaceCopy(documentPath) {
  return dpuData.workspaceFileExists(documentPath);
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
      !/onlyoffice|web-apps|documenteditor|doceditor|sdkjs|public-services\/onlyoffice-editor/i.test(url) &&
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

  const frameText = await collectOnlyOfficeFrameText(page);
  expect(frameText.map((entry) => entry.text).join('\n')).not.toMatch(/Download failed/i);
}

async function waitForOnlyOfficeEditorFrame(page) {
  let editorFrame = null;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }
      if (await frame.locator('#area_id').count()) {
        editorFrame = frame;
        return frame.url();
      }
    }
    return '';
  }, {
    timeout: smokeConfig.timeouts.navigation,
    message: 'The pinned OnlyOffice editor frame should expose its real input surface.',
  }).toMatch(/documenteditor|web-apps|onlyoffice/i);
  return editorFrame;
}

async function readOnlyOfficeDocumentText(editorFrame) {
  return editorFrame.evaluate(() => {
    const application = window.DE?.getApplication?.();
    const candidates = [
      application?.getController?.('Main')?.api,
      window.Asc?.editor,
      window.editor,
    ];
    const api = candidates.find((candidate) => (
      typeof candidate?.asc_EditSelectAll === 'function' &&
      typeof candidate?.asc_GetSelectedText === 'function'
    ));
    if (!api) {
      throw new Error('Pinned OnlyOffice SDK did not expose its document text API.');
    }
    api.asc_EditSelectAll();
    return String(api.asc_GetSelectedText() || '');
  });
}

async function typeDocumentMarker(page, editorFrame, marker) {
  const editorCanvas = editorFrame.locator('#id_viewer_overlay');
  await expect(editorCanvas).toBeVisible({ timeout: smokeConfig.timeouts.navigation });
  const canvasBox = await editorCanvas.boundingBox();
  expect(canvasBox, 'OnlyOffice editor canvas should have a rendered browser box.').not.toBeNull();
  await page.mouse.click(
    canvasBox.x + (canvasBox.width / 2),
    canvasBox.y + Math.min(canvasBox.height / 3, 180)
  );

  const input = editorFrame.locator('#area_id');
  await expect(input).toBeAttached();
  await input.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(marker);

  await expect.poll(() => readOnlyOfficeDocumentText(editorFrame), {
    timeout: smokeConfig.timeouts.action,
    message: 'The real OnlyOffice document model should contain the keyboard-entered marker.',
  }).toContain(marker);
}

async function forceSaveDocument(editorFrame) {
  const saveButton = editorFrame.getByRole('button', { name: /^Save(?: \(Ctrl\+S\))?$/ });
  await expect(saveButton).toHaveCount(1);
  await expect(saveButton).toBeVisible({ timeout: smokeConfig.timeouts.action });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
}

async function restartOnlyOffice(executable) {
  if (!smokeConfig.workspaceRoot) {
    throw new Error('SMOKE_WORKSPACE_ROOT is required for the targeted OnlyOffice restart.');
  }
  const { stdout, stderr } = await execFileAsync(executable, ['restart', 'onlyOffice'], {
    cwd: smokeConfig.workspaceRoot,
    env: { ...process.env, PLOINKY_CWD: smokeConfig.workspaceRoot }
  });
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

async function waitForOnlyOfficeSession(page, documentPath) {
  let lastPayload = null;
  await expect.poll(async () => {
    try {
      const response = await getWithoutKeepAlive(page.request,
        `/base-agent-additional-server/onlyOffice/7000/control/office/session?path=${encodeURIComponent(documentPath)}`
      );
      lastPayload = await response.json().catch(() => ({}));
      return response.status();
    } catch {
      return 0;
    }
  }, {
    timeout: smokeConfig.timeouts.navigation,
    message: 'OnlyOffice control service should reactivate after its targeted restart.',
  }).toBe(200);
  expect(lastPayload?.ok).toBe(true);
  return lastPayload;
}

async function openDocumentFromExplorer(page, documentPath) {
  await page.evaluate(async ({ path }) => {
    const fileExp = document.querySelector('file-exp')?.webSkelPresenter;
    if (!fileExp) {
      throw new Error('Explorer file-exp presenter is not available.');
    }
    await fileExp.openFile(path);
  }, { path: documentPath });
  await expectOnlyOfficeEditorLoadsDocument(page);
  return waitForOnlyOfficeEditorFrame(page);
}

async function deleteConfidentialDocument(page, documentPath, objectId) {
  if (!objectId || !findDpuObjectById(objectId)) {
    return { deleted: true, alreadyMissing: true };
  }
  await openExplorer(page, { hash: 'file-exp/Confidential/My%20Space' });
  await assertExplorerDirectory(page, '/Confidential/My Space');
  if (!findDpuObjectById(objectId)) {
    return { deleted: true, alreadyMissing: true };
  }
  const row = page.locator(`tr[data-entry-path="${documentPath}"]`);
  await expect(row).toHaveCount(1, { timeout: smokeConfig.timeouts.action });
  await row.locator('.action-menu-trigger').click();
  const deleteButton = row.getByRole('menuitem', { name: 'Delete' });
  await expect(deleteButton).toBeVisible({ timeout: smokeConfig.timeouts.action });
  page.once('dialog', async (dialog) => dialog.accept());
  await deleteButton.click();
  await expect.poll(() => Boolean(findDpuObjectById(objectId)), {
    timeout: smokeConfig.timeouts.navigation,
    message: `DPU object ${objectId} should be removed during smoke cleanup.`,
  }).toBe(false);
  return { deleted: true };
}

test.describe('DPU and OnlyOffice @external', () => {
  test.skip(!smokeConfig.flags.onlyoffice, 'Set SMOKE_ONLYOFFICE=1 to run OnlyOffice/DPU smoke checks.');

  test('Explorer-created Confidential document saves through callback, drains, and reopens after targeted restart', async ({ browser }, testInfo) => {
    // A targeted OnlyOffice replacement includes graceful shutdown, image
    // recreation, and semantic readiness. On a cold Box that bounded lifecycle
    // legitimately exceeds the generic two-minute UI smoke budget.
    test.setTimeout(Math.max(smokeConfig.timeouts.test, 300_000));
    expect(
      dpuData.exists(),
      `DPU data root should exist at ${dpuData.describe()}. Set SMOKE_WORKSPACE_ROOT or SMOKE_DPU_DATA_ROOT for local deployments.`
    ).toBe(true);
    const ploinkyExecutable = resolvePloinkyExecutable();

    const fileName = `smoke-onlyoffice-${smokeConfig.runId}.docx`;
    const documentPath = `/Confidential/My Space/${fileName}`;
    const preExistingIds = new Set(listDpuFileObjects().map((object) => object.id));
    const context = await browser.newContext({ baseURL: smokeConfig.baseURL });
    const page = await context.newPage();
    let createdObjectId = null;
    let primaryError = null;

    try {
      await openExplorer(page, { hash: 'file-exp/Confidential/My%20Space' });
      await assertExplorerDirectory(page, '/Confidential/My Space');
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

      await expect.poll(() => Boolean(findDpuObjectByName(fileName, preExistingIds)), {
        timeout: smokeConfig.timeouts.action,
        message: `DPU state should contain ${fileName}`,
      }).toBe(true);
      const dpuObject = findDpuObjectByName(fileName, preExistingIds);
      createdObjectId = dpuObject.id;
      expect(dpuObject.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      const blobPath = dpuData.describe('blobs', dpuObject.id);
      expect(dpuData.exists('blobs', dpuObject.id), `DPU blob should exist at ${blobPath}`).toBe(true);
      const blob = dpuData.readBuffer('blobs', dpuObject.id);
      expect(blob.subarray(0, 7).toString('ascii')).toBe('DPUENC1');
      expect(blob.includes(Buffer.from(fileName))).toBe(false);
      expect(hasPlainWorkspaceCopy(documentPath), `${documentPath} should not be stored as a normal workspace file`).toBe(false);

      const response = await getWithoutKeepAlive(page.request, `/base-agent-additional-server/onlyOffice/7000/control/office/session?path=${encodeURIComponent(documentPath)}`);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.preview).toMatchObject({
        storageKind: 'dpu',
        requestedPath: documentPath,
        objectId: dpuObject.id,
      });
      expect(payload.config).toMatchObject({
        documentType: 'word',
        document: {
          fileType: 'docx',
        },
      });

      const initialSnapshot = readDpuObjectSnapshot(createdObjectId);
      expect(initialSnapshot).not.toBeNull();

      const marker = `OnlyOffice-release-${smokeConfig.runId}`;
      const editorFrame = await openDocumentFromExplorer(page, documentPath);
      await typeDocumentMarker(page, editorFrame, marker);
      await forceSaveDocument(editorFrame);

      let callbackSnapshot = null;
      await expect.poll(() => {
        callbackSnapshot = readDpuObjectSnapshot(createdObjectId);
        return dpuSnapshotPersistenceAdvanced(initialSnapshot, callbackSnapshot);
      }, {
        timeout: smokeConfig.timeouts.navigation,
        message: 'OnlyOffice force-save callback should replace the encrypted DPU blob and persist its metadata.',
      }).toBe(true);
      expect(callbackSnapshot?.blobSha256).not.toBe(initialSnapshot.blobSha256);
      expect(callbackSnapshot?.id).toBe(initialSnapshot.id);
      expect(callbackSnapshot?.updatedAt).not.toBe(initialSnapshot.updatedAt);

      const drainMarker = `OnlyOffice-drain-${smokeConfig.runId}`;
      await typeDocumentMarker(page, editorFrame, drainMarker);
      const preDrainSnapshot = readDpuObjectSnapshot(createdObjectId);
      expect(preDrainSnapshot?.id).toBe(initialSnapshot.id);
      expect(
        preDrainSnapshot?.blobSha256,
        'The second editor change must still be absent from durable DPU state before targeted drain begins.',
      ).toBe(callbackSnapshot.blobSha256);
      expect(preDrainSnapshot?.updatedAt).toBe(callbackSnapshot.updatedAt);

      const restartResult = await restartOnlyOffice(ploinkyExecutable);
      expect(restartResult.stderr).not.toMatch(/failed to (?:restart|start)|managed restart failed/i);
      expect(restartResult.stdout).toMatch(/✓ Agent restarted(?: \([^)]+\))?\./);

      const drainSnapshot = readDpuObjectSnapshot(createdObjectId);
      expect(drainSnapshot?.id).toBe(initialSnapshot.id);
      expect(
        drainSnapshot?.blobSha256,
        'Targeted restart must force-save and receive a fresh callback acknowledgement before stopping OnlyOffice.'
      ).not.toBe(callbackSnapshot.blobSha256);
      expect(drainSnapshot?.updatedAt).not.toBe(callbackSnapshot.updatedAt);

      await waitForOnlyOfficeSession(page, documentPath);
      await openExplorer(page, { hash: 'file-exp/Confidential/My%20Space' });
      await assertExplorerDirectory(page, '/Confidential/My Space');
      const reopenedFrame = await openDocumentFromExplorer(page, documentPath);
      let reopenedText = '';
      await expect.poll(async () => {
        reopenedText = await readOnlyOfficeDocumentText(reopenedFrame);
        return reopenedText.includes(marker) && reopenedText.includes(drainMarker);
      }, {
        timeout: smokeConfig.timeouts.navigation,
        message: 'Both the explicit-save edit and the edit outstanding at drain should reopen after targeted restart.',
      }).toBe(true);

      const reopenedSnapshot = readDpuObjectSnapshot(createdObjectId);
      expect(reopenedSnapshot?.blobSha256).toBe(drainSnapshot.blobSha256);
      await testInfo.attach('onlyoffice-release-evidence.json', {
        body: Buffer.from(JSON.stringify({
          documentPath,
          objectId: reopenedSnapshot.id,
          before: {
            updatedAt: initialSnapshot.updatedAt,
            blobBytes: initialSnapshot.blobBytes,
            blobSha256: initialSnapshot.blobSha256,
          },
          callbackAcknowledged: {
            updatedAt: callbackSnapshot.updatedAt,
            blobBytes: callbackSnapshot.blobBytes,
            blobSha256: callbackSnapshot.blobSha256,
            explicitSaveMarker: marker,
          },
          outstandingBeforeDrain: {
            updatedAt: preDrainSnapshot.updatedAt,
            blobBytes: preDrainSnapshot.blobBytes,
            blobSha256: preDrainSnapshot.blobSha256,
            unchangedFromCallback: preDrainSnapshot.blobSha256 === callbackSnapshot.blobSha256,
            outstandingMarker: drainMarker,
            adminControlPreparedBeforeEdit: true,
          },
          targetedDrainAcknowledged: {
            updatedAt: drainSnapshot.updatedAt,
            blobBytes: drainSnapshot.blobBytes,
            blobSha256: drainSnapshot.blobSha256,
          },
          targetedRestart: {
            status: restartResult.status,
            code: restartResult.code,
          },
          reopenedBlobSha256: reopenedSnapshot.blobSha256,
          markersObservedAfterRestart: {
            explicitSaveMarker: reopenedText.includes(marker),
            outstandingMarker: reopenedText.includes(drainMarker),
          },
        }, null, 2)),
        contentType: 'application/json',
      });
    } catch (error) {
      await page.screenshot({
        path: testInfo.outputPath('onlyoffice-failure.png'),
        fullPage: true,
      }).catch(() => null);
      primaryError = error;
    } finally {
      const cleanup = await deleteConfidentialDocument(page, documentPath, createdObjectId)
        .catch((error) => ({ deleted: false, error: String(error?.message || error) }));
      await context.close().catch(() => null);
      if (primaryError) {
        throw primaryError;
      }
      if (!cleanup.deleted) {
        throw new Error(`Confidential document cleanup failed: ${cleanup.error || 'unknown error'}`);
      }
    }
  });
});
