import { test, expect, attachPageDiagnostics } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import {
  expectWebchatSuggestion,
  openTaggedWebchat,
  setComposer,
  uploadFolder,
  uploadOneFile,
} from '../lib/webchat.mjs';

test.describe('WebChat direct workspace uploads', () => {
  test('file uploads land in the selected working directory and are suggested in sibling sessions', async ({ page, browser }, testInfo) => {
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
      await expectWebchatSuggestion(secondPage, {
        group: 'Files and folders',
        text: upload.name,
      });
    } finally {
      await diagnostics.flush();
      await secondContext.close();
    }
  });

  test('folder uploads preserve nested paths in the selected working directory', async ({ page }, testInfo) => {
    await openTaggedWebchat(page);

    const upload = await uploadFolder(page, testInfo);
    expect(upload.payload.relativePath).toBe(upload.relativePath);
    expect(upload.payload.workspacePath).toBe(upload.relativePath);

    await setComposer(page, `@${upload.folderName}`);
    await expectWebchatSuggestion(page, {
      group: 'Files and folders',
      text: upload.relativePath,
    });
  });
});
