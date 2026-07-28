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
  const configureV5 = path.join(tempDir, 'configure-v5.sh');
  const configureSupportListeners = path.join(tempDir, 'configure-support-listeners.sh');

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
    '#start needed local services',
    'for i in "${LOCAL_SERVICES[@]}"; do',
    '  service $i start',
    'done',
    'service supervisor start',
  ].join('\n'), { mode: 0o755 });
  await writeFile(configureV5, [
    '#!/bin/bash',
    'echo "configure v5"',
  ].join('\n'), { mode: 0o755 });
  await writeFile(configureSupportListeners, [
    '#!/bin/bash',
    'echo "configure support listeners"',
  ].join('\n'), { mode: 0o755 });

  const { stdout } = await execFileAsync('/bin/bash', [
    'scripts/run-document-server-with-autoassembly.sh',
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT: fakeDocumentServer,
      ONLYOFFICE_V5_CONFIGURE_SCRIPT: configureV5,
      ONLYOFFICE_SUPPORT_LISTENER_SCRIPT: configureSupportListeners,
      ONLYOFFICE_AUTO_ASSEMBLY_ENABLED: 'true',
      ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL: '2m',
      ONLYOFFICE_AUTO_ASSEMBLY_STEP: '30s',
    },
  });
  const calls = await readFile(jsonLog, 'utf8');

  assert.match(calls, /autoAssembly\.enable = true/);
  assert.match(calls, /autoAssembly\.interval = '2m'/);
  assert.match(calls, /autoAssembly\.step = '30s'/);
  assert.match(stdout, /service postgresql start/);
  assert.match(stdout, /start-stop-daemon .*--exec \/usr\/sbin\/rabbitmq-server .*--background/);
  assert.doesNotMatch(stdout, /service rabbitmq-server start/);
  assert.ok(stdout.indexOf('configure support listeners') < stdout.indexOf('service postgresql start'));
  assert.ok(stdout.indexOf('configure v5') < stdout.indexOf('service supervisor start'));
  assert.match(stdout, /configure support listeners/);
  assert.match(stdout, /service supervisor start/);
});

test('support-listener configuration hardens every bundled dependency without duplicate settings', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-support-listeners-'));
  const postgresqlConfig = path.join(tempDir, 'postgresql.conf');
  const redisConfig = path.join(tempDir, 'redis.conf');
  const rabbitmqConfig = path.join(tempDir, 'rabbitmq.conf');
  const rabbitmqEnv = path.join(tempDir, 'rabbitmq-env.conf');

  await writeFile(postgresqlConfig, [
    '#listen_addresses = localhost',
    'listen_addresses = *',
    'port = 9999',
    '',
  ].join('\n'));
  await writeFile(redisConfig, [
    '# bind 127.0.0.1',
    'bind 0.0.0.0',
    'protected-mode no',
    'port 6380',
    '',
  ].join('\n'));
  await writeFile(rabbitmqConfig, [
    'listeners.tcp.default = 5672',
    'vm_memory_calculation_strategy = rss',
    'vm_memory_calculation_strategy=allocated',
    '',
  ].join('\n'));
  await writeFile(rabbitmqEnv, [
    '#NODE_IP_ADDRESS=127.0.0.1',
    '#NODE_PORT=5672',
    '',
  ].join('\n'));

  await execFileAsync('/bin/bash', [
    'scripts/configure-support-listeners-v5.sh',
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ONLYOFFICE_POSTGRESQL_CONFIG_GLOB: postgresqlConfig,
      ONLYOFFICE_REDIS_CONFIG_FILE: redisConfig,
      ONLYOFFICE_RABBITMQ_CONFIG_FILE: rabbitmqConfig,
      ONLYOFFICE_RABBITMQ_ENV_FILE: rabbitmqEnv,
    },
  });

  const [postgresql, redis, rabbitmq, rabbitEnv] = await Promise.all([
    readFile(postgresqlConfig, 'utf8'),
    readFile(redisConfig, 'utf8'),
    readFile(rabbitmqConfig, 'utf8'),
    readFile(rabbitmqEnv, 'utf8'),
  ]);
  assert.deepEqual(postgresql.match(/^listen_addresses\s*=.*$/gm), ["listen_addresses = '127.0.0.1'"]);
  assert.deepEqual(postgresql.match(/^port\s*=.*$/gm), ['port = 5432']);
  assert.deepEqual(redis.match(/^bind\s+.*$/gm), ['bind 127.0.0.1']);
  assert.deepEqual(redis.match(/^protected-mode\s+.*$/gm), ['protected-mode yes']);
  assert.deepEqual(redis.match(/^port\s+.*$/gm), ['port 6379']);
  assert.deepEqual(rabbitmq.match(/^listeners\.tcp\.default\s*=.*$/gm), ['listeners.tcp.default = 127.0.0.1:5672']);
  assert.deepEqual(rabbitmq.match(/^distribution\.listener\.interface\s*=.*$/gm), ['distribution.listener.interface = 127.0.0.1']);
  assert.deepEqual(rabbitmq.match(/^vm_memory_calculation_strategy\s*=.*$/gm), ['vm_memory_calculation_strategy = erlang']);
  assert.deepEqual(rabbitEnv.match(/^NODE_IP_ADDRESS=.*$/gm), ['NODE_IP_ADDRESS=127.0.0.1']);
  assert.deepEqual(rabbitEnv.match(/^NODENAME=.*$/gm), ['NODENAME=rabbit@localhost']);
  assert.deepEqual(rabbitEnv.match(/^NODE_PORT=.*$/gm), ['NODE_PORT=5672']);
  assert.deepEqual(rabbitEnv.match(/^ERL_EPMD_ADDRESS=.*$/gm), ['ERL_EPMD_ADDRESS=127.0.0.1']);
});

test('configuration and readiness require the exact IPv6 DocService nginx pairing', async () => {
  const agentRoot = new URL('..', import.meta.url);
  const [configureScript, healthcheck] = await Promise.all([
    readFile(new URL('scripts/configure-document-server-v5.sh', agentRoot), 'utf8'),
    readFile(new URL('scripts/healthcheck.sh', agentRoot), 'utf8'),
  ]);

  assert.match(
    configureScript,
    /\/usr\/local\/bin\/node "\$docservice_nginx_configurator"/,
  );
  assert.match(
    healthcheck,
    /configure-docservice-nginx-loopback\.mjs --verify/,
  );
  assert.match(
    healthcheck,
    /assert_exact_docservice_listener/,
  );
  assert.match(
    healthcheck,
    /\$4 == "\[::1\]:8000"/,
  );
  assert.match(
    healthcheck,
    /assert_loopback_owner 'OnlyOffice DocService' 8000 docservice/,
  );
});
