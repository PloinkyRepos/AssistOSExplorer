import assert from 'node:assert/strict';
import test from 'node:test';

import {
    runtimeIsReady,
} from '../IDE-plugins/workspace-monitor/components/workspace-monitor-dashboard/workspace-monitor-resources.js';

test('runtime readiness prefers semantic readiness over process liveness', () => {
    assert.equal(runtimeIsReady({ state: { status: 'starting', running: true, ready: false } }), false);
    assert.equal(runtimeIsReady({ state: { status: 'running', running: true, ready: true } }), true);
    assert.equal(runtimeIsReady({ state: { status: 'failed', running: true, ready: false } }), false);
});

test('runtime readiness remains compatible with snapshots that expose only liveness', () => {
    assert.equal(runtimeIsReady({ state: { status: 'running', running: true } }), true);
    assert.equal(runtimeIsReady({ state: { status: 'stopped', running: false } }), false);
    assert.equal(runtimeIsReady(null), false);
});
