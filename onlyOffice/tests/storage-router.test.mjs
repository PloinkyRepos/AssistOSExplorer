import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionStore } from '../src/session-store.mjs';
import { createStorageRouter } from '../src/storage/router.mjs';

test('storage router sends /Confidential/My Space paths to dpu store', async () => {
  const calls = [];
  const router = createStorageRouter({
    dpuStore: {
      async metadata(session) {
        calls.push(['dpu:metadata', session.requestedPath]);
        return { source: 'dpu' };
      },
      async read(session) {
        calls.push(['dpu:read', session.requestedPath]);
        return 'dpu-bytes';
      },
      async write(session, buffer) {
        calls.push(['dpu:write', session.requestedPath, buffer.toString('utf8')]);
      }
    },
    workspaceStore: {
      async read(session) {
        calls.push(['workspace:read', session.requestedPath]);
        return 'workspace-bytes';
      },
      async write(session, buffer) {
        calls.push(['workspace:write', session.requestedPath, buffer.toString('utf8')]);
      }
    }
  });

  const backend = router.forSession({
    requestedPath: '/Confidential/My Space/report.docx'
  });

  assert.deepEqual(await backend.metadata(), { source: 'dpu' });
  assert.equal(await backend.read(), 'dpu-bytes');
  await backend.write(Buffer.from('save'));
  assert.deepEqual(calls, [
    ['dpu:metadata', '/Confidential/My Space/report.docx'],
    ['dpu:read', '/Confidential/My Space/report.docx'],
    ['dpu:write', '/Confidential/My Space/report.docx', 'save']
  ]);
});

test('storage router sends persisted Confidential sessions to dpu store', async () => {
  const calls = [];
  const sessions = createSessionStore({
    now: () => new Date('2026-06-09T12:00:00.000Z')
  });
  const created = sessions.createSession({
    path: '/Confidential/My Space/report.docx',
    storageKind: 'dpu',
    storageId: 'confidential:report',
    fileName: 'report.docx',
    canWrite: true,
    canComment: true,
    versionKey: 'v1',
    delegations: {
      dpuConfidential: {
        token: 'delegation.jwt',
        expiresAt: '2026-06-09T12:30:00.000Z'
      }
    }
  });
  const storedSession = sessions.getForStorageRequest(created.token, {
    now: new Date('2026-06-09T12:01:00.000Z')
  });
  const router = createStorageRouter({
    dpuStore: {
      async read(session) {
        calls.push(['dpu:read', session.path, session.requestedPath]);
        return 'dpu-bytes';
      },
      async write() {}
    },
    workspaceStore: {
      async read(session) {
        calls.push(['workspace:read', session.path, session.requestedPath]);
        return 'workspace-bytes';
      },
      async write() {}
    }
  });

  const backend = router.forSession(storedSession);

  assert.equal(await backend.read(), 'dpu-bytes');
  assert.deepEqual(calls, [
    ['dpu:read', '/Confidential/My Space/report.docx', '/Confidential/My Space/report.docx']
  ]);
});

test('storage router sends non-Confidential paths to workspace store', async () => {
  const calls = [];
  const router = createStorageRouter({
    dpuStore: {
      async metadata(session) {
        calls.push(['dpu:metadata', session.requestedPath]);
        return { source: 'dpu' };
      },
      async read(session) {
        calls.push(['dpu:read', session.requestedPath]);
        return 'dpu-bytes';
      },
      async write(session, buffer) {
        calls.push(['dpu:write', session.requestedPath, buffer.toString('utf8')]);
      }
    },
    workspaceStore: {
      async read(session) {
        calls.push(['workspace:read', session.requestedPath]);
        return 'workspace-bytes';
      },
      async write(session, buffer) {
        calls.push(['workspace:write', session.requestedPath, buffer.toString('utf8')]);
      }
    }
  });

  const backend = router.forSession({
    requestedPath: '/workspace/report.docx',
    marker: 'workspace-session'
  });

  assert.deepEqual(await backend.metadata(), {
    requestedPath: '/workspace/report.docx',
    marker: 'workspace-session'
  });
  assert.equal(await backend.read(), 'workspace-bytes');
  await backend.write(Buffer.from('save'));
  assert.deepEqual(calls, [
    ['workspace:read', '/workspace/report.docx'],
    ['workspace:write', '/workspace/report.docx', 'save']
  ]);
});

test('storage router rejects /Confidential/Secrets paths', () => {
  const router = createStorageRouter({
    dpuStore: {},
    workspaceStore: {}
  });

  assert.throws(
    () =>
      router.forSession({
        requestedPath: '/Confidential/Secrets/keys.docx'
      }),
    /secrets/i
  );
});
