import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOnlyOfficeEditorService } from '../src/edge-topology.mjs';

test('OnlyOffice derives browser URLs only from the Router-forwarded origin', async () => {
  const resolved = await resolveOnlyOfficeEditorService({
    req: {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'office.example',
      },
    },
  });
  assert.equal(resolved.browserOrigin, 'https://office.example');
  assert.equal(
    resolved.activeBrowserUrl,
    'https://office.example/base-agent-additional-server/onlyOffice/8080',
  );
});

test('OnlyOffice fails closed when the Router-forwarded browser origin is absent', async () => {
  await assert.rejects(
    () => resolveOnlyOfficeEditorService({
      req: { headers: {} },
      env: { PLOINKY_ROUTER_URL: 'http://host.containers.internal:8080' },
    }),
    /requires the Router-authenticated forwarded browser origin/,
  );
});
