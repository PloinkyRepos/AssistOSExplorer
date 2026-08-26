import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clearBootstrapReloadState,
    getRuntimeUnavailableNotice,
    isTransientAssetLoadError,
    scheduleBootstrapReload
} from '../../services/runtime/bootstrapRecovery.js';

function fakeWindow() {
    const values = new Map();
    let reloads = 0;
    return {
        sessionStorage: {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key)
        },
        setTimeout(callback) {
            callback();
        },
        location: {
            reload() {
                reloads += 1;
            }
        },
        reloadCount: () => reloads
    };
}

test('bootstrap recovery recognizes transient static asset failures', () => {
    assert.equal(isTransientAssetLoadError(new Error('Failed to fetch dynamically imported module')), true);
    assert.equal(isTransientAssetLoadError(new Error('Component template failed (503)')), true);
    assert.equal(isTransientAssetLoadError(Object.assign(new Error('request failed'), { status: 502 })), true);
    assert.equal(isTransientAssetLoadError(new Error('edge routing generation changed before upstream connection')), true);
    assert.equal(isTransientAssetLoadError(new Error('edge_generation_changed')), true);
    assert.equal(isTransientAssetLoadError(new Error('Component template failed (404)')), false);
});

test('bootstrap recovery presents transient component failures as agent availability', () => {
    const error = Object.assign(new Error('Failed to load marketplace-modal template (503)'), {
        status: 503,
        runtimeAgent: 'explorer',
        runtimeComponent: 'marketplace-modal'
    });

    assert.deepEqual(getRuntimeUnavailableNotice(error), {
        title: 'Agent not available yet',
        message: 'The explorer agent is still starting or temporarily unavailable. Please try again later.'
    });
    assert.equal(getRuntimeUnavailableNotice(new Error('Component template failed (404)')), null);
});

test('bootstrap recovery bounds reloads and clears state after success', () => {
    const windowRef = fakeWindow();
    const error = new Error('Failed to fetch dynamically imported module');

    assert.equal(scheduleBootstrapReload(error, { windowRef, maxReloads: 2 }), true);
    assert.equal(scheduleBootstrapReload(error, { windowRef, maxReloads: 2 }), true);
    assert.equal(scheduleBootstrapReload(error, { windowRef, maxReloads: 2 }), false);
    assert.equal(windowRef.reloadCount(), 2);

    clearBootstrapReloadState(windowRef);
    assert.equal(scheduleBootstrapReload(error, { windowRef, maxReloads: 2 }), true);
});
