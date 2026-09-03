import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchUserAdministrationProof } from '../../services/infrastructure/authApi.js';

const origin = 'https://explorer.example.test';

function jsonResponse(status, payload) {
    return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

function publicSession() {
    return {
        ok: true,
        browserMutation: {
            origin,
            hostRouteKey: 'explorer',
            csrfToken: 'browser-proof',
            generation: 'generation-1'
        }
    };
}

function fetchProofWithResponses(responses, options = {}) {
    const calls = [];
    const result = fetchUserAdministrationProof({
        agentName: 'explorer',
        expectedOrigin: origin,
        ...options,
        fetchImplementation: async (path, requestOptions) => {
            calls.push({ path, options: requestOptions });
            assert.ok(responses.length, 'Unexpected request');
            return responses.shift();
        }
    });
    return { calls, result };
}

test('public administration refreshes the dedicated cookie through an authorized read', async () => {
    const { calls, result } = fetchProofWithResponses([
        jsonResponse(200, publicSession()),
        jsonResponse(200, { ok: true, agent: 'explorer', users: [] })
    ]);
    assert.deepEqual(await result, { mode: 'public', origin });
    assert.deepEqual(calls.map((call) => call.path), ['/auth/token', '/api/agents/explorer/users']);
    for (const call of calls) {
        assert.deepEqual(call.options, {
            cache: 'no-store', credentials: 'include', headers: { Accept: 'application/json' }
        });
    }
});

test('local administration retains the exact-origin header proof without a cookie refresh', async () => {
    const { calls, result } = fetchProofWithResponses([
        jsonResponse(200, {
            ok: true,
            adminControl: { origin: 'http://localhost:8080', csrfToken: 'control-proof' }
        })
    ], { expectedOrigin: 'http://localhost:8080' });
    assert.deepEqual(await result, {
        mode: 'control', origin: 'http://localhost:8080', csrfToken: 'control-proof'
    });
    assert.equal(calls.length, 1);
});

test('public administration rejects incomplete, cross-origin, and cross-agent metadata before the read', async () => {
    const invalidPayloads = [
        { ok: true },
        ...[
            { origin: 'https://other.example.test' },
            { hostRouteKey: 'other-agent' },
            { csrfToken: '' },
            { generation: '' }
        ].map((invalid) => ({ ...publicSession(), browserMutation: { ...publicSession().browserMutation, ...invalid } }))
    ];
    for (const payload of invalidPayloads) {
        const { calls, result } = fetchProofWithResponses([jsonResponse(200, payload)]);
        await assert.rejects(result, /unavailable for this origin/);
        assert.equal(calls.length, 1);
    }
    for (const options of [{ expectedOrigin: '' }, { agentName: '' }]) {
        const { calls, result } = fetchProofWithResponses([jsonResponse(200, publicSession())], options);
        await assert.rejects(result, /unavailable for this origin/);
        assert.equal(calls.length, 1);
    }
});

test('invalid control proof never falls back to valid public metadata', async () => {
    for (const adminControl of [null, {}, { origin, csrfToken: '' }, { origin: 'http://localhost:8080', csrfToken: 'proof' }]) {
        const { calls, result } = fetchProofWithResponses([
            jsonResponse(200, { ...publicSession(), adminControl })
        ]);
        await assert.rejects(result, /unavailable for this origin/);
        assert.equal(calls.length, 1);
    }
});

test('administration surfaces authentication and authorization failures', async () => {
    const unauthenticated = fetchProofWithResponses([
        jsonResponse(401, { ok: false, error: 'not_authenticated' })
    ]);
    await assert.rejects(unauthenticated.result, /not_authenticated/);
    assert.equal(unauthenticated.calls.length, 1);

    const unauthorized = fetchProofWithResponses([
        jsonResponse(200, publicSession()),
        jsonResponse(403, { ok: false, error: 'admin_required', message: 'Administrator access required.' })
    ]);
    await assert.rejects(unauthorized.result, /Administrator access required/);
    assert.equal(unauthorized.calls.length, 2);
});

test('cookie refresh must succeed for the same agent', async () => {
    for (const payload of [{ ok: true, agent: 'other-agent' }, { ok: true }]) {
        const { result } = fetchProofWithResponses([
            jsonResponse(200, publicSession()), jsonResponse(200, payload)
        ]);
        await assert.rejects(result, /unavailable for this agent/);
    }
    const { result } = fetchProofWithResponses([
        jsonResponse(200, publicSession()), jsonResponse(200, { ok: false, error: 'admin_required' })
    ]);
    await assert.rejects(result, /admin_required/);
});

test('administration rejects malformed JSON and unavailable fetch', async () => {
    const invalidJson = { ok: true, status: 200, json: async () => { throw new Error('Invalid JSON'); } };
    await assert.rejects(fetchProofWithResponses([invalidJson]).result, /Authentication request failed/);
    await assert.rejects(fetchProofWithResponses([jsonResponse(200, publicSession()), invalidJson]).result, /Administration request failed/);
    await assert.rejects(fetchUserAdministrationProof({ fetchImplementation: null }), /unavailable/);
});
