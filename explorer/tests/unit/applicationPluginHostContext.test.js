import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPluginContext } from '../../web-components/pages/file-exp/file-exp-application-plugins.js';

describe('application plugin host context', () => {
    it('includes Explorer and filesystem paths for the current directory', () => {
        const fileExp = {
            state: {
                path: '/ploinky',
                selectedPath: '/ploinky/package.json',
                workspaceVersion: 7
            },
            normalizePath(value) {
                return String(value || '').replace(/\/+$/g, '') || '/';
            }
        };

        const context = buildPluginContext(fileExp, 'file-exp:toolbar-plugins-dropdown', {
            currentFsPath: '/workspace/ploinky',
            workspaceFsRoot: '/workspace'
        });

        assert.deepEqual(context, {
            slot: 'file-exp:toolbar-plugins-dropdown',
            currentPath: '/ploinky',
            currentFsPath: '/workspace/ploinky',
            workspaceFsRoot: '/workspace',
            selectedPath: '/ploinky/package.json',
            workspaceVersion: 7
        });
    });
});
