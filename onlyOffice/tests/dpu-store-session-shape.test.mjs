import assert from 'node:assert/strict';
import test from 'node:test';

import { createDpuStore } from '../src/storage/dpu-store.mjs';

test('dpu store accepts session-store delegation objects and session.path', async () => {
  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === 'dpu_confidential_get') {
        return {
          object: {
            id: 'file-1',
            name: 'contract.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            updatedAt: '2026-06-09T10:00:00.000Z',
            contentVisible: true,
            canWrite: true,
            canComment: true,
            content: Buffer.from('hello world').toString('base64'),
          },
        };
      }
      throw new Error(`Unexpected tool ${name}`);
    },
    async close() {
      calls.push({ name: 'close', args: null });
    },
  };
  const clientCalls = [];
  const store = createDpuStore({
    createAgentClient: async (agentId, options) => {
      clientCalls.push({ agentId, options });
      return client;
    },
    now: () => Date.parse('2026-06-09T09:00:00.000Z'),
  });

  const document = await store.read({
    path: '/Confidential/My Space/contract.docx',
    objectId: 'file-1',
    fileName: 'contract.docx',
    canWrite: true,
    delegations: {
      dpuConfidential: {
        token: 'delegation.jwt',
        expiresAt: '2026-06-09T09:30:00.000Z',
      },
    },
    absoluteExpiresAt: '2026-06-09T09:30:00.000Z',
  });

  assert.deepEqual(clientCalls, [
    {
      agentId: 'dpuAgent',
      options: { userDelegationToken: 'delegation.jwt' },
    },
  ]);
  assert.deepEqual(calls, [
    { name: 'dpu_confidential_get', args: { id: 'file-1' } },
    { name: 'close', args: null },
  ]);
  assert.equal(document.fileName, 'contract.docx');
  assert.equal(document.buffer.toString('utf8'), 'hello world');
  assert.equal(document.storageKind, 'dpu');
});
