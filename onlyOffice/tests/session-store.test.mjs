import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';
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

test('config defaults the browser editor URL to the Ploinky port convention', () => {
  const config = loadConfig({ ONLYOFFICE_JWT_SECRET: 'test-secret' });
  assert.equal(
    config.publicEditorBaseUrl,
    '/base-agent-additional-server/onlyOffice/8080'
  );
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
