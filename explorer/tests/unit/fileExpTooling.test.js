import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileExpTooling } from '../../web-components/pages/file-exp/file-exp-tooling.js';

test('listDirectoryDetailed does not show a nested global loader', async () => {
    const previousWindow = globalThis.window;
    const calls = [];
    globalThis.window = {
        webSkel: {
            showLoading() {
                throw new Error('listDirectoryDetailed should not show a loader directly.');
            },
            hideLoading() {
                throw new Error('listDirectoryDetailed should not hide a loader directly.');
            },
            appServices: {
                async callTool(agentName, toolName, args) {
                    calls.push({ agentName, toolName, args });
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify([{ name: 'src', type: 'directory' }])
                        }]
                    };
                }
            }
        }
    };

    try {
        const tooling = createFileExpTooling();
        const result = await tooling.listDirectoryDetailed('/workspace');

        assert.equal(result.text, JSON.stringify([{ name: 'src', type: 'directory' }]));
        assert.deepEqual(calls, [{
            agentName: 'explorer',
            toolName: 'list_directory_detailed',
            args: { path: '/workspace' }
        }]);
    } finally {
        globalThis.window = previousWindow;
    }
});
