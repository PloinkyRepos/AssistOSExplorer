import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureDocServiceNginxLoopback,
  verifyDocServiceNginxLoopback,
} from '../scripts/configure-docservice-nginx-loopback.mjs';

const SOURCE_DIRECTIVE = '  server localhost:8000 max_fails=0 fail_timeout=0s;';
const TARGET_DIRECTIVE = '  server [::1]:8000 max_fails=0 fail_timeout=0s;';
const PINNED_ALIAS_TARGET = '../../onlyoffice/documentserver/nginx/includes/http-common.conf';

async function fixture(contents = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-docservice-loopback-'));
  const canonicalPath = path.join(
    root,
    'etc/onlyoffice/documentserver/nginx/includes/http-common.conf',
  );
  const aliasPath = path.join(root, 'etc/nginx/includes/http-common.conf');
  const content = contents ?? [
    'upstream docservice {',
    SOURCE_DIRECTIVE,
    '}',
    '',
  ].join('\r\n');
  await Promise.all([
    mkdir(path.dirname(canonicalPath), { recursive: true }),
    mkdir(path.dirname(aliasPath), { recursive: true }),
  ]);
  await writeFile(canonicalPath, content);
  await symlink(PINNED_ALIAS_TARGET, aliasPath);
  return {
    root,
    paths: { canonicalPath, aliasPath },
  };
}

async function snapshot(value) {
  const aliasStat = await lstat(value.paths.aliasPath);
  return {
    canonical: await readFile(value.paths.canonicalPath),
    aliasIsSymbolicLink: aliasStat.isSymbolicLink(),
    aliasTarget: aliasStat.isSymbolicLink() ? await readlink(value.paths.aliasPath) : null,
    aliasBytes: aliasStat.isSymbolicLink() ? null : await readFile(value.paths.aliasPath),
  };
}

test('DocService nginx configuration replaces the canonical upstream through its exact alias', async () => {
  const value = await fixture();
  try {
    configureDocServiceNginxLoopback(value.paths);
    assert.doesNotThrow(() => verifyDocServiceNginxLoopback(value.paths));
    assert.equal(await readlink(value.paths.aliasPath), PINNED_ALIAS_TARGET);
    for (const configPath of [value.paths.canonicalPath, value.paths.aliasPath]) {
      const content = await readFile(configPath, 'utf8');
      assert.equal(content.includes(SOURCE_DIRECTIVE), false);
      assert.equal(content.split(TARGET_DIRECTIVE).length - 1, 1);
      assert.match(content, /\r\n/);
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

for (const [name, mutate] of [
  ['wrong alias target', async (value) => {
    await rm(value.paths.aliasPath);
    await symlink(value.paths.canonicalPath, value.paths.aliasPath);
  }],
  ['regular alias', async (value) => {
    await rm(value.paths.aliasPath);
    await writeFile(value.paths.aliasPath, await readFile(value.paths.canonicalPath));
  }],
  ['missing directive', async (value) => {
    await writeFile(value.paths.canonicalPath, 'upstream docservice {\r\n}\r\n');
  }],
  ['duplicate directive', async (value) => {
    await writeFile(
      value.paths.canonicalPath,
      `upstream docservice {\r\n${SOURCE_DIRECTIVE}\r\n${SOURCE_DIRECTIVE}\r\n}\r\n`,
    );
  }],
  ['unexpected directive', async (value) => {
    await writeFile(
      value.paths.canonicalPath,
      'upstream docservice {\r\n  server 127.0.0.1:8000 max_fails=0 fail_timeout=0s;\r\n}\r\n',
    );
  }],
]) {
  test(`DocService nginx configuration rejects the ${name} before mutation`, async () => {
    const value = await fixture();
    try {
      await mutate(value);
      const before = await snapshot(value);
      assert.throws(
        () => configureDocServiceNginxLoopback(value.paths),
        /OnlyOffice DocService nginx/,
      );
      assert.deepEqual(await snapshot(value), before);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
}
