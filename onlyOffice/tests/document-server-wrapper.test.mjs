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
  const rabbitmqConfig = path.join(tempDir, 'rabbitmq.conf');

  await writeFile(fakeJson, [
    '#!/bin/bash',
    `printf '%s\\n' "$*" >> ${JSON.stringify(jsonLog)}`,
  ].join('\n'), { mode: 0o755 });
  await writeFile(fakeDocumentServer, [
    '#!/bin/bash',
    'set -e',
    `JSON=${JSON.stringify(fakeJson)}`,
    'service() { echo "service $*"; }',
    'install() { echo "install $*"; }',
    'start-stop-daemon() { echo "start-stop-daemon $*"; }',
    'LOCAL_SERVICES=(postgresql rabbitmq-server)',
    'for i in "${LOCAL_SERVICES[@]}"; do',
    '  service $i start',
    'done',
    'service supervisor start',
  ].join('\n'), { mode: 0o755 });
  await writeFile(rabbitmqConfig, [
    'listeners.tcp.default = 5672',
    'vm_memory_calculation_strategy = rss',
    'vm_memory_calculation_strategy=allocated',
    '',
  ].join('\n'), { mode: 0o640 });

  const { stdout } = await execFileAsync('/bin/bash', [
    'scripts/run-document-server-with-autoassembly.sh',
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT: fakeDocumentServer,
      ONLYOFFICE_RABBITMQ_CONFIG_FILE: rabbitmqConfig,
      ONLYOFFICE_AUTO_ASSEMBLY_ENABLED: 'true',
      ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL: '2m',
      ONLYOFFICE_AUTO_ASSEMBLY_STEP: '30s',
    },
  });
  const calls = await readFile(jsonLog, 'utf8');
  const rabbitmqConfigContents = await readFile(rabbitmqConfig, 'utf8');

  assert.match(calls, /autoAssembly\.enable = true/);
  assert.match(calls, /autoAssembly\.interval = '2m'/);
  assert.match(calls, /autoAssembly\.step = '30s'/);
  assert.match(stdout, /service postgresql start/);
  assert.match(stdout, /start-stop-daemon .*--exec \/usr\/sbin\/rabbitmq-server .*--background/);
  assert.doesNotMatch(stdout, /service rabbitmq-server start/);
  assert.match(stdout, /service supervisor start/);
  assert.match(rabbitmqConfigContents, /^listeners\.tcp\.default = 5672$/m);
  assert.deepEqual(
    rabbitmqConfigContents.match(/^vm_memory_calculation_strategy\s*=.*$/gm),
    ['vm_memory_calculation_strategy = erlang'],
  );
});
