import test from 'node:test';
import assert from 'node:assert/strict';

import { FileExp } from '../../web-components/pages/file-exp/file-exp.js';
import {
    FILE_EXP_MENU_SLOTS,
    getBuiltInContextMenuItems
} from '../../web-components/pages/file-exp/file-exp-menu-contributions.js';

test('Paste into is rendered only when the host action is available', () => {
    const fileExp = {
        state: { clipboard: null },
        normalizePath(value) { return String(value || ''); }
    };
    const target = { path: '/folder', type: 'directory' };

    assert.equal(getBuiltInContextMenuItems(fileExp, target).some((item) => item.id === 'host:paste-into'), false);
    fileExp.state.clipboard = { path: '/source.txt', operation: 'copy' };
    assert.equal(getBuiltInContextMenuItems(fileExp, target).some((item) => item.id === 'host:paste-into'), true);
});

test('context menu renders plugin metadata synchronously without loading plugin code', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        assistOS: {
            workspace: {
                appPlugins: {
                    [FILE_EXP_MENU_SLOTS.contextFile]: [{
                        id: 'calculated-plugin',
                        agent: 'test-agent',
                        contributionType: 'menu',
                        label: 'Calculated plugin',
                        icon: '/plugin.svg',
                        menuModuleUrl: '/plugin.js'
                    }]
                }
            }
        }
    };

    const target = { path: '/folder/file.txt', type: 'file', name: 'file.txt' };
    const publishedSnapshots = [];
    const fileExp = {
        state: { workspaceVersion: 4, openMenuPath: target.path, clipboard: null },
        normalizePath(value) { return String(value || ''); },
        getEntryByPath() { return target; },
        getContextAppMenu() { return null; },
        publishMenuItems(_menu, items) { publishedSnapshots.push(items); }
    };

    try {
        const items = await FileExp.prototype.refreshContextMenuItems.call(fileExp, target.path);
        const pluginItem = items.find((item) => item.source === 'plugin');
        assert.equal(pluginItem.label, 'Calculated plugin');
        assert.equal(pluginItem.icon, '/plugin.svg');
        assert.equal(pluginItem.loading, undefined);
        assert.deepEqual(publishedSnapshots.at(-1), items);
    } finally {
        globalThis.window = previousWindow;
    }
});
