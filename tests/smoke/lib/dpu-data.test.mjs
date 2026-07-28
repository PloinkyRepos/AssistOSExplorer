import assert from 'node:assert/strict';
import test from 'node:test';

import { dpuData } from './dpu-data.mjs';

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
