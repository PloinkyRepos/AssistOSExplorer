import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isNonFastForwardPushError,
    pushWithNonFastForwardRetry
} from '../../IDE-plugins/git-tool-button/utils/git-autosync-push-flow.js';

test('recognizes explicit non-fast-forward push rejections', () => {
    assert.equal(isNonFastForwardPushError(new Error('[rejected] main -> main (non-fast-forward)')), true);
    assert.equal(isNonFastForwardPushError(new Error('Updates were rejected because the tip of your current branch is behind its remote counterpart.')), true);
    assert.equal(isNonFastForwardPushError(new Error('authentication failed')), false);
    assert.equal(isNonFastForwardPushError(new Error('failed to push some refs')), false);
});

test('synchronizes and retries exactly once after a non-fast-forward rejection', async () => {
    const events = [];
    let attempts = 0;
    const result = await pushWithNonFastForwardRetry({
        async push() {
            attempts += 1;
            events.push(`push:${attempts}`);
            if (attempts === 1) {
                throw new Error('[rejected] main -> main (non-fast-forward)');
            }
        },
        async synchronize() {
            events.push('synchronize');
        }
    });

    assert.deepEqual(events, ['push:1', 'synchronize', 'push:2']);
    assert.deepEqual(result, { ok: true, retried: true });
});

test('does not synchronize after an unrelated push failure', async () => {
    let synchronized = false;
    const failure = new Error('authentication failed');
    const result = await pushWithNonFastForwardRetry({
        async push() {
            throw failure;
        },
        async synchronize() {
            synchronized = true;
        }
    });

    assert.equal(synchronized, false);
    assert.equal(result.ok, false);
    assert.equal(result.retried, false);
    assert.equal(result.phase, 'push');
    assert.equal(result.error, failure);
});

test('does not push again when synchronization fails', async () => {
    let pushes = 0;
    const synchronizationFailure = new Error('merge conflict');
    const result = await pushWithNonFastForwardRetry({
        async push() {
            pushes += 1;
            throw new Error('[rejected] main -> main (non-fast-forward)');
        },
        async synchronize() {
            throw synchronizationFailure;
        }
    });

    assert.equal(pushes, 1);
    assert.equal(result.ok, false);
    assert.equal(result.retried, true);
    assert.equal(result.phase, 'synchronize');
    assert.equal(result.error, synchronizationFailure);
});

test('stops after the single retry when the remote advances again', async () => {
    let pushes = 0;
    let synchronizations = 0;
    const result = await pushWithNonFastForwardRetry({
        async push() {
            pushes += 1;
            throw new Error('[rejected] main -> main (non-fast-forward)');
        },
        async synchronize() {
            synchronizations += 1;
        }
    });

    assert.equal(pushes, 2);
    assert.equal(synchronizations, 1);
    assert.equal(result.ok, false);
    assert.equal(result.retried, true);
    assert.equal(result.phase, 'retry-push');
});
