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

test('Open Terminal Here is omitted for ordinary users and shown to administrators', () => {
    const previousWindow = globalThis.window;
    const fileExp = {
        state: { clipboard: null },
        normalizePath(value) { return String(value || ''); }
    };
    const target = { path: '/folder', type: 'directory' };
    try {
        globalThis.window = { assistOS: { user: { id: 'local:user', roles: ['user'] } } };
        assert.equal(
            getBuiltInContextMenuItems(fileExp, target).some((item) => item.id === 'host:open-terminal-here'),
            false
        );
        globalThis.window.assistOS.user = { id: 'local:admin', roles: ['admin'] };
        assert.equal(
            getBuiltInContextMenuItems(fileExp, target).some((item) => item.id === 'host:open-terminal-here'),
            true
        );
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Open Terminal Here launches the same-origin core route with a canonical encoded relative path', () => {
    const previousWindow = globalThis.window;
    const opened = [];
    globalThis.window = {
        location: {
            origin: 'https://explorer.example.test',
            href: 'https://explorer.example.test/#file-exp/'
        },
        open(...args) { opened.push(args); }
    };
    const fileExp = {
        normalizePath(value) { return String(value || ''); }
    };
    try {
        const openedTerminal = FileExp.prototype.openTerminalHere.call(fileExp, {
            dataset: { entryPath: '/nested folder/文档/#hash/%value' }
        });
        assert.equal(openedTerminal, true);
        assert.deepEqual(opened, [[
            'https://explorer.example.test/webtty/?dir=nested+folder%2F%E6%96%87%E6%A1%A3%2F%23hash%2F%25value',
            '_blank',
            'noopener,noreferrer'
        ]]);
        const target = new URL(opened[0][0]);
        assert.equal(target.origin, globalThis.window.location.origin);
        assert.equal(target.pathname, '/webtty/');
        assert.equal(target.searchParams.get('dir'), 'nested folder/文档/#hash/%value');
        assert.doesNotMatch(opened[0][0], /(?:base-agent-additional-server|7681)/);
    } finally {
        globalThis.window = previousWindow;
    }
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
