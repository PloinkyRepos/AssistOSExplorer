import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAdminControlProof } from '../../services/infrastructure/authApi.js';

function jsonResponse(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => payload
    };
}

test('fetchAdminControlProof returns an exact-origin proof without caching the token', async () => {
    const calls = [];
    const proof = await fetchAdminControlProof({
        expectedOrigin: 'http://localhost:8082',
        fetchImplementation: async (path, options) => {
            calls.push({ path, options });
            return jsonResponse(200, {
                ok: true,
                adminControl: {
                    origin: 'http://localhost:8082',
                    csrfToken: 'v1.session-bound-proof'
                }
            });
        }
    });

    assert.deepEqual(proof, {
        origin: 'http://localhost:8082',
        csrfToken: 'v1.session-bound-proof'
    });
    assert.deepEqual(calls, [{
        path: '/auth/token',
        options: {
            cache: 'no-store',
            credentials: 'include',
            headers: { Accept: 'application/json' }
        }
    }]);
});

test('fetchAdminControlProof rejects missing, empty, and cross-origin proofs', async () => {
    const invalidPayloads = [
        { ok: true },
        { ok: true, adminControl: { origin: 'http://localhost:8082', csrfToken: '' } },
        { ok: true, adminControl: { origin: 'http://127.0.0.1:8082', csrfToken: 'v1.wrong-origin' } }
    ];

    for (const payload of invalidPayloads) {
        await assert.rejects(
            fetchAdminControlProof({
                expectedOrigin: 'http://localhost:8082',
                fetchImplementation: async () => jsonResponse(200, payload)
            }),
            /Local administration is unavailable for this origin/
        );
    }
});

test('fetchAdminControlProof surfaces authentication failure without exposing a proof', async () => {
    await assert.rejects(
        fetchAdminControlProof({
            expectedOrigin: 'http://localhost:8082',
            fetchImplementation: async () => jsonResponse(401, {
                ok: false,
                error: 'not_authenticated'
            })
        }),
        /not_authenticated/
    );
});
