import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('document server wrapper enables auto assembly before supervisor starts', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-wrapper-'));
  const jsonLog = path.join(tempDir, 'json.log');
  const fakeJson = path.join(tempDir, 'json-tool.sh');
  const fakeDocumentServer = path.join(tempDir, 'run-document-server.sh');

  await writeFile(fakeJson, [
    '#!/bin/bash',
    `printf '%s\\n' "$*" >> ${JSON.stringify(jsonLog)}`,
  ].join('\n'), { mode: 0o755 });
  await writeFile(fakeDocumentServer, [
    '#!/bin/bash',
    'set -e',
    `JSON=${JSON.stringify(fakeJson)}`,
    'service() { echo "service $*"; }',
    'service supervisor start',
  ].join('\n'), { mode: 0o755 });

  const { stdout } = await execFileAsync('/bin/bash', [
    'scripts/run-document-server-with-autoassembly.sh',
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT: fakeDocumentServer,
      ONLYOFFICE_AUTO_ASSEMBLY_ENABLED: 'true',
      ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL: '2m',
      ONLYOFFICE_AUTO_ASSEMBLY_STEP: '30s',
    },
  });
  const calls = await readFile(jsonLog, 'utf8');

  assert.match(calls, /autoAssembly\.enable = true/);
  assert.match(calls, /autoAssembly\.interval = '2m'/);
  assert.match(calls, /autoAssembly\.step = '30s'/);
  assert.match(stdout, /service supervisor start/);
});
