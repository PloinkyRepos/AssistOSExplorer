import assert from 'node:assert/strict';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  prepareSupportServiceRuntime,
} from '../scripts/prepare-support-service-runtime.mjs';

const TEST_IDENTITIES = Object.freeze({
  rootUid: process.getuid(),
  postgresUid: process.getuid(),
  postgresGid: process.getgid(),
  logGid: process.getgid(),
  sslCertGid: process.getgid(),
  rabbitmqUid: process.getuid(),
  rabbitmqGid: process.getgid(),
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-postgresql-runtime-'));
  const configDirectory = path.join(root, 'etc/postgresql/16/main');
  const configFile = path.join(configDirectory, 'postgresql.conf');
  const logDirectory = path.join(root, 'var/log/postgresql');
  const logFile = path.join(logDirectory, 'postgresql-16-main.log');
  const runtimeDirectory = path.join(root, 'var/run/postgresql');
  const sslPrivateDirectory = path.join(root, 'etc/ssl/private');
  const sslPrivateKeyFile = path.join(sslPrivateDirectory, 'ssl-cert-snakeoil.key');
  const rabbitmqLogDirectory = path.join(root, 'var/log/rabbitmq');
  const rabbitmqServiceLogFiles = [
    'startup_log',
    'startup_err',
    'shutdown_log',
    'shutdown_err',
  ].map((name) => path.join(rabbitmqLogDirectory, name));
  const unrelatedFile = path.join(logDirectory, 'unrelated.log');
  const unrelatedRabbitmqLog = path.join(rabbitmqLogDirectory, 'rabbit@build.log');

  await Promise.all([
    mkdir(configDirectory, { recursive: true }),
    mkdir(logDirectory, { recursive: true }),
    mkdir(runtimeDirectory, { recursive: true }),
    mkdir(sslPrivateDirectory, { recursive: true }),
    mkdir(rabbitmqLogDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(configFile, 'listen_addresses = 127.0.0.1\n', { mode: 0o600 }),
    writeFile(path.join(configDirectory, 'pg_hba.conf'), 'local all all trust\n', { mode: 0o600 }),
    writeFile(path.join(configDirectory, 'pg_ident.conf'), '# map\n', { mode: 0o600 }),
    writeFile(logFile, '', { mode: 0o600 }),
    writeFile(unrelatedFile, 'sentinel\n', { mode: 0o604 }),
    writeFile(sslPrivateKeyFile, 'private key fixture\n', { mode: 0o600 }),
    ...rabbitmqServiceLogFiles.map(
      (targetPath) => writeFile(targetPath, '', { mode: 0o600 }),
    ),
    writeFile(unrelatedRabbitmqLog, 'sentinel\n', { mode: 0o604 }),
  ]);
  await Promise.all([
    chmod(logDirectory, 0o700),
    chmod(runtimeDirectory, 0o700),
    chmod(sslPrivateDirectory, 0o700),
    chmod(rabbitmqLogDirectory, 0o700),
  ]);

  return {
    root,
    configDirectory,
    configFile,
    logDirectory,
    logFile,
    runtimeDirectory,
    sslPrivateDirectory,
    sslPrivateKeyFile,
    rabbitmqLogDirectory,
    rabbitmqServiceLogFiles,
    unrelatedFile,
    unrelatedRabbitmqLog,
  };
}

async function contractSnapshot(value) {
  const namedPaths = {
    postgresql: value.configFile,
    hba: path.join(value.configDirectory, 'pg_hba.conf'),
    ident: path.join(value.configDirectory, 'pg_ident.conf'),
    logDirectory: value.logDirectory,
    logFile: value.logFile,
    runtimeDirectory: value.runtimeDirectory,
    sslPrivateDirectory: value.sslPrivateDirectory,
    sslPrivateKeyFile: value.sslPrivateKeyFile,
    rabbitmqLogDirectory: value.rabbitmqLogDirectory,
    ...Object.fromEntries(value.rabbitmqServiceLogFiles.map(
      (targetPath) => [`rabbitmq:${path.basename(targetPath)}`, targetPath],
    )),
    unrelatedFile: value.unrelatedFile,
    unrelatedRabbitmqLog: value.unrelatedRabbitmqLog,
  };
  return Object.fromEntries(await Promise.all(
    Object.entries(namedPaths).map(async ([name, targetPath]) => {
      const stat = await lstat(targetPath);
      return [name, {
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid,
        gid: stat.gid,
        mode: stat.mode & 0o7777,
        bytes: stat.isFile() ? await readFile(targetPath, 'utf8') : null,
      }];
    }),
  ));
}

function prepare(value) {
  return prepareSupportServiceRuntime({
    configFile: value.configFile,
    logDirectory: value.logDirectory,
    runtimeDirectory: value.runtimeDirectory,
    sslPrivateDirectory: value.sslPrivateDirectory,
    sslPrivateKeyFile: value.sslPrivateKeyFile,
    rabbitmqLogDirectory: value.rabbitmqLogDirectory,
    identities: TEST_IDENTITIES,
  });
}

test('support-service preparation repairs only the exact package runtime contract', async () => {
  const value = await fixture();
  try {
    const before = await contractSnapshot(value);
    const result = prepare(value);
    const snapshot = await contractSnapshot(value);

    assert.deepEqual(result, {
      configFiles: [
        value.configFile,
        path.join(value.configDirectory, 'pg_hba.conf'),
        path.join(value.configDirectory, 'pg_ident.conf'),
      ],
      logDirectory: value.logDirectory,
      logFile: value.logFile,
      runtimeDirectory: value.runtimeDirectory,
      sslPrivateDirectory: value.sslPrivateDirectory,
      sslPrivateKeyFile: value.sslPrivateKeyFile,
      rabbitmqLogDirectory: value.rabbitmqLogDirectory,
      rabbitmqServiceLogFiles: value.rabbitmqServiceLogFiles,
    });
    assert.equal(snapshot.postgresql.mode, 0o644);
    assert.equal(snapshot.hba.mode, 0o640);
    assert.equal(snapshot.ident.mode, 0o640);
    assert.equal(snapshot.logDirectory.mode, 0o1775);
    assert.equal(snapshot.logFile.mode, 0o640);
    assert.equal(snapshot.runtimeDirectory.mode, 0o2775);
    assert.equal(snapshot.sslPrivateDirectory.mode, 0o710);
    assert.equal(snapshot.sslPrivateKeyFile.mode, 0o640);
    assert.equal(snapshot.rabbitmqLogDirectory.mode, 0o755);
    for (const name of Object.keys(snapshot).filter((name) => name.startsWith('rabbitmq:'))) {
      assert.equal(snapshot[name].mode, 0o644);
      assert.equal(snapshot[name].uid, TEST_IDENTITIES.rabbitmqUid);
      assert.equal(snapshot[name].gid, TEST_IDENTITIES.rabbitmqGid);
    }
    for (const name of ['postgresql', 'hba', 'ident', 'logFile', 'runtimeDirectory']) {
      assert.equal(snapshot[name].uid, TEST_IDENTITIES.postgresUid);
      assert.equal(snapshot[name].gid, name === 'logFile'
        ? TEST_IDENTITIES.logGid
        : TEST_IDENTITIES.postgresGid);
    }
    assert.equal(snapshot.logDirectory.uid, TEST_IDENTITIES.rootUid);
    assert.equal(snapshot.logDirectory.gid, TEST_IDENTITIES.postgresGid);
    assert.equal(snapshot.sslPrivateDirectory.uid, TEST_IDENTITIES.rootUid);
    assert.equal(snapshot.sslPrivateDirectory.gid, TEST_IDENTITIES.sslCertGid);
    assert.equal(snapshot.sslPrivateKeyFile.uid, TEST_IDENTITIES.rootUid);
    assert.equal(snapshot.sslPrivateKeyFile.gid, TEST_IDENTITIES.sslCertGid);
    assert.equal(snapshot.rabbitmqLogDirectory.uid, TEST_IDENTITIES.rabbitmqUid);
    assert.equal(snapshot.rabbitmqLogDirectory.gid, TEST_IDENTITIES.rabbitmqGid);
    assert.deepEqual(snapshot.unrelatedFile, before.unrelatedFile);
    assert.deepEqual(snapshot.unrelatedRabbitmqLog, before.unrelatedRabbitmqLog);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation is idempotent and preserves inode identities', async () => {
  const value = await fixture();
  try {
    prepare(value);
    const first = await contractSnapshot(value);
    prepare(value);
    assert.deepEqual(await contractSnapshot(value), first);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation creates missing exact log and runtime targets', async () => {
  const value = await fixture();
  try {
    await Promise.all([
      rm(value.logDirectory, { recursive: true }),
      rm(value.runtimeDirectory, { recursive: true }),
      ...value.rabbitmqServiceLogFiles.map((targetPath) => rm(targetPath)),
    ]);

    prepare(value);

    const [logDirectory, logFile, runtimeDirectory, ...rabbitmqServiceLogs] = await Promise.all([
      lstat(value.logDirectory),
      lstat(value.logFile),
      lstat(value.runtimeDirectory),
      ...value.rabbitmqServiceLogFiles.map((targetPath) => lstat(targetPath)),
    ]);
    assert.equal(logDirectory.isDirectory(), true);
    assert.equal(logDirectory.mode & 0o7777, 0o1775);
    assert.equal(logFile.isFile(), true);
    assert.equal(logFile.nlink, 1);
    assert.equal(logFile.mode & 0o7777, 0o640);
    assert.equal(runtimeDirectory.isDirectory(), true);
    assert.equal(runtimeDirectory.mode & 0o7777, 0o2775);
    for (const serviceLog of rabbitmqServiceLogs) {
      assert.equal(serviceLog.isFile(), true);
      assert.equal(serviceLog.nlink, 1);
      assert.equal(serviceLog.mode & 0o7777, 0o644);
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation rejects an unsafe config symlink before mutation', async () => {
  const value = await fixture();
  try {
    const hbaPath = path.join(value.configDirectory, 'pg_hba.conf');
    const externalPath = path.join(value.root, 'external-hba.conf');
    await writeFile(externalPath, 'external\n', { mode: 0o600 });
    await rm(hbaPath);
    await symlink(externalPath, hbaPath);
    const beforePostgresql = await lstat(value.configFile);

    assert.throws(() => prepare(value), /must not be a symbolic link/);

    const afterPostgresql = await lstat(value.configFile);
    assert.equal(afterPostgresql.mode & 0o7777, beforePostgresql.mode & 0o7777);
    assert.equal(await readFile(externalPath, 'utf8'), 'external\n');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation rejects a hard-linked log before mutation', async () => {
  const value = await fixture();
  try {
    const secondLink = path.join(value.root, 'linked-postgresql.log');
    await link(value.logFile, secondLink);
    const beforePostgresql = await lstat(value.configFile);

    assert.throws(() => prepare(value), /must have exactly one hard link/);

    const afterPostgresql = await lstat(value.configFile);
    assert.equal(afterPostgresql.mode & 0o7777, beforePostgresql.mode & 0o7777);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation rejects an unsafe PostgreSQL TLS key before mutation', async () => {
  const value = await fixture();
  try {
    const externalPath = path.join(value.root, 'external-private.key');
    await writeFile(externalPath, 'external\n', { mode: 0o600 });
    await rm(value.sslPrivateKeyFile);
    await symlink(externalPath, value.sslPrivateKeyFile);
    const beforePostgresql = await lstat(value.configFile);

    assert.throws(() => prepare(value), /must not be a symbolic link/);

    const afterPostgresql = await lstat(value.configFile);
    assert.equal(afterPostgresql.mode & 0o7777, beforePostgresql.mode & 0o7777);
    assert.equal(await readFile(externalPath, 'utf8'), 'external\n');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('support-service preparation rejects a hard-linked RabbitMQ service log before mutation', async () => {
  const value = await fixture();
  try {
    const secondLink = path.join(value.root, 'linked-rabbitmq-startup.log');
    await link(value.rabbitmqServiceLogFiles[0], secondLink);
    const beforePostgresql = await lstat(value.configFile);

    assert.throws(() => prepare(value), /must have exactly one hard link/);

    const afterPostgresql = await lstat(value.configFile);
    assert.equal(afterPostgresql.mode & 0o7777, beforePostgresql.mode & 0o7777);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
