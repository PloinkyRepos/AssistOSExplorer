import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertOnlyOfficeImageContract } from '../src/index.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-image-contract-'));
  const contractPath = path.join(root, 'onlyoffice-v5.contract');
  const interposerPath = path.join(root, 'interposer.so');
  const interposer = Buffer.from('unit-test-interposer-bytes');
  const digest = createHash('sha256').update(interposer).digest('hex');
  await writeFile(interposerPath, interposer, { mode: 0o555 });
  await writeFile(contractPath, [
    'contract_version=5',
    'documentserver_index_sha256=53a06109f1f4029a78f913a061e14f01bff023d109024073a13d4416b54d2195',
    'ubuntu_snapshot=20260712T000000Z',
    'docservice_bind_scope=docservice-v5-port-8000',
    `interposer_sha256=${digest}`,
    '',
  ].join('\n'), { mode: 0o444 });
  await chmod(interposerPath, 0o555);
  await chmod(contractPath, 0o444);
  return { root, contractPath, interposerPath };
}

test('OnlyOffice runtime admits only an exact immutable image contract and matching interposer bytes', async () => {
  const value = await fixture();
  try {
    assert.doesNotThrow(() => assertOnlyOfficeImageContract({
      contractPath: value.contractPath,
      interposerPath: value.interposerPath,
      expectedUid: process.getuid(),
      expectedGid: process.getgid(),
    }));
    await chmod(value.interposerPath, 0o755);
    assert.throws(() => assertOnlyOfficeImageContract({
      contractPath: value.contractPath,
      interposerPath: value.interposerPath,
      expectedUid: process.getuid(),
      expectedGid: process.getgid(),
    }), /interposer ownership, mode, or file type is invalid/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('OnlyOffice runtime fails before listeners when the verified v5 image has not been published and pinned', () => {
  assert.throws(
    () => assertOnlyOfficeImageContract({
      contractPath: '/definitely/missing/onlyoffice-v5.contract',
      interposerPath: '/definitely/missing/interposer.so',
    }),
    /Publish and pin the verified v5 image before activation/,
  );
});
