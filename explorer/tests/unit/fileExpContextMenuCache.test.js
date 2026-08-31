import test from 'node:test';
import assert from 'node:assert/strict';

import { FileExp } from '../../web-components/pages/file-exp/file-exp.js';
import { canonicalTerminalDirectoryPath } from '../../web-components/pages/file-exp/file-exp-utils.js';
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
        assert.equal(
            getBuiltInContextMenuItems(fileExp, { path: '/folder/file.txt', type: 'file' })
                .some((item) => item.id === 'host:open-terminal-here'),
            false
        );
    } finally {
        globalThis.window = previousWindow;
    }
});

test('Open Terminal Here opens the Explorer target chooser with only a canonical relative path', async () => {
    const previousWindow = globalThis.window;
    const previousAssistOS = globalThis.assistOS;
    const modalCalls = [];
    const opened = [];
    globalThis.window = {
        location: {
            origin: 'https://explorer.example.test',
            href: 'https://explorer.example.test/#file-exp/'
        },
        open(...args) { opened.push(args); }
    };
    globalThis.assistOS = {
        UI: {
            async showModal(...args) { modalCalls.push(args); }
        }
    };
    const fileExp = {
        normalizePath(value) { return String(value || ''); }
    };
    try {
        const openedTerminal = await FileExp.prototype.openTerminalHere.call(fileExp, {
            dataset: { entryPath: '/nested folder/文档/#hash/%value' }
        });
        assert.equal(openedTerminal, true);
        assert.deepEqual(modalCalls, [[
            'terminal-target-modal',
            { dir: 'nested folder/文档/#hash/%value' }
        ]]);
        assert.deepEqual(opened, []);

        const openedRootTerminal = await FileExp.prototype.openTerminalHere.call(fileExp, {
            dataset: { entryPath: '/' }
        });
        assert.equal(openedRootTerminal, true);
        assert.deepEqual(modalCalls[1], ['terminal-target-modal', { dir: '' }]);

        const openedCanonicalTerminal = await FileExp.prototype.openTerminalHere.call(fileExp, {
            dataset: { entryPath: '/nested//folder/./literal%2e%2e' }
        });
        assert.equal(openedCanonicalTerminal, true);
        assert.deepEqual(modalCalls[2], [
            'terminal-target-modal',
            { dir: 'nested/folder/literal%2e%2e' }
        ]);
    } finally {
        globalThis.window = previousWindow;
        globalThis.assistOS = previousAssistOS;
    }
});

test('terminal launcher rejects traversal-shaped and non-canonical path data before opening a modal', async () => {
    const previousAssistOS = globalThis.assistOS;
    const modalCalls = [];
    globalThis.assistOS = {
        UI: {
            async showModal(...args) { modalCalls.push(args); }
        }
    };
    const invalidPaths = [
        undefined,
        '',
        'relative/folder',
        '//network/share',
        '/nested/../escape',
        '/C:/workspace',
        '/back\\slash',
        '/line\nbreak',
        `/unpaired-${String.fromCharCode(0xD800)}`,
        `/${'x'.repeat(4097)}`,
    ];
    try {
        for (const entryPath of invalidPaths) {
            assert.equal(
                await FileExp.prototype.openTerminalHere.call({}, { dataset: { entryPath } }),
                false,
                `expected rejection for ${JSON.stringify(entryPath)}`
            );
        }
        assert.deepEqual(modalCalls, []);
    } finally {
        globalThis.assistOS = previousAssistOS;
    }
});

test('terminal directory canonicalization preserves literal Unicode, spaces, hashes, and percent escapes', () => {
    assert.equal(
        canonicalTerminalDirectoryPath('/nested folder/文档/#hash/%2e%2e'),
        'nested folder/文档/#hash/%2e%2e'
    );
    assert.equal(canonicalTerminalDirectoryPath('/'), '');
    assert.equal(canonicalTerminalDirectoryPath('/a//b/./c/'), 'a/b/c');
    assert.equal(canonicalTerminalDirectoryPath('/a/../b'), null);
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
