import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  rewriteNginxListenerLoopback,
} from '../scripts/rewrite-nginx-listener-loopback.mjs';

function identity(target) {
  const stat = fs.statSync(target);
  return {
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode & 0o7777,
  };
}

test('nginx listener rewrite preserves regular and dereferenced-alias identities', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-nginx-listener-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const canonical = path.join(root, 'canonical.conf');
  const alias = path.join(root, 'alias.conf');
  fs.writeFileSync(canonical, [
    'server {',
    '  listen 0.0.0.0:80 default_server;',
    '  listen [::]:443 ssl;',
    '}',
    '',
  ].join('\n'), { mode: 0o640 });
  fs.chmodSync(canonical, 0o640);
  fs.symlinkSync(path.basename(canonical), alias);
  const targetIdentity = identity(canonical);

  rewriteNginxListenerLoopback(alias, { randomSuffix: 'alias' });
  rewriteNginxListenerLoopback(canonical, { randomSuffix: 'canonical' });

  assert.equal(fs.lstatSync(alias).isSymbolicLink(), false);
  for (const target of [canonical, alias]) {
    assert.deepEqual(identity(target), targetIdentity);
    const contents = fs.readFileSync(target, 'utf8');
    assert.match(contents, /listen 127\.0\.0\.1:80 default_server;/);
    assert.match(contents, /listen \[::1\]:443 ssl;/);
    assert.doesNotMatch(contents, /listen (?:0\.0\.0\.0:|\[::\]:)/);
  }

  const before = fs.readFileSync(alias);
  rewriteNginxListenerLoopback(alias, { randomSuffix: 'idempotent' });
  assert.deepEqual(fs.readFileSync(alias), before);
  assert.deepEqual(identity(alias), targetIdentity);
});

test('nginx listener rewrite rejects relative and non-file targets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-nginx-listener-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => rewriteNginxListenerLoopback('relative.conf'), /must be absolute/);
  assert.throws(() => rewriteNginxListenerLoopback(root), /neither a regular file/);
});
