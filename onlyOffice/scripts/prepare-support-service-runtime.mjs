#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PINNED_CONFIG_FILES = Object.freeze([
  Object.freeze({ name: 'postgresql.conf', mode: 0o644 }),
  Object.freeze({ name: 'pg_hba.conf', mode: 0o640 }),
  Object.freeze({ name: 'pg_ident.conf', mode: 0o640 }),
]);
const PINNED_RABBITMQ_SERVICE_LOGS = Object.freeze([
  'startup_log',
  'startup_err',
  'shutdown_log',
  'shutdown_err',
]);

function fail(message) {
  throw new Error(`OnlyOffice support-service runtime contract failed: ${message}`);
}

function assertNumericIdentity(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a non-negative integer.`);
  }
}

function assertMode(name, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0o7777) {
    fail(`${name} has an invalid mode.`);
  }
}

function lstatIfPresent(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function openFlags(type) {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow)) {
    fail('O_NOFOLLOW is unavailable.');
  }
  if (type === 'directory') {
    const directory = fs.constants.O_DIRECTORY;
    if (!Number.isInteger(directory)) {
      fail('O_DIRECTORY is unavailable.');
    }
    return fs.constants.O_RDONLY | noFollow | directory;
  }
  return fs.constants.O_RDONLY | noFollow;
}

function assertDescriptorShape(targetPath, descriptor, type) {
  const stat = fs.fstatSync(descriptor);
  const validType = type === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!validType) {
    fail(`${targetPath} is not a ${type}.`);
  }
  if (type === 'file' && stat.nlink !== 1) {
    fail(`${targetPath} must have exactly one hard link.`);
  }
  return stat;
}

function preflightPath(targetPath, type, { allowMissing = false } = {}) {
  const stat = lstatIfPresent(targetPath);
  if (!stat) {
    if (allowMissing) {
      return false;
    }
    fail(`${targetPath} is missing.`);
  }
  if (stat.isSymbolicLink()) {
    fail(`${targetPath} must not be a symbolic link.`);
  }
  const validType = type === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!validType) {
    fail(`${targetPath} is not a ${type}.`);
  }

  const descriptor = fs.openSync(targetPath, openFlags(type));
  try {
    assertDescriptorShape(targetPath, descriptor, type);
  } finally {
    fs.closeSync(descriptor);
  }
  return true;
}

function verifyDescriptorContract(targetPath, descriptor, {
  type,
  uid,
  gid,
  mode,
}) {
  const stat = assertDescriptorShape(targetPath, descriptor, type);
  if (
    stat.uid !== uid
    || stat.gid !== gid
    || (stat.mode & 0o7777) !== mode
  ) {
    fail(`${targetPath} has unexpected ownership or mode after preparation.`);
  }
}

function normalizeOpenPath(targetPath, contract) {
  const descriptor = fs.openSync(targetPath, openFlags(contract.type));
  try {
    const stat = assertDescriptorShape(targetPath, descriptor, contract.type);
    if (stat.uid !== contract.uid || stat.gid !== contract.gid) {
      fs.fchownSync(descriptor, contract.uid, contract.gid);
    }
    if ((stat.mode & 0o7777) !== contract.mode) {
      fs.fchmodSync(descriptor, contract.mode);
    }
    verifyDescriptorContract(targetPath, descriptor, contract);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDirectory(targetPath, contract) {
  if (!lstatIfPresent(targetPath)) {
    fs.mkdirSync(targetPath, { mode: contract.mode });
  }
  normalizeOpenPath(targetPath, { ...contract, type: 'directory' });
}

function ensureRegularFile(targetPath, contract) {
  if (!lstatIfPresent(targetPath)) {
    const descriptor = fs.openSync(
      targetPath,
      fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | fs.constants.O_WRONLY
        | fs.constants.O_NOFOLLOW,
      contract.mode,
    );
    fs.closeSync(descriptor);
  }
  normalizeOpenPath(targetPath, { ...contract, type: 'file' });
}

function pinnedClusterPaths(configFile, logDirectory) {
  if (typeof configFile !== 'string' || !path.isAbsolute(configFile)) {
    fail('the PostgreSQL configuration path must be absolute.');
  }
  if (path.basename(configFile) !== 'postgresql.conf') {
    fail('the PostgreSQL configuration path must end in postgresql.conf.');
  }

  const configDirectory = path.dirname(configFile);
  const cluster = path.basename(configDirectory);
  const version = path.basename(path.dirname(configDirectory));
  const safeSegment = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  if (!safeSegment.test(version) || !safeSegment.test(cluster)) {
    fail('the PostgreSQL version or cluster name is invalid.');
  }

  return {
    configFiles: PINNED_CONFIG_FILES.map(({ name, mode }) => ({
      path: path.join(configDirectory, name),
      mode,
    })),
    logFile: path.join(logDirectory, `postgresql-${version}-${cluster}.log`),
  };
}

export function prepareSupportServiceRuntime({
  configFile,
  logDirectory = '/var/log/postgresql',
  runtimeDirectory = '/var/run/postgresql',
  sslPrivateDirectory = '/etc/ssl/private',
  sslPrivateKeyFile = '/etc/ssl/private/ssl-cert-snakeoil.key',
  rabbitmqLogDirectory = '/var/log/rabbitmq',
  identities,
}) {
  if (!identities || typeof identities !== 'object') {
    fail('explicit runtime identities are required.');
  }
  const {
    rootUid,
    postgresUid,
    postgresGid,
    logGid,
    sslCertGid,
    rabbitmqUid,
    rabbitmqGid,
  } = identities;
  for (const [name, value] of Object.entries({
    rootUid,
    postgresUid,
    postgresGid,
    logGid,
    sslCertGid,
    rabbitmqUid,
    rabbitmqGid,
  })) {
    assertNumericIdentity(name, value);
  }
  for (const [name, mode] of Object.entries({
    postgresqlConfMode: 0o644,
    postgresqlAclMode: 0o640,
    logDirectoryMode: 0o1775,
    logFileMode: 0o640,
    runtimeDirectoryMode: 0o2775,
    sslPrivateDirectoryMode: 0o710,
    sslPrivateKeyMode: 0o640,
    rabbitmqLogDirectoryMode: 0o755,
    rabbitmqServiceLogMode: 0o644,
  })) {
    assertMode(name, mode);
  }
  for (const [name, targetPath] of Object.entries({
    logDirectory,
    runtimeDirectory,
    sslPrivateDirectory,
    sslPrivateKeyFile,
    rabbitmqLogDirectory,
  })) {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
      fail(`${name} must be an absolute path.`);
    }
  }
  if (path.dirname(sslPrivateKeyFile) !== sslPrivateDirectory) {
    fail('the PostgreSQL private key must be an immediate child of its guarded directory.');
  }

  const paths = pinnedClusterPaths(configFile, logDirectory);
  const rabbitmqServiceLogFiles = PINNED_RABBITMQ_SERVICE_LOGS.map(
    (name) => path.join(rabbitmqLogDirectory, name),
  );

  // Validate every existing target before changing any of them. Subsequent
  // descriptor operations repeat the no-follow/type checks to close the
  // mutation window around each exact path.
  for (const entry of paths.configFiles) {
    preflightPath(entry.path, 'file');
  }
  const logDirectoryExists = preflightPath(
    logDirectory,
    'directory',
    { allowMissing: true },
  );
  if (logDirectoryExists) {
    preflightPath(paths.logFile, 'file', { allowMissing: true });
  }
  preflightPath(runtimeDirectory, 'directory', { allowMissing: true });
  preflightPath(sslPrivateDirectory, 'directory');
  preflightPath(sslPrivateKeyFile, 'file');
  preflightPath(rabbitmqLogDirectory, 'directory');
  for (const serviceLogFile of rabbitmqServiceLogFiles) {
    preflightPath(serviceLogFile, 'file', { allowMissing: true });
  }

  for (const entry of paths.configFiles) {
    normalizeOpenPath(entry.path, {
      type: 'file',
      uid: postgresUid,
      gid: postgresGid,
      mode: entry.mode,
    });
  }
  ensureDirectory(logDirectory, {
    uid: rootUid,
    gid: postgresGid,
    mode: 0o1775,
  });
  ensureRegularFile(paths.logFile, {
    uid: postgresUid,
    gid: logGid,
    mode: 0o640,
  });
  ensureDirectory(runtimeDirectory, {
    uid: postgresUid,
    gid: postgresGid,
    mode: 0o2775,
  });
  normalizeOpenPath(sslPrivateDirectory, {
    type: 'directory',
    uid: rootUid,
    gid: sslCertGid,
    mode: 0o710,
  });
  normalizeOpenPath(sslPrivateKeyFile, {
    type: 'file',
    uid: rootUid,
    gid: sslCertGid,
    mode: 0o640,
  });
  normalizeOpenPath(rabbitmqLogDirectory, {
    type: 'directory',
    uid: rabbitmqUid,
    gid: rabbitmqGid,
    mode: 0o755,
  });
  for (const serviceLogFile of rabbitmqServiceLogFiles) {
    ensureRegularFile(serviceLogFile, {
      uid: rabbitmqUid,
      gid: rabbitmqGid,
      mode: 0o644,
    });
  }

  return Object.freeze({
    configFiles: Object.freeze(paths.configFiles.map((entry) => entry.path)),
    logDirectory,
    logFile: paths.logFile,
    runtimeDirectory,
    sslPrivateDirectory,
    sslPrivateKeyFile,
    rabbitmqLogDirectory,
    rabbitmqServiceLogFiles: Object.freeze(rabbitmqServiceLogFiles),
  });
}

function numericCommandOutput(command, args, description) {
  let output;
  try {
    output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    fail(`could not resolve ${description}.`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(output)) {
    fail(`${description} is not numeric.`);
  }
  const value = Number(output);
  assertNumericIdentity(description, value);
  return value;
}

function numericGroupId(groupName) {
  const groupRecord = (() => {
    try {
      return execFileSync('getent', ['group', groupName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      fail(`could not resolve the ${groupName} group.`);
    }
  })();
  const groupFields = groupRecord.split(':');
  if (
    groupFields.length < 3
    || groupFields[0] !== groupName
    || !/^(0|[1-9][0-9]*)$/.test(groupFields[2])
  ) {
    fail(`the ${groupName} group record is invalid.`);
  }
  const gid = Number(groupFields[2]);
  assertNumericIdentity(`${groupName} gid`, gid);
  return gid;
}

function systemIdentities() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    fail('preparation must run as root.');
  }
  return {
    rootUid: process.getuid(),
    postgresUid: numericCommandOutput('id', ['-u', 'postgres'], 'postgres uid'),
    postgresGid: numericCommandOutput('id', ['-g', 'postgres'], 'postgres gid'),
    logGid: numericGroupId('adm'),
    sslCertGid: numericGroupId('ssl-cert'),
    rabbitmqUid: numericCommandOutput('id', ['-u', 'rabbitmq'], 'rabbitmq uid'),
    rabbitmqGid: numericCommandOutput('id', ['-g', 'rabbitmq'], 'rabbitmq gid'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fail('usage: prepare-support-service-runtime.mjs /absolute/path/to/postgresql.conf');
  }
  prepareSupportServiceRuntime({
    configFile: args[0],
    identities: systemIdentities(),
  });
}
