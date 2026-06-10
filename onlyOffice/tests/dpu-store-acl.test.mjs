import assert from 'node:assert/strict';
import test from 'node:test';

import { createDpuStore } from '../src/storage/dpu-store.mjs';

// Session with objectId set so resolveObjectRecord bypasses path resolution
// and calls only dpu_confidential_get — the minimal surface for the ACL check.
const SESSION = {
    requestedPath: '/Confidential/My Space/secret.docx',
    objectId: 'obj-1',
    canWrite: true,
    delegations: {
        dpuConfidential: {
            token: 'grant-token',
            expiresAt: '2999-01-01T00:00:00.000Z'
        }
    }
};

function fakeClientFactory(objectRecord) {
    return function createAgentClient(agentName, options) {
        assert.equal(agentName, 'dpuAgent');
        assert.equal(options.userDelegationToken, 'grant-token');
        return {
            async callTool(name) {
                if (name === 'dpu_confidential_get') {
                    return { object: objectRecord };
                }
                throw new Error(`Unexpected tool call: ${name}`);
            }
        };
    };
}

test('dpu store rejects read when the delegated user lacks ACL (contentVisible:false)', async () => {
    const store = createDpuStore({
        createAgentClient: fakeClientFactory({
            id: 'obj-1',
            name: 'secret.docx',
            contentVisible: false
        })
    });
    await assert.rejects(
        () => store.read(SESSION),
        /read access/i
    );
});

test('dpu store returns bytes when the delegated user has ACL (contentVisible:true)', async () => {
    const store = createDpuStore({
        createAgentClient: fakeClientFactory({
            id: 'obj-1',
            name: 'secret.docx',
            contentVisible: true,
            content: Buffer.from('hi').toString('base64'),
            mimeType: 'application/octet-stream'
        })
    });
    const result = await store.read(SESSION);
    assert.equal(result.buffer.toString('utf8'), 'hi');
});
