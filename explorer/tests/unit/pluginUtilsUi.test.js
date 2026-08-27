import assert from 'node:assert/strict';
import test from 'node:test';

import pluginUtils from '../../utils/pluginUtils.ui.js';

test('openPlugin registers an embedded runtime component before mounting it', async () => {
    const operations = [];
    const pluginContainer = {
        classList: {
            add(className) {
                operations.push(`class:${className}`);
            }
        },
        set innerHTML(value) {
            operations.push(`mount:${value}`);
        }
    };
    const iconContainer = {
        classList: {
            add(className) {
                operations.push(`highlight:${className}`);
            },
            remove() {}
        }
    };
    const presenter = {
        element: {
            querySelector(selector) {
                if (selector === '.document-plugin-container') return pluginContainer;
                if (selector === '.icon-container.document-video-preview') return iconContainer;
                return null;
            }
        }
    };

    globalThis.window = { UI: null };
    globalThis.assistOS = {
        pluginSettings: {},
        workspace: {
            plugins: {
                document: [{
                    agent: 'multimedia',
                    component: 'document-video-preview',
                    type: 'embedded'
                }]
            }
        },
        webSkel: {
            async ensureComponentRegistered(componentName) {
                operations.push(`register:${componentName}`);
            }
        }
    };

    await pluginUtils.openPlugin(
        'document-video-preview',
        'document',
        { documentId: 'document-id' },
        presenter
    );

    const registerIndex = operations.indexOf('register:document-video-preview');
    const mountIndex = operations.findIndex((operation) => operation.startsWith('mount:'));
    assert.ok(registerIndex >= 0);
    assert.ok(mountIndex > registerIndex);
});
