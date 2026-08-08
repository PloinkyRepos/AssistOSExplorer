import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error(`OnlyOffice nginx listener rewrite failed: ${message}`);
}

function rewriteListenerBytes(contents) {
  return String(contents)
    .replace(
      /^([\t ]*)listen[\t ]+(?:0\.0\.0\.0:)?(80|443)([\t ][^;]*)?;/gm,
      (_match, indent, port, suffix = '') => `${indent}listen 127.0.0.1:${port}${suffix};`,
    )
    .replace(
      /^([\t ]*)listen[\t ]+\[::\]:(80|443)([\t ][^;]*)?;/gm,
      (_match, indent, port, suffix = '') => `${indent}listen [::1]:${port}${suffix};`,
    );
}

export function rewriteNginxListenerLoopback(configPath, {
  fsImpl = fs,
  randomSuffix = `${process.pid}.${Date.now()}`,
} = {}) {
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath)) {
    fail('configuration path must be absolute.');
  }
  const linkStat = fsImpl.lstatSync(configPath);
  if (!linkStat.isFile() && !linkStat.isSymbolicLink()) {
    fail(`${configPath} is neither a regular file nor a symbolic-link alias.`);
  }
  const targetStat = fsImpl.statSync(configPath);
  if (!targetStat.isFile()) fail(`${configPath} does not resolve to a regular file.`);

  const rewritten = rewriteListenerBytes(fsImpl.readFileSync(configPath, 'utf8'));
  const temporary = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.ploinky-loopback.${randomSuffix}`,
  );
  let descriptor;
  try {
    descriptor = fsImpl.openSync(
      temporary,
      fsImpl.constants.O_WRONLY | fsImpl.constants.O_CREAT | fsImpl.constants.O_EXCL,
      targetStat.mode & 0o7777,
    );
    fsImpl.writeFileSync(descriptor, rewritten, 'utf8');
    fsImpl.fchownSync(descriptor, targetStat.uid, targetStat.gid);
    fsImpl.fchmodSync(descriptor, targetStat.mode & 0o7777);
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    fsImpl.renameSync(temporary, configPath);
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    try {
      fsImpl.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const result = fsImpl.statSync(configPath);
  if (!result.isFile()
      || result.uid !== targetStat.uid
      || result.gid !== targetStat.gid
      || (result.mode & 0o7777) !== (targetStat.mode & 0o7777)) {
    fail(`${configPath} did not retain its dereferenced target identity.`);
  }
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const targets = process.argv.slice(2);
  if (!targets.length) fail('at least one configuration path is required.');
  for (const target of targets) rewriteNginxListenerLoopback(target);
}
