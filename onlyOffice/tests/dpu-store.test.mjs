import assert from 'node:assert/strict';
import test from 'node:test';

import { createDpuStore } from '../src/storage/dpu-store.mjs';

function buildSession(overrides = {}) {
  return {
    requestedPath: '/Confidential/My Space/Plans/brief.docx',
    delegations: {
      dpuConfidential: 'delegation.jwt'
    },
    delegationExpiresAt: Date.now() + 60_000,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    canWrite: true,
    ...overrides
  };
}

function createClientFixture() {
  const calls = [];
  let closed = 0;
  const client = {
    async callTool(name, args = {}) {
      calls.push({ name, args });
      if (name === 'dpu_workspace_roots') {
        return {
          roots: {
            mySpace: {
              id: 'root-1'
            }
          }
        };
      }
      if (name === 'dpu_confidential_list' && args.parentId === 'root-1') {
        return {
          items: [
            { id: 'folder-1', name: 'Plans', type: 'folder' }
          ]
        };
      }
      if (name === 'dpu_confidential_list' && args.parentId === 'folder-1') {
        return {
          items: [
            { id: 'doc-1', name: 'brief.docx', type: 'file' }
          ]
        };
      }
      if (name === 'dpu_confidential_get') {
        return {
          object: {
            id: 'doc-1',
            name: 'brief.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            contentVisible: true,
            content: Buffer.from('hello from dpu').toString('base64'),
            canWrite: true,
            canComment: false,
            updatedAt: 'updated-1'
          }
        };
      }
      if (name === 'dpu_confidential_update') {
        return {
          ok: true
        };
      }
      throw new Error(`Unexpected tool call: ${name}`);
    },
    async close() {
      closed += 1;
    }
  };
  return { client, calls, getClosedCount: () => closed };
}

test('dpu store calls dpu_confidential_get with stored delegation token', async () => {
  const fixture = createClientFixture();
  const createAgentClientCalls = [];
  const store = createDpuStore({
    createAgentClient(name, options) {
      createAgentClientCalls.push({ name, options });
      return fixture.client;
    }
  });

  const result = await store.read(buildSession());

  assert.equal(result.buffer.toString('utf8'), 'hello from dpu');
  assert.deepEqual(createAgentClientCalls, [
    {
      name: 'dpuAgent',
      options: {
        userDelegationToken: 'delegation.jwt'
      }
    }
  ]);
  assert.ok(
    fixture.calls.some((entry) => entry.name === 'dpu_confidential_get' && entry.args.id === 'doc-1')
  );
  assert.equal(fixture.getClosedCount(), 1);
});

test('dpu store calls dpu_confidential_update with stored delegation token', async () => {
  const fixture = createClientFixture();
  const createAgentClientCalls = [];
  const store = createDpuStore({
    createAgentClient(name, options) {
      createAgentClientCalls.push({ name, options });
      return fixture.client;
    }
  });

  await store.write(buildSession(), Buffer.from('updated body'));

  assert.deepEqual(createAgentClientCalls, [
    {
      name: 'dpuAgent',
      options: {
        userDelegationToken: 'delegation.jwt'
      }
    }
  ]);
  assert.ok(
    fixture.calls.some(
      (entry) =>
        entry.name === 'dpu_confidential_update' &&
        entry.args.id === 'doc-1' &&
        entry.args.content === Buffer.from('updated body').toString('base64') &&
        entry.args.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  );
  assert.equal(fixture.getClosedCount(), 1);
});

test('dpu store rejects Confidential access when delegation token is missing', async () => {
  const createAgentClientCalls = [];
  const store = createDpuStore({
    createAgentClient(name, options) {
      createAgentClientCalls.push({ name, options });
      return createClientFixture().client;
    }
  });

  await assert.rejects(
    () => store.read(buildSession({ delegations: {} })),
    /delegation token/i
  );
  assert.equal(createAgentClientCalls.length, 0);
});

test('dpu store rejects Confidential access after delegation expiry', async () => {
  const createAgentClientCalls = [];
  const store = createDpuStore({
    createAgentClient(name, options) {
      createAgentClientCalls.push({ name, options });
      return createClientFixture().client;
    }
  });

  await assert.rejects(
    () => store.read(buildSession({ delegationExpiresAt: Date.now() - 1 })),
    /delegation expired/i
  );
  assert.equal(createAgentClientCalls.length, 0);
});
