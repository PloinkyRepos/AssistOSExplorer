import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FILE_EXP_UI_ACTIONS,
    fileExpUiReducer,
    getDirectoryResetPatch
} from '../../web-components/pages/file-exp/file-exp-ui-controller.js';
import { FileExp } from '../../web-components/pages/file-exp/file-exp.js';

test('DPU research preview state preserves the selected resource used by local actions', () => {
    const resource = { id: 'resource-1', provider: 'huggingface' };
    const transition = fileExpUiReducer({}, {
        type: FILE_EXP_UI_ACTIONS.SET_PREVIEW_STATE,
        payload: {
            patch: {
                dpuResearchResourceId: resource.id,
                dpuResearchJobId: 'job-1',
                dpuResearchRecord: resource,
                dpuResearchIdempotencyKey: 'acquire-1'
            }
        }
    });

    assert.equal(transition.changed, true);
    assert.deepEqual(transition.patch, {
        dpuResearchResourceId: 'resource-1',
        dpuResearchJobId: 'job-1',
        dpuResearchRecord: resource,
        dpuResearchIdempotencyKey: 'acquire-1'
    });
});

test('directory navigation clears DPU research action context', () => {
    const patch = getDirectoryResetPatch();

    assert.equal(patch.dpuResearchResourceId, null);
    assert.equal(patch.dpuResearchJobId, null);
    assert.equal(patch.dpuResearchRecord, null);
    assert.equal(patch.dpuResearchIdempotencyKey, '');
});

test('Acquire receives its resource ID through the WebSkel local-action argument', async () => {
    const previousWindow = globalThis.window;
    let resolveAcquire;
    const calls = [];
    globalThis.window = {
        webSkel: {
            appServices: {
                getClient() {
                    return {
                        callTool(name, args) {
                            calls.push({ name, args });
                            return new Promise((resolve) => { resolveAcquire = resolve; });
                        }
                    };
                }
            }
        }
    };
    const attributes = new Map();
    const target = {
        disabled: false,
        isConnected: true,
        textContent: 'Acquire',
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); }
    };
    const statuses = [];
    const context = {
        state: { dpuResearchResourceId: null, dpuResearchIdempotencyKey: '', selectedPath: '' },
        showStatus(message, isError = false) { statuses.push({ message, isError }); }
    };

    try {
        const pending = FileExp.prototype.acquireDpuResearchResource.call(context, target, 'resource-from-local-action');
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(target.disabled, true);
        assert.equal(target.textContent, 'Acquiring…');
        assert.equal(attributes.get('aria-busy'), 'true');
        assert.equal(calls[0].name, 'dpu_resource_acquire');
        assert.equal(calls[0].args.id, 'resource-from-local-action');
        assert.match(statuses[0].message, /Starting DPU resource acquisition/);

        resolveAcquire({
            content: [{ type: 'text', text: JSON.stringify({ ok: true, job: { state: 'running' } }) }]
        });
        await pending;
        assert.equal(target.disabled, false);
        assert.equal(target.textContent, 'Acquire');
        assert.equal(attributes.has('aria-busy'), false);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Verify read calls the bounded DPU file read and reports the result on the button', async () => {
    const previousWindow = globalThis.window;
    const calls = [];
    globalThis.window = {
        webSkel: {
            appServices: {
                getClient() {
                    return {
                        async callTool(name, args) {
                            calls.push({ name, args });
                            return {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        ok: true,
                                        encoding: 'base64',
                                        bytesRead: 4096,
                                        nextOffset: 4096,
                                        eof: false,
                                        data: 'ZGF0YQ=='
                                    })
                                }]
                            };
                        }
                    };
                }
            }
        }
    };
    const attributes = new Map();
    const target = {
        dataset: {},
        disabled: false,
        isConnected: true,
        textContent: 'Verify read',
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); }
    };
    const statuses = [];
    const context = {
        showStatus(message, isError = false) { statuses.push({ message, isError }); }
    };

    try {
        await FileExp.prototype.verifyDpuResearchFileRead.call(
            context,
            target,
            encodeURIComponent('resource-1'),
            encodeURIComponent('folder/data set.csv')
        );

        assert.deepEqual(calls, [{
            name: 'dpu_resource_file_read',
            args: { id: 'resource-1', path: 'folder/data set.csv', offset: 0, length: 4096 }
        }]);
        assert.equal(target.disabled, false);
        assert.equal(target.textContent, 'Verified · 4096 bytes');
        assert.equal(target.dataset.verificationState, 'verified');
        assert.equal(attributes.has('aria-busy'), false);
        assert.match(statuses.at(-1).message, /next offset 4096/);
        assert.equal(statuses.at(-1).isError, false);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Ask about this resource launches DPU WebChat with a resource-only context', () => {
    const previousWindow = globalThis.window;
    const opened = [];
    globalThis.window = {
        open(...args) {
            opened.push(args);
            return {};
        }
    };
    const statuses = [];
    const context = {
        showStatus(message, isError = false) { statuses.push({ message, isError }); }
    };

    try {
        const resourceId = '913628a2-6c8f-491b-b684-352efa391a3d';
        FileExp.prototype.askDpuResearchAgent.call(
            context,
            null,
            encodeURIComponent(resourceId)
        );

        const url = new URL(opened[0][0], 'http://localhost');
        assert.equal(url.pathname, '/webchat');
        assert.equal(url.searchParams.get('agent'), 'dpuAgent');
        assert.equal(url.searchParams.get('forward-envelope'), '1');
        assert.equal(url.searchParams.get('dpu-resource-id'), resourceId);
        assert.equal(url.searchParams.has('resource-data'), false);
        assert.match(statuses[0].message, /selected resource/);
    } finally {
        globalThis.window = previousWindow;
    }
});
