import { test, expect, attachPageDiagnostics } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  expectNoWebchatSuggestion,
  expectWebchatSuggestion,
  openTaggedWebchat,
  setComposer,
  uploadFolder,
  uploadOneFile,
} from '../lib/webchat.mjs';

test.describe('WebChat uploads and session-scoped @ suggestions', () => {
  test('file uploads land under uploads/sessionId and are not suggested in sibling sessions', async ({ page, browser }, testInfo) => {
    await openTaggedWebchat(page);

    const upload = await uploadOneFile(page, testInfo);
    await setComposer(page, `@${upload.name.slice(0, 8)}`);
    await expectWebchatSuggestion(page, {
      group: 'Files and folders',
      text: upload.name,
    });

    const secondContext = await browser.newContext({
      baseURL: smokeConfig.baseURL,
      ignoreHTTPSErrors: true,
      permissions: ['camera', 'microphone'],
    });
    const secondPage = await secondContext.newPage();
    const diagnostics = attachPageDiagnostics(secondPage, testInfo, 'sibling-webchat-session');
    try {
      await openTaggedWebchat(secondPage);
      await setComposer(secondPage, `@${upload.name.slice(0, 8)}`);
      await expectNoWebchatSuggestion(secondPage, upload.name);
    } finally {
      await diagnostics.flush();
      await secondContext.close();
    }
  });

  test('folder uploads preserve nested relative paths under the session upload root', async ({ page }, testInfo) => {
    await openTaggedWebchat(page);

    const upload = await uploadFolder(page, testInfo);
    expect(upload.payload.relativePath).toBe(upload.relativePath);
    expect(upload.payload.workspacePath).toContain(`/${upload.relativePath}`);

    await setComposer(page, `@${upload.folderName}`);
    await expectWebchatSuggestion(page, {
      group: 'Files and folders',
      text: upload.relativePath,
    });
  });
});
