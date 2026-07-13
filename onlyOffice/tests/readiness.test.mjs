import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const agentRoot = new URL('..', import.meta.url);
const scriptPath = new URL('../readiness.sh', import.meta.url);

async function createFakeBin({ curlHttpCode = '200', curlStatus = 0, ncStatus = 0 } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-readiness-'));
  await writeFile(path.join(dir, 'curl'), `#!/bin/sh\nprintf '%s' '${curlHttpCode}'\nexit ${curlStatus}\n`);
  await writeFile(path.join(dir, 'nc'), `#!/bin/sh\nexit ${ncStatus}\n`);
  await chmod(path.join(dir, 'curl'), 0o755);
  await chmod(path.join(dir, 'nc'), 0o755);
  return dir;
}

test('readiness probe has valid shell syntax', () => {
  const result = spawnSync('sh', ['-n', scriptPath.pathname], {
    cwd: agentRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('readiness requires the control listener and proxied Document Server API', async () => {
  const successBin = await createFakeBin();
  const success = spawnSync('sh', [scriptPath.pathname], {
    cwd: agentRoot,
    env: { ...process.env, PATH: `${successBin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  assert.equal(success.status, 0, success.stderr || success.stdout);
  assert.match(success.stdout, /ready/);

  const noControlBin = await createFakeBin({ ncStatus: 1 });
  const noControl = spawnSync('sh', [scriptPath.pathname], {
    cwd: agentRoot,
    env: { ...process.env, PATH: `${noControlBin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  assert.notEqual(noControl.status, 0);
  assert.match(noControl.stdout, /control listener is not reachable/);

  const noEditorBin = await createFakeBin({ curlStatus: 22 });
  const noEditor = spawnSync('sh', [scriptPath.pathname], {
    cwd: agentRoot,
    env: { ...process.env, PATH: `${noEditorBin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  assert.notEqual(noEditor.status, 0);
  assert.match(noEditor.stdout, /editor proxy cannot serve/);

  const redirectBin = await createFakeBin({ curlHttpCode: '302' });
  const redirect = spawnSync('sh', [scriptPath.pathname], {
    cwd: agentRoot,
    env: { ...process.env, PATH: `${redirectBin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  assert.notEqual(redirect.status, 0);
  assert.match(redirect.stdout, /editor proxy cannot serve/);
});
