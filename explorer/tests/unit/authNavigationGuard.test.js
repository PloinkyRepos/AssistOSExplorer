import test from 'node:test';
import assert from 'node:assert/strict';

import { probeAuthenticatedSession } from '../../services/infrastructure/authApi.js';
import {
    buildLoginRedirect,
    installAuthNavigationGuard,
    isBackForwardRestore
} from '../../services/infrastructure/authNavigationGuard.js';

test('probeAuthenticatedSession distinguishes logged-out, authenticated, and indeterminate responses', async () => {
    assert.equal(await probeAuthenticatedSession(async () => ({ status: 401, ok: false })), false);
    assert.equal(await probeAuthenticatedSession(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ ok: true })
    })), true);
    assert.equal(await probeAuthenticatedSession(async () => ({ status: 503, ok: false })), null);
    assert.equal(await probeAuthenticatedSession(async () => { throw new Error('offline'); }), null);
});

test('back-forward restoration includes BFCache and navigation timing signals', () => {
    assert.equal(isBackForwardRestore({ persisted: true }, null), true);
    assert.equal(isBackForwardRestore({ persisted: false }, {
        getEntriesByType: () => [{ type: 'back_forward' }]
    }), true);
    assert.equal(isBackForwardRestore({ persisted: false }, {
        getEntriesByType: () => [{ type: 'navigate' }]
    }), false);
});

test('logged-out BFCache restoration replaces the page with login', async () => {
    let pageShowHandler = null;
    let redirect = '';
    const windowObject = {
        location: {
            pathname: '/explorer/index.html',
            search: '?mode=test',
            hash: '#file-exp/projects',
            replace(value) {
                redirect = value;
            }
        },
        addEventListener(type, listener) {
            if (type === 'pageshow') pageShowHandler = listener;
        },
        removeEventListener() {}
    };

    installAuthNavigationGuard({
        windowObject,
        performanceObject: null,
        probeSession: async () => false
    });
    await pageShowHandler({ persisted: true });

    assert.equal(
        redirect,
        buildLoginRedirect(windowObject.location)
    );
    const loginUrl = new URL(redirect, 'http://localhost');
    assert.equal(loginUrl.pathname, '/auth/login');
    assert.equal(loginUrl.searchParams.get('returnTo'), '/explorer/index.html?mode=test#file-exp/projects');
});

test('authenticated users and transient probe failures stay on the restored page', async () => {
    for (const probeResult of [true, null]) {
        let pageShowHandler = null;
        let redirected = false;
        const windowObject = {
            location: {
                pathname: '/explorer/index.html',
                replace() {
                    redirected = true;
                }
            },
            addEventListener(type, listener) {
                if (type === 'pageshow') pageShowHandler = listener;
            },
            removeEventListener() {}
        };
        installAuthNavigationGuard({
            windowObject,
            performanceObject: null,
            probeSession: async () => probeResult
        });
        await pageShowHandler({ persisted: true });
        assert.equal(redirected, false);
    }
});
