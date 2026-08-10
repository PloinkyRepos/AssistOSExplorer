import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPluginContext,
    getApplicationPluginsForSlot
} from '../../web-components/pages/file-exp/file-exp-application-plugins.js';

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

    it('does not expose admin-only application plugins to ordinary users', () => {
        globalThis.window = {
            assistOS: {
                user: { id: 'local:user', roles: ['user'] },
                workspace: {
                    appPlugins: {
                        'file-exp:account-menu': [
                            { id: 'workspace-monitor', adminOnly: true },
                            { id: 'help' }
                        ]
                    }
                },
                pluginSettings: {}
            }
        };
        const plugins = getApplicationPluginsForSlot('file-exp:account-menu');
        assert.deepEqual(plugins.map((plugin) => plugin.id), ['help']);
        delete globalThis.window;
    });

    it('exposes admin-only application plugins to administrators', () => {
        globalThis.window = {
            assistOS: {
                user: { id: 'local:admin', roles: ['admin'] },
                workspace: {
                    appPlugins: {
                        'file-exp:account-menu': [{ id: 'workspace-monitor', adminOnly: true }]
                    }
                },
                pluginSettings: {}
            }
        };
        const plugins = getApplicationPluginsForSlot('file-exp:account-menu');
        assert.deepEqual(plugins.map((plugin) => plugin.id), ['workspace-monitor']);
        delete globalThis.window;
    });
});
