import assert from 'node:assert/strict';
import test from 'node:test';

import { dpuSnapshotPersistenceAdvanced } from './dpu-persistence.mjs';

const initialSnapshot = Object.freeze({
  blobSha256: 'initial-blob',
  updatedAt: '2026-07-28T18:04:19.309Z',
});

test('DPU persistence evidence rejects a blob-only intermediate state', () => {
  assert.equal(dpuSnapshotPersistenceAdvanced(initialSnapshot, {
    blobSha256: 'callback-blob',
    updatedAt: initialSnapshot.updatedAt,
  }), false);
});

test('DPU persistence evidence accepts matching blob and metadata advancement', () => {
  assert.equal(dpuSnapshotPersistenceAdvanced(initialSnapshot, {
    blobSha256: 'callback-blob',
    updatedAt: '2026-07-28T18:04:35.399Z',
  }), true);
});
