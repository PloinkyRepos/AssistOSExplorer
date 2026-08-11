import test from 'node:test';
import assert from 'node:assert/strict';

import { installExplorerResourceLoader } from '../../services/runtime/explorerResourceLoader.js';

function createWebSkel(loadCalls) {
    return {
        configs: { rootDir: '/explorer/web-components' },
        ResourceManager: {
            async loadComponent(component) {
                loadCalls.push(component);
                return component;
            }
        }
    };
}

test('Explorer preloads component assets before delegating to WebSkel', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    const loadCalls = [];
    globalThis.fetch = async (url) => {
        requested.push(String(url));
        return {
            ok: true,
            status: 200,
            async text() {
                return String(url).endsWith('.html') ? '<main>ready</main>' : '.ready {}';
            }
        };
    };

    try {
        const webSkel = createWebSkel(loadCalls);
        installExplorerResourceLoader(webSkel, { retryOptions: { retries: 0, delayMs: 0 } });
        await webSkel.ResourceManager.loadComponent({
            name: 'file-exp',
            type: 'pages',
            presenterClassName: 'FileExp'
        });

        assert.deepEqual(requested, [
            '/explorer/web-components/pages/file-exp/file-exp.html',
            '/explorer/web-components/pages/file-exp/file-exp.css'
        ]);
        assert.equal(loadCalls.length, 1);
        assert.equal(loadCalls[0].loadedTemplate, '<main>ready</main>');
        assert.deepEqual(loadCalls[0].loadedCSSs, ['.ready {}']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Explorer retries transient component asset responses and preserves HTTP status', async () => {
    const originalFetch = globalThis.fetch;
    const loadCalls = [];
    let attempts = 0;
    globalThis.fetch = async () => {
        attempts += 1;
        return {
            ok: false,
            status: 503,
            async text() { return 'unavailable'; }
        };
    };

    try {
        const webSkel = createWebSkel(loadCalls);
        installExplorerResourceLoader(webSkel, { retryOptions: { retries: 2, delayMs: 0 } });
        await assert.rejects(
            webSkel.ResourceManager.loadComponent({ name: 'file-exp', type: 'pages' }),
            (error) => error?.status === 503 && /Failed to load (template|stylesheet)/.test(error.message)
        );
        assert.equal(attempts, 6);
        assert.equal(loadCalls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Explorer leaves runtime components with preloaded assets untouched', async () => {
    const originalFetch = globalThis.fetch;
    const loadCalls = [];
    globalThis.fetch = async () => {
        throw new Error('fetch should not run');
    };

    try {
        const webSkel = createWebSkel(loadCalls);
        installExplorerResourceLoader(webSkel);
        const component = {
            name: 'runtime-widget',
            type: 'components',
            loadedTemplate: '<section></section>',
            loadedCSSs: ['section {}']
        };
        await webSkel.ResourceManager.loadComponent(component);
        assert.equal(loadCalls[0], component);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
