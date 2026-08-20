import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { createHuggingFaceAdapter } from '../lib/source-adapters/huggingface-adapter.mjs';
import { createEdcAdapter } from '../lib/source-adapters/edc-adapter.mjs';
import { createEdcLocalFixture } from './fixtures/edc-local-fixture.mjs';

test('Hugging Face acquisition streams files and verifies provider sha256', async () => {
  const bytes = Buffer.from('a,b\n1,2\n');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fetchImplementation = async (url) => {
    if (String(url).includes('/api/datasets/')) {
      return new Response(JSON.stringify({ id: 'owner/data', sha: 'commit-1', siblings: [{ rfilename: 'data.csv', lfs: { oid: `sha256:${checksum}` } }] }), { status: 200 });
    }
    return new Response(bytes, { status: 200 });
  };
  const destinationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dpu-hf-'));
  try {
    const adapter = createHuggingFaceAdapter({ fetchImplementation });
    const result = await adapter.acquire({
      source: { id: 'hf', endpoint: 'https://hf.example' },
      resource: { externalId: 'owner/data', revision: 'commit-1' },
      destinationRoot
    });
    assert.equal(result.fileManifest[0].checksum, `sha256:${checksum}`);
    assert.equal(await fs.readFile(path.join(destinationRoot, 'data.csv'), 'utf8'), bytes.toString());
  } finally {
    await fs.rm(destinationRoot, { recursive: true, force: true });
  }
});

test('Hugging Face rejects a provider checksum mismatch before publication', async () => {
  const fetchImplementation = async (url) => String(url).includes('/api/datasets/')
    ? new Response(JSON.stringify({ id: 'owner/data', sha: 'commit-1', siblings: [{ rfilename: 'data.csv', lfs: { oid: `sha256:${'0'.repeat(64)}` } }] }), { status: 200 })
    : new Response('corrupt', { status: 200 });
  const destinationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dpu-hf-bad-'));
  try {
    const adapter = createHuggingFaceAdapter({ fetchImplementation });
    await assert.rejects(() => adapter.acquire({
      source: { id: 'hf', endpoint: 'https://hf.example' },
      resource: { externalId: 'owner/data', revision: 'commit-1' },
      destinationRoot
    }), /checksum mismatch/);
    await assert.rejects(() => fs.access(path.join(destinationRoot, 'data.csv')));
  } finally {
    await fs.rm(destinationRoot, { recursive: true, force: true });
  }
});

test('EDC adapter preserves catalog policy and uses negotiation before transfer', async () => {
  const fixture = createEdcLocalFixture();
  const adapter = createEdcAdapter({ fetchImplementation: fixture.fetchImplementation });
  const source = fixture.source;
  const resources = await adapter.discover({ source, query: 'Protected' });
  const resource = resources.find((item) => item.externalId === 'asset-protected');
  assert.equal(resource.accessState, 'pending');
  const negotiation = await adapter.requestAccess({ source, resource });
  assert.equal(negotiation['@id'], 'neg-1');
  const finalized = await adapter.getOperation({ source, operationId: 'neg-1', operationType: 'negotiation' });
  assert.equal(finalized.contractAgreementId, 'agreement-protected');
  await assert.rejects(() => adapter.acquire({ source, resource, destinationRoot: '/tmp/unused' }), /contract agreement/);
  const transfer = await adapter.acquire({ source, resource: { ...resource, providerFacts: { ...resource.providerFacts, contractAgreementId: finalized.contractAgreementId } }, destinationRoot: '/tmp/unused' });
  assert.equal(transfer.remoteOperation['@id'], 'transfer-1');
  assert.equal((await adapter.getOperation({ source, operationId: 'transfer-1' })).state, 'COMPLETED');
  assert.equal(fixture.calls.some((call) => call.path === '/control/negotiations'), true);
});
