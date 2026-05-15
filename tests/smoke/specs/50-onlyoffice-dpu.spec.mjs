import { test, expect } from '../lib/fixtures.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { openExplorer } from '../lib/explorer.mjs';

test.describe('DPU and OnlyOffice @external', () => {
  test.skip(!smokeConfig.flags.onlyoffice, 'Set SMOKE_ONLYOFFICE=1 to run OnlyOffice/DPU smoke checks.');

  test('OnlyOffice session route is browser-reachable for Confidential document paths', async ({ page }) => {
    await openExplorer(page, { hash: 'file-exp/Confidential' });
    const response = await page.request.get('/services/explorer/office/session?path=/Confidential/My%20Space/smoke-placeholder.doc');
    expect([200, 400]).toContain(response.status());
    const body = await response.text();
    expect(body).not.toMatch(/ONLYOFFICE_PUBLIC_URL is not configured|Failed to load OnlyOffice API script/i);
  });
});
