import assert from 'node:assert/strict';
import test from 'node:test';

import { withRetry } from '../../services/utils/retry.js';

test('withRetry exposes the attempt and stops when the error is not retryable', async () => {
    const attempts = [];
    await assert.rejects(
        withRetry(async (attempt) => {
            attempts.push(attempt);
            throw new Error('permanent');
        }, {
            retries: 3,
            delayMs: 0,
            shouldRetry: () => false
        }),
        /permanent/
    );
    assert.deepEqual(attempts, [0]);
});

test('withRetry retries a transient operation with increasing attempt values', async () => {
    const attempts = [];
    const result = await withRetry(async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new Error('transient');
        return 'ready';
    }, {
        retries: 2,
        delayMs: 0
    });

    assert.equal(result, 'ready');
    assert.deepEqual(attempts, [0, 1, 2]);
});
