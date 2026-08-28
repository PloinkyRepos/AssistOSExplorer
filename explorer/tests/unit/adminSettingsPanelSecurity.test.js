import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.resolve(
    import.meta.dirname,
    '../../web-components/components/admin-settings-panel/admin-settings-panel.js'
);

async function loadAdminSettingsPanel() {
    const source = await fs.readFile(sourcePath, 'utf8');
    const withoutImports = source.replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';\s*/g, '');
    const dependencies = `
        const parseRoles = (roles) => Array.isArray(roles) ? roles : [];
        const fetchAdminControlProof = (...args) => globalThis.__adminFetchControlProof(...args);
    `;
    const url = `data:text/javascript;base64,${Buffer.from(dependencies + withoutImports).toString('base64')}`;
    return import(url);
}

function jsonResponse(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => payload
    };
}

function installRequestMocks(t, { responses = [] } = {}) {
    const originalFetch = globalThis.fetch;
    const originalProofFetcher = globalThis.__adminFetchControlProof;
    const calls = [];
    let proofCalls = 0;
    globalThis.__adminFetchControlProof = async () => ({
        origin: 'http://localhost:8080',
        csrfToken: `v1.proof-${++proofCalls}`
    });
    globalThis.fetch = async (requestPath, options) => {
        calls.push({
            path: requestPath,
            method: options.method,
            credentials: options.credentials,
            headers: {...options.headers},
            body: options.body
        });
        return responses.shift() || jsonResponse(200, {ok: true});
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        if (originalProofFetcher === undefined) delete globalThis.__adminFetchControlProof;
        else globalThis.__adminFetchControlProof = originalProofFetcher;
    });
    return {calls, getProofCalls: () => proofCalls};
}

test('administration reads omit CSRF proof and mutations attach a fresh proof', async (t) => {
    const {calls, getProofCalls} = installRequestMocks(t);
    const {AdminSettingsPanel} = await loadAdminSettingsPanel();
    const panel = Object.create(AdminSettingsPanel.prototype);

    await panel.request('/api/agents/explorer/users');
    for (const method of ['POST', 'PATCH', 'DELETE']) {
        await panel.request('/api/agents/explorer/users/local%3Auser', {
            method,
            body: method === 'DELETE' ? undefined : JSON.stringify({name: 'User'})
        });
    }

    assert.equal(getProofCalls(), 3);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers['x-ploinky-csrf-token'], undefined);
    for (const [index, method] of ['POST', 'PATCH', 'DELETE'].entries()) {
        const call = calls[index + 1];
        assert.equal(call.method, method);
        assert.equal(call.credentials, 'include');
        assert.equal(call.headers['x-ploinky-csrf-token'], `v1.proof-${index + 1}`);
    }
});

test('administration mutation retries csrf_invalid once with a new proof', async (t) => {
    const {calls, getProofCalls} = installRequestMocks(t, {
        responses: [
            jsonResponse(403, {ok: false, error: 'csrf_invalid'}),
            jsonResponse(200, {ok: true, user: {id: 'local:user'}})
        ]
    });
    const {AdminSettingsPanel} = await loadAdminSettingsPanel();
    const panel = Object.create(AdminSettingsPanel.prototype);

    const payload = await panel.request('/api/agents/explorer/users', {
        method: 'POST',
        body: JSON.stringify({username: 'user'})
    });

    assert.equal(payload.user.id, 'local:user');
    assert.equal(getProofCalls(), 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['x-ploinky-csrf-token'], 'v1.proof-1');
    assert.equal(calls[1].headers['x-ploinky-csrf-token'], 'v1.proof-2');
});

test('administration mutation does not retry a non-CSRF rejection', async (t) => {
    const {calls, getProofCalls} = installRequestMocks(t, {
        responses: [jsonResponse(403, {ok: false, error: 'forbidden', message: 'Administrator access required.'})]
    });
    const {AdminSettingsPanel} = await loadAdminSettingsPanel();
    const panel = Object.create(AdminSettingsPanel.prototype);

    await assert.rejects(
        panel.request('/api/agents/explorer/users/local%3Auser', {method: 'DELETE'}),
        /Administrator access required/
    );
    assert.equal(getProofCalls(), 1);
    assert.equal(calls.length, 1);
});
