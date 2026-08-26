import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isRetryableRuntimeStatusStreamError,
    publishRuntimeStatusEvents,
    RUNTIME_STATUS_UPDATED_EVENT
} from '../../services/infrastructure/runtimeStatusEvents.js';

test('runtime status stream preserves HTTP status and retries only transient failures', async () => {
    await assert.rejects(
        publishRuntimeStatusEvents({
            eventTarget: new EventTarget(),
            fetchImplementation: async () => ({ok: false, status: 404})
        }),
        (error) => {
            assert.equal(error.status, 404);
            assert.equal(isRetryableRuntimeStatusStreamError(error), false);
            return true;
        }
    );

    assert.equal(isRetryableRuntimeStatusStreamError({status: 401}), false);
    assert.equal(isRetryableRuntimeStatusStreamError({status: 403}), false);
    assert.equal(isRetryableRuntimeStatusStreamError({status: 502}), true);
    assert.equal(isRetryableRuntimeStatusStreamError({status: 503}), true);
    assert.equal(isRetryableRuntimeStatusStreamError({status: 504}), true);
    assert.equal(isRetryableRuntimeStatusStreamError(new TypeError('Failed to fetch')), true);
});

test('runtime status stream publishes each NDJSON snapshot as a custom event', async (t) => {
    const originalCustomEvent = globalThis.CustomEvent;
    if (typeof originalCustomEvent !== 'function') {
        globalThis.CustomEvent = class CustomEvent extends Event {
            constructor(type, options = {}) {
                super(type);
                this.detail = options.detail;
            }
        };
    }
    t.after(() => {
        if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = originalCustomEvent;
    });

    const target = new EventTarget();
    const received = [];
    target.addEventListener(RUNTIME_STATUS_UPDATED_EVENT, (event) => received.push(event.detail));
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('{"runtimes":[{"agentName":"webAssist","state":{"status":"run'));
            controller.enqueue(new TextEncoder().encode('ning","running":true}}]}\n'));
            controller.close();
        }
    });

    await publishRuntimeStatusEvents({
        eventTarget: target,
        fetchImplementation: async () => ({ok: true, body})
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].runtimes[0].state.status, 'running');
});
