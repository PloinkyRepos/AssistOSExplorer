import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureDocServiceNginxLoopback,
  verifyDocServiceNginxLoopback,
} from '../scripts/configure-docservice-nginx-loopback.mjs';

const SOURCE_DIRECTIVE = '  server localhost:8000 max_fails=0 fail_timeout=0s;';
const TARGET_DIRECTIVE = '  server [::1]:8000 max_fails=0 fail_timeout=0s;';

async function fixture(contents = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-docservice-loopback-'));
  const first = path.join(root, 'documentserver-http-common.conf');
  const second = path.join(root, 'nginx-http-common.conf');
  const content = contents ?? [
    'upstream docservice {',
    SOURCE_DIRECTIVE,
    '}',
    '',
  ].join('\r\n');
  await Promise.all([
    writeFile(first, content),
    writeFile(second, content),
  ]);
  return { root, paths: [first, second] };
}

test('DocService nginx configuration replaces the exact pinned upstream in both config trees', async () => {
  const value = await fixture();
  try {
    configureDocServiceNginxLoopback(value.paths);
    assert.doesNotThrow(() => verifyDocServiceNginxLoopback(value.paths));
    for (const configPath of value.paths) {
      const content = await readFile(configPath, 'utf8');
      assert.equal(content.includes(SOURCE_DIRECTIVE), false);
      assert.equal(content.split(TARGET_DIRECTIVE).length - 1, 1);
      assert.match(content, /\r\n/);
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

for (const [name, content] of [
  ['missing', 'upstream docservice {\r\n}\r\n'],
  ['duplicate', `upstream docservice {\r\n${SOURCE_DIRECTIVE}\r\n${SOURCE_DIRECTIVE}\r\n}\r\n`],
  ['unexpected', 'upstream docservice {\r\n  server 127.0.0.1:8000 max_fails=0 fail_timeout=0s;\r\n}\r\n'],
]) {
  test(`DocService nginx configuration rejects the ${name} pinned upstream before mutating either file`, async () => {
    const value = await fixture();
    try {
      await writeFile(value.paths[1], content);
      const originalFirst = await readFile(value.paths[0], 'utf8');
      assert.throws(
        () => configureDocServiceNginxLoopback(value.paths),
        /must contain exactly one pinned/,
      );
      assert.equal(await readFile(value.paths[0], 'utf8'), originalFirst);
      assert.equal(await readFile(value.paths[1], 'utf8'), content);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
}
