import assert from 'node:assert/strict';
import test from 'node:test';

import { dpuData, resolveDpuBoxEndpoint } from './dpu-data.mjs';

test('DPU evidence paths reject parent traversal before filesystem normalization', () => {
  for (const segments of [
    ['..', 'state.json'],
    ['nested/../../state.json'],
    ['nested\\..\\..\\state.json'],
  ]) {
    assert.throws(
      () => dpuData.exists(...segments),
      /parent traversal segment/,
      segments.join('/'),
    );
  }
});

test('DPU Box evidence requires a separate exact loopback authority', () => {
  assert.throws(
    () => resolveDpuBoxEndpoint({ deploymentMode: 'box', boxBaseURL: '' }),
    /requires an explicit loopback SMOKE_BOX_BASE_URL/,
  );
  assert.throws(
    () => resolveDpuBoxEndpoint({
      deploymentMode: 'box',
      boxBaseURL: 'https://explorer-qa.axiologic.dev',
    }),
    /SMOKE_BOX_BASE_URL must be an exact credential-free http:\/\/127\.0\.0\.1/,
  );
  assert.deepEqual(
    resolveDpuBoxEndpoint({
      deploymentMode: 'box',
      boxBaseURL: 'http://127.0.0.1:8097',
    }),
    { baseURL: 'http://127.0.0.1:8097', port: '8097' },
  );
});
