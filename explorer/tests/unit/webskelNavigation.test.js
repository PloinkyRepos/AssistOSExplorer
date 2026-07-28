import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSkel } from '../../shared/libs/webskel/webskel.mjs';

test('WebSkel ignores history events until the application content root is mounted', async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const listeners = [];
    globalThis.document = {
        addEventListener(type, listener) {
            listeners.push({ type, listener });
        },
        createElement() {
            return {
                classList: {
                    add() {},
                },
            };
        },
    };
    globalThis.window = {
        location: {
            hash: '#file-exp/Confidential/Secrets/',
        },
    };

    try {
        const webSkel = new WebSkel();
        webSkel.configs = {
            components: [{ name: 'file-exp' }],
        };
        let navigationCalls = 0;
        webSkel.changeToDynamicPage = async () => {
            navigationCalls += 1;
        };

        await globalThis.window.onpopstate({ state: null });

        assert.equal(navigationCalls, 0);
        assert.equal(listeners.filter(({ type }) => type === 'click').length, 2);
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }
});
