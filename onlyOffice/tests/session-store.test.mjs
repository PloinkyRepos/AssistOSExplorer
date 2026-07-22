import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.mjs';
import { buildDocumentKey } from '../src/onlyoffice-config.mjs';
import { createSessionStore } from '../src/session-store.mjs';

function at(isoText) {
  return new Date(isoText);
}

test('config rejects missing onlyoffice jwt secret', () => {
  assert.throws(
    () => loadConfig({}),
    /ONLYOFFICE_JWT_SECRET/
  );
});

test('config fixes v5 session state under the persisted agent workdir with no override', () => {
  const config = loadConfig({
    ONLYOFFICE_JWT_SECRET: 'test-secret',
    ONLYOFFICE_SESSION_STATE_FILE: '/var/lib/onlyoffice/legacy.json',
  });
  assert.equal(config.sessionStateFile, '/root/.ploinky/state/onlyoffice-sessions-v5.json');
});

test('config keeps the OnlyOffice drain inside the generic targeted-recreate ceiling', () => {
  assert.equal(loadConfig({
    ONLYOFFICE_JWT_SECRET: 'test-secret',
    ONLYOFFICE_DRAIN_TIMEOUT_MS: '30000',
  }).drainTimeoutMs, 30_000);
  assert.throws(
    () => loadConfig({
      ONLYOFFICE_JWT_SECRET: 'test-secret',
      ONLYOFFICE_DRAIN_TIMEOUT_MS: '30001',
    }),
    /ONLYOFFICE_DRAIN_TIMEOUT_MS must be at most 30000/,
  );
});

test('config accepts only exact positive integer JWT TTLs within five minutes', () => {
  assert.equal(loadConfig({
    ONLYOFFICE_JWT_SECRET: 'test-secret',
    ONLYOFFICE_CONFIG_JWT_TTL_SECONDS: '300',
  }).configJwtTtlSeconds, 300);

  for (const value of ['0', '-1', '300junk', '300.0', '301', '31536000', '9007199254740992']) {
    assert.throws(
      () => loadConfig({
        ONLYOFFICE_JWT_SECRET: 'test-secret',
        ONLYOFFICE_CONFIG_JWT_TTL_SECONDS: value,
      }),
      /ONLYOFFICE_CONFIG_JWT_TTL_SECONDS/,
      value,
    );
  }
});

test('session store mints opaque tokens and never exposes delegation tokens in summaries', () => {
  const store = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
    idleTtlMs: 30 * 60 * 1000
  });

  const created = store.createSession({
    path: '/Confidential/My Space/report.docx',
    storageKind: 'dpu',
    storageId: 'confidential:report-1',
    fileName: 'report.docx',
    canWrite: true,
    canComment: true,
    versionKey: 'v1',
    authUser: {
      id: 'local:alice',
      username: 'alice',
      roles: ['user']
    },
    delegations: {
      dpuConfidential: {
        token: 'delegation-token-value',
        expiresAt: '2026-06-09T12:30:00.000Z'
      }
    }
  });

  assert.equal(typeof created.token, 'string');
  assert.notEqual(created.token, 'delegation-token-value');

  const stored = store.getForStorageRequest(created.token, {
    now: at('2026-06-09T12:01:00.000Z')
  });
  assert.equal(typeof stored.tokenHash, 'string');
  assert.notEqual(stored.tokenHash, created.token);

  const summary = created.publicSummary();
  assert.equal(summary.delegations, undefined);
  assert.equal(JSON.stringify(summary).includes('delegation-token-value'), false);
  assert.equal(summary.path, '/Confidential/My Space/report.docx');
});

test('same-document sessions receive distinct store-minted document keys', () => {
  const store = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
  });
  const descriptor = {
    path: '/docs/shared.docx',
    storageKind: 'workspace',
    storageId: 'workspace:shared',
    fileName: 'shared.docx',
    versionKey: 'v1',
    canWrite: true,
    documentKey: 'f'.repeat(32),
  };

  const first = store.createSession(descriptor);
  const second = store.createSession(descriptor);

  assert.match(first.documentKey, /^[0-9a-f]{32}$/);
  assert.match(second.documentKey, /^[0-9a-f]{32}$/);
  assert.notEqual(first.documentKey, second.documentKey);
  assert.notEqual(first.documentKey, descriptor.documentKey, 'caller input cannot choose callback authorization material');
  assert.equal(buildDocumentKey(first), first.documentKey);
  assert.throws(
    () => buildDocumentKey({ ...descriptor, documentKey: '' }),
    /persisted v5 documentKey/i,
  );
});

test('session store expires at the earlier of idle timeout and delegation expiry', () => {
  let now = at('2026-06-09T12:00:00.000Z');
  const store = createSessionStore({
    now: () => now,
    idleTtlMs: 30 * 60 * 1000
  });

  const created = store.createSession({
    path: '/Confidential/My Space/report.docx',
    storageKind: 'dpu',
    storageId: 'confidential:report-1',
    fileName: 'report.docx',
    canWrite: true,
    canComment: true,
    versionKey: 'v1',
    authUser: {
      id: 'local:alice',
      username: 'alice',
      roles: ['user']
    },
    delegations: {
      dpuConfidential: {
        token: 'delegation-token-value',
        expiresAt: '2026-06-09T12:10:00.000Z'
      }
    }
  });

  assert.equal(created.idleExpiresAt, '2026-06-09T12:10:00.000Z');
  assert.equal(created.absoluteExpiresAt, '2026-06-09T12:10:00.000Z');

  now = at('2026-06-09T12:05:00.000Z');
  const touched = store.touchSession(created.token);
  assert.equal(touched.idleExpiresAt, '2026-06-09T12:10:00.000Z');
  assert.equal(touched.absoluteExpiresAt, '2026-06-09T12:10:00.000Z');
});

test('getForStorageRequest renews idle expiry within the absolute bound', () => {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const store = createSessionStore({ now: () => clock, idleTtlMs: 30 * 60 * 1000 });
  const created = store.createSession({ path: '/docs/a.docx', storageKind: 'workspace', fileName: 'a.docx', canWrite: true });

  clock = new Date('2026-01-01T00:25:00.000Z'); // 25 min in, still active → touch-on-read
  store.getForStorageRequest(created.token);

  clock = new Date('2026-01-01T00:50:00.000Z'); // 50 min after open, but only 25 min since last activity
  const after = store.getForStorageRequest(created.token);
  assert.equal(after.path, '/docs/a.docx');
});

test('session store rejects document access after absolute delegation expiry', () => {
  const store = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
    idleTtlMs: 30 * 60 * 1000
  });

  const created = store.createSession({
    path: '/Confidential/My Space/report.docx',
    storageKind: 'dpu',
    storageId: 'confidential:report-1',
    fileName: 'report.docx',
    canWrite: true,
    canComment: true,
    versionKey: 'v1',
    authUser: {
      id: 'local:alice',
      username: 'alice',
      roles: ['user']
    },
    delegations: {
      dpuConfidential: {
        token: 'delegation-token-value',
        expiresAt: '2026-06-09T12:10:00.000Z'
      }
    }
  });

  assert.throws(
    () => store.getForStorageRequest(created.token, {
      now: at('2026-06-09T12:10:01.000Z')
    }),
    /expired|unknown/i
  );
});

test('session metadata survives a targeted recreate through an atomic private v5 file', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-session-persist-')));
  const stateFile = path.join(directory, 'sessions-v5.json');
  const now = () => at('2026-06-09T12:00:00.000Z');
  const first = createSessionStore({ now, stateFile });
  const created = first.createSession({
    path: '/docs/recreate.docx',
    storageKind: 'workspace',
    storageId: 'workspace:recreate',
    objectId: 'recreate',
    fileName: 'recreate.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    canWrite: true,
    canComment: false,
    versionKey: 'v1',
    authUser: { id: 'alice', username: 'alice', roles: ['user'] },
  });

  const second = createSessionStore({ now, stateFile });
  const reopened = second.getForStorageRequest(created.token);
  assert.equal(reopened.path, '/docs/recreate.docx');
  assert.equal(reopened.documentKey, created.documentKey);
  assert.equal((await readFile(stateFile, 'utf8')).endsWith('\n'), true);
  assert.equal((await readdir(directory)).some((name) => name.includes('.tmp-')), false);
});

test('session loading ignores an uncommitted crash temp and retains the last renamed generation', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-session-crash-')));
  const stateFile = path.join(directory, 'sessions-v5.json');
  const now = () => at('2026-06-09T12:00:00.000Z');
  const first = createSessionStore({ now, stateFile });
  const created = first.createSession({
    path: '/docs/stable.docx', storageKind: 'workspace', storageId: '', objectId: '',
    fileName: 'stable.docx', mimeType: '', canWrite: true, canComment: false,
    versionKey: 'v1', authUser: { id: 'alice', username: 'alice', roles: [] },
  });
  await writeFile(path.join(directory, '.sessions-v5.json.tmp-crashed'), '{"partial":', { mode: 0o600 });

  const recreated = createSessionStore({ now, stateFile });
  assert.equal(recreated.getForStorageRequest(created.token).fileName, 'stable.docx');
});

test('persisted state contains no delegation bearer and requires fresh DPU control material after recreate', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-session-delegation-')));
  const stateFile = path.join(directory, 'sessions-v5.json');
  const now = () => at('2026-06-09T12:00:00.000Z');
  const first = createSessionStore({ now, stateFile });
  const created = first.createSession({
    path: '/Confidential/restricted.docx', storageKind: 'dpu', storageId: 'dpu:1', objectId: '1',
    fileName: 'restricted.docx', mimeType: '', canWrite: true, canComment: false,
    versionKey: 'v1', authUser: { id: 'alice', username: 'alice', roles: ['user'] },
    delegations: {
      dpuConfidential: {
        token: 'raw-delegation-bearer-must-not-reach-disk',
        expiresAt: '2026-06-09T12:30:00.000Z',
      },
    },
  });
  assert.equal(first.getForStorageRequest(created.token).delegations.dpuConfidential.token, 'raw-delegation-bearer-must-not-reach-disk');
  const bytes = await readFile(stateFile, 'utf8');
  assert.equal(bytes.includes('raw-delegation-bearer-must-not-reach-disk'), false);
  assert.equal(JSON.parse(bytes).sessions[0].requiresReauthorization, true);
  assert.deepEqual(JSON.parse(bytes).sessions[0].delegations, {});

  const recreated = createSessionStore({ now, stateFile });
  assert.throws(() => recreated.getForStorageRequest(created.token), /fresh authenticated control material/i);
  assert.deepEqual(recreated.listActiveSessions(), []);
});

test('session state fails closed on symlink targets, symlink parents, weak modes, and corrupt bytes', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-session-guards-')));
  const target = path.join(directory, 'target.json');
  const stateLink = path.join(directory, 'state-link.json');
  await writeFile(target, '{"schemaVersion":5,"sessions":[]}\n', { mode: 0o600 });
  await symlink(target, stateLink);
  assert.throws(() => createSessionStore({ stateFile: stateLink }), /regular file|link/i);

  const realParent = path.join(directory, 'real-parent');
  const linkedParent = path.join(directory, 'linked-parent');
  await mkdir(realParent, { mode: 0o700 });
  await symlink(realParent, linkedParent);
  const linkedStore = createSessionStore({ stateFile: path.join(linkedParent, 'state.json') });
  assert.throws(() => linkedStore.createSession({}), /directory is unsafe/i);

  const weak = path.join(directory, 'weak.json');
  await writeFile(weak, '{"schemaVersion":5,"sessions":[]}\n', { mode: 0o600 });
  await chmod(weak, 0o644);
  assert.throws(() => createSessionStore({ stateFile: weak }), /permissions.*0600/i);

  const corrupt = path.join(directory, 'corrupt.json');
  await writeFile(corrupt, '{"schemaVersion":5,"sessions":[{"tokenHash":"bad"}]}\n', { mode: 0o600 });
  assert.throws(() => createSessionStore({ stateFile: corrupt }), /corrupt/i);

  const v4 = path.join(directory, 'v4.json');
  await writeFile(v4, '{"schemaVersion":4,"sessions":[]}\n', { mode: 0o600 });
  assert.throws(() => createSessionStore({ stateFile: v4 }), /runtime contract v5.*recreate/i);
});

test('session state hard cut rejects missing, malformed, and duplicate per-session document keys', async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-session-key-')));
  const missingKeyFile = path.join(directory, 'missing-key.json');
  const first = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
    stateFile: missingKeyFile,
  });
  first.createSession({
    path: '/docs/a.docx', storageKind: 'workspace', storageId: 'a', objectId: '',
    fileName: 'a.docx', mimeType: '', canWrite: true, canComment: false,
    versionKey: 'v1', authUser: { id: 'alice', username: 'alice', roles: [] },
  });
  const missingKeyState = JSON.parse(await readFile(missingKeyFile, 'utf8'));
  delete missingKeyState.sessions[0].documentKey;
  await writeFile(missingKeyFile, `${JSON.stringify(missingKeyState)}\n`, { mode: 0o600 });
  assert.throws(
    () => createSessionStore({ stateFile: missingKeyFile }),
    /documentKey.*recreate/i,
  );

  const malformedKeyFile = path.join(directory, 'malformed-key.json');
  const malformed = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
    stateFile: malformedKeyFile,
  });
  malformed.createSession({
    path: '/docs/malformed.docx', storageKind: 'workspace', storageId: 'malformed', objectId: '',
    fileName: 'malformed.docx', mimeType: '', canWrite: true, canComment: false,
    versionKey: 'v1', authUser: { id: 'alice', username: 'alice', roles: [] },
  });
  const malformedKeyState = JSON.parse(await readFile(malformedKeyFile, 'utf8'));
  malformedKeyState.sessions[0].documentKey = 'A'.repeat(32);
  await writeFile(malformedKeyFile, `${JSON.stringify(malformedKeyState)}\n`, { mode: 0o600 });
  assert.throws(
    () => createSessionStore({ stateFile: malformedKeyFile }),
    /documentKey.*recreate/i,
  );

  const duplicateKeyFile = path.join(directory, 'duplicate-key.json');
  const second = createSessionStore({
    now: () => at('2026-06-09T12:00:00.000Z'),
    stateFile: duplicateKeyFile,
  });
  for (const name of ['b.docx', 'c.docx']) {
    second.createSession({
      path: `/docs/${name}`, storageKind: 'workspace', storageId: name, objectId: '',
      fileName: name, mimeType: '', canWrite: true, canComment: false,
      versionKey: 'v1', authUser: { id: 'alice', username: 'alice', roles: [] },
    });
  }
  const duplicateKeyState = JSON.parse(await readFile(duplicateKeyFile, 'utf8'));
  duplicateKeyState.sessions[1].documentKey = duplicateKeyState.sessions[0].documentKey;
  await writeFile(duplicateKeyFile, `${JSON.stringify(duplicateKeyState)}\n`, { mode: 0o600 });
  assert.throws(
    () => createSessionStore({ stateFile: duplicateKeyFile }),
    /duplicate documentKey/i,
  );
});
