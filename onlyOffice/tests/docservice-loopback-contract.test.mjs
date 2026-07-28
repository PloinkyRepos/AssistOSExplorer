import assert from 'node:assert/strict';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
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
  verifyDocServiceNginxRuntime,
} from '../scripts/configure-docservice-nginx-loopback.mjs';

const SOURCE_DIRECTIVE = '  server localhost:8000 max_fails=0 fail_timeout=0s;';
const TARGET_DIRECTIVE = '  server [::1]:8000 max_fails=0 fail_timeout=0s;';
const PINNED_ALIAS_TARGET = '../../onlyoffice/documentserver/nginx/includes/http-common.conf';
const TEST_RUNTIME_IDENTITY = Object.freeze({
  uid: process.getuid(),
  gid: process.getgid(),
  mode: 0o644,
});

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
  const [canonicalStat, aliasStat] = await Promise.all([
    lstat(value.paths.canonicalPath),
    lstat(value.paths.aliasPath),
  ]);
  return {
    canonical: await readFile(value.paths.canonicalPath),
    canonicalIsSymbolicLink: canonicalStat.isSymbolicLink(),
    canonicalTarget: canonicalStat.isSymbolicLink()
      ? await readlink(value.paths.canonicalPath)
      : null,
    canonicalIdentity: {
      dev: canonicalStat.dev,
      ino: canonicalStat.ino,
      mode: canonicalStat.mode & 0o7777,
      uid: canonicalStat.uid,
      gid: canonicalStat.gid,
    },
    aliasIsSymbolicLink: aliasStat.isSymbolicLink(),
    aliasTarget: aliasStat.isSymbolicLink() ? await readlink(value.paths.aliasPath) : null,
    aliasBytes: aliasStat.isSymbolicLink() ? null : await readFile(value.paths.aliasPath),
    aliasIdentity: {
      dev: aliasStat.dev,
      ino: aliasStat.ino,
      mode: aliasStat.mode & 0o7777,
      uid: aliasStat.uid,
      gid: aliasStat.gid,
    },
  };
}

async function materializeRuntimeCopy(value) {
  const canonical = await readFile(value.paths.canonicalPath);
  await rm(value.paths.aliasPath);
  await writeFile(value.paths.aliasPath, canonical);
  await Promise.all([
    chmod(value.paths.canonicalPath, 0o644),
    chmod(value.paths.aliasPath, 0o644),
  ]);
}

async function runtimeFixture(contents = TARGET_DIRECTIVE) {
  const value = await fixture([
    'upstream docservice {',
    contents,
    '}',
    '',
  ].join('\r\n'));
  await materializeRuntimeCopy(value);
  return value;
}

test('DocService nginx configuration replaces the canonical upstream through its exact alias', async () => {
  const value = await fixture();
  try {
    configureDocServiceNginxLoopback(value.paths);
    const beforeVerify = await snapshot(value);
    assert.doesNotThrow(() => verifyDocServiceNginxLoopback(value.paths));
    assert.deepEqual(await snapshot(value), beforeVerify);
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

test('DocService runtime verification accepts the exact materialized nginx copy', async () => {
  const value = await fixture();
  try {
    configureDocServiceNginxLoopback(value.paths);
    await materializeRuntimeCopy(value);
    const before = await snapshot(value);

    assert.doesNotThrow(() => {
      verifyDocServiceNginxRuntime(value.paths, TEST_RUNTIME_IDENTITY);
    });
    assert.deepEqual(await snapshot(value), before);
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

for (const [name, build, mutate = async () => {}] of [
  ['alias symlink', () => fixture(TARGET_DIRECTIVE)],
  ['canonical symlink', () => runtimeFixture(), async (value) => {
    const canonicalTarget = `${value.paths.canonicalPath}.runtime`;
    await rename(value.paths.canonicalPath, canonicalTarget);
    await symlink(path.basename(canonicalTarget), value.paths.canonicalPath);
  }],
  ['same physical file', () => runtimeFixture(), async (value) => {
    await rm(value.paths.aliasPath);
    await link(value.paths.canonicalPath, value.paths.aliasPath);
  }],
  ['byte drift', () => runtimeFixture(), async (value) => {
    await writeFile(value.paths.aliasPath, `${await readFile(value.paths.aliasPath, 'utf8')}\r\n`);
  }],
  ['source directive', () => runtimeFixture(SOURCE_DIRECTIVE)],
  ['missing directive', () => runtimeFixture('')],
  ['duplicate directive', () => runtimeFixture(`${TARGET_DIRECTIVE}\r\n${TARGET_DIRECTIVE}`)],
  ['unexpected directive', () => runtimeFixture('  server 127.0.0.1:8000 max_fails=0 fail_timeout=0s;')],
  ['mode drift', () => runtimeFixture(), async (value) => {
    await chmod(value.paths.aliasPath, 0o600);
  }],
]) {
  test(`DocService runtime verification rejects ${name} without mutation`, async () => {
    const value = await build();
    try {
      await mutate(value);
      const before = await snapshot(value);
      assert.throws(
        () => verifyDocServiceNginxRuntime(value.paths, TEST_RUNTIME_IDENTITY),
        /OnlyOffice DocService/,
      );
      assert.deepEqual(await snapshot(value), before);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
}

test('DocService runtime verification rejects ownership drift without mutation', async () => {
  const value = await runtimeFixture();
  try {
    const before = await snapshot(value);
    assert.throws(
      () => verifyDocServiceNginxRuntime(value.paths, {
        ...TEST_RUNTIME_IDENTITY,
        uid: TEST_RUNTIME_IDENTITY.uid + 1,
      }),
      /unexpected ownership or mode/,
    );
    assert.deepEqual(await snapshot(value), before);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
