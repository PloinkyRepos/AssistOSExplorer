import assert from 'node:assert/strict';
import test from 'node:test';

import {
    renderOnlyOfficeEditor
} from '../../services/onlyoffice/onlyoffice-editor-host.js';

function createHost() {
    const children = [];
    return {
        isConnected: true,
        get textContent() {
            return '';
        },
        set textContent(_value) {
            children.splice(0, children.length);
        },
        appendChild(child) {
            children.push(child);
            return child;
        },
        querySelector(selector) {
            if (selector === '.onlyoffice-editor-frame') {
                return children.find((child) => child.className === 'onlyoffice-editor-frame') || null;
            }
            if (selector === 'iframe') {
                return children.find((child) => child.tagName === 'IFRAME') || null;
            }
            return null;
        }
    };
}

test('a superseded async OnlyOffice mount cannot instantiate a stale editor', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const scripts = [];
    const createdConfigs = [];

    try {
        globalThis.window = {};
        globalThis.document = {
            head: {
                appendChild(script) {
                    scripts.push(script);
                    return script;
                }
            },
            querySelector() {
                return null;
            },
            createElement(tagName) {
                const listeners = new Map();
                return {
                    tagName: String(tagName).toUpperCase(),
                    className: '',
                    id: '',
                    dataset: {},
                    addEventListener(type, listener) {
                        listeners.set(type, listener);
                    },
                    dispatch(type) {
                        listeners.get(type)?.();
                    }
                };
            }
        };

        const host = createHost();
        host.__onlyOfficeRuntime = {
            editor: null,
            containerId: '',
            scriptUrl: '',
            configKey: ''
        };
        const firstConfig = {
            document: { key: 'first', title: 'first.docx', fileType: 'docx' },
            documentServerUrl: 'http://office.test'
        };
        const secondConfig = {
            document: { key: 'second', title: 'second.docx', fileType: 'docx' },
            documentServerUrl: 'http://office.test'
        };

        const firstMount = renderOnlyOfficeEditor(host, firstConfig);
        const secondMount = renderOnlyOfficeEditor(host, secondConfig);
        assert.equal(scripts.length, 1);

        globalThis.window.DocsAPI = {
            DocEditor: class {
                constructor(_containerId, config) {
                    createdConfigs.push(config);
                }
                destroyEditor() {}
            }
        };
        scripts[0].dispatch('load');
        await Promise.all([firstMount, secondMount]);

        assert.deepEqual(createdConfigs, [secondConfig]);
        assert.equal(host.__onlyOfficeRuntime.configKey.includes('"second"'), true);
        assert.equal(host.__onlyOfficeRuntime.renderGeneration, 2);
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
        if (originalDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = originalDocument;
        }
    }
});
