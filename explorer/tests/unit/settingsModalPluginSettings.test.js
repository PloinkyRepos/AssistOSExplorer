import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildAgentSettingsItems,
    openPluginSettingsUrl,
    resolvePluginSettingsUrl,
    resolveSettingsComponentBase
} from '../../web-components/modals/settings-modal/settings-modal.js';

test('resolveSettingsComponentBase reuses runtime component URL for matching settings component', () => {
    const base = resolveSettingsComponentBase({
        component: 'soul-gateway-settings',
        settingsComponent: 'soul-gateway-settings',
        componentBaseUrl: '/workspace-files/.ploinky/repos/proxies/soul-gateway/IDE-plugins/soul-gateway-settings/soul-gateway-settings/'
    });

    assert.equal(
        base,
        '/workspace-files/.ploinky/repos/proxies/soul-gateway/IDE-plugins/soul-gateway-settings/soul-gateway-settings'
    );
});

test('resolveSettingsComponentBase keeps nested settings component convention for separate settings components', () => {
    const base = resolveSettingsComponentBase({
        component: 'tool-button',
        settingsComponent: 'tool-settings',
        assetRootPath: '.ploinky/repos/example/agent/IDE-plugins/tool-button'
    });

    assert.equal(
        base,
        '/workspace-files/.ploinky/repos/example/agent/IDE-plugins/tool-button/tool-settings/tool-settings'
    );
});

test('resolvePluginSettingsUrl accepts only router-relative settings URLs', () => {
    assert.equal(
        resolvePluginSettingsUrl({ settingsUrl: '/services/soul-gateway/management/' }),
        '/services/soul-gateway/management/'
    );
    assert.equal(resolvePluginSettingsUrl({ settingsUrl: 'https://soul.axiologic.dev/management/' }), '');
    assert.equal(resolvePluginSettingsUrl({ settingsUrl: '//soul.axiologic.dev/management/' }), '');
    assert.equal(resolvePluginSettingsUrl({ settingsUrl: 'javascript:alert(1)' }), '');
});

test('openPluginSettingsUrl opens router-relative settings without a modal', () => {
    const calls = [];
    const openedWindow = { opener: {} };
    const opened = openPluginSettingsUrl(
        { settingsUrl: '/services/soul-gateway/management/' },
        {
            open: (...args) => {
                calls.push(args);
                return openedWindow;
            }
        }
    );

    assert.equal(opened, true);
    assert.deepEqual(calls, [
        ['/services/soul-gateway/management/', '_blank', 'noopener,noreferrer']
    ]);
    assert.equal(openedWindow.opener, null);
});

test('buildAgentSettingsItems maps Soul Gateway from runtime plugin key and preserves settings URL', () => {
    const items = buildAgentSettingsItems([
        {
            key: 'soul-gateway',
            label: 'Soul Gateway',
            ownerAgent: 'soul-gateway',
            pluginKey: 'soul-gateway/soul-gateway',
            scope: 'workspace',
            settingsUrl: '/services/soul-gateway/management/',
            adminOnly: true
        }
    ], [
        {
            key: 'soul-gateway/soul-gateway',
            agent: 'soul-gateway',
            component: 'soul-gateway-settings',
            pluginId: 'soul-gateway',
            settingsComponent: 'soul-gateway-settings',
            settingsUrl: '/services/soul-gateway/management/',
            adminOnly: true
        }
    ]);
    const soulGateway = items.find((item) => item.key === 'soul-gateway');

    assert.ok(soulGateway);
    assert.equal(soulGateway.available, true);
    assert.equal(soulGateway.settingsComponent, 'soul-gateway-settings');
    assert.equal(soulGateway.settingsUrl, '/services/soul-gateway/management/');
    assert.equal(soulGateway.sourcePlugin.key, 'soul-gateway/soul-gateway');
});

test('buildAgentSettingsItems maps Web Publishing settings from the basic repo plugin', () => {
    const items = buildAgentSettingsItems([
        {
            key: 'web-publishing-settings',
            label: 'Web Publishing',
            ownerAgent: 'web-publishing',
            pluginKey: 'web-publishing/web-publishing-settings',
            scope: 'workspace',
            settingsComponent: 'web-publishing-settings',
            adminOnly: true
        }
    ], [
        {
            key: 'web-publishing/web-publishing-settings',
            agent: 'web-publishing',
            component: 'web-publishing-settings',
            pluginId: 'web-publishing',
            settingsComponent: 'web-publishing-settings',
            adminOnly: true,
            assetRootPath: '.ploinky/repos/basic/web-publishing/IDE-plugins/web-publishing-settings'
        }
    ]);
    const webPublishing = items.find((item) => item.key === 'web-publishing-settings');

    assert.ok(webPublishing);
    assert.equal(webPublishing.available, true);
    assert.equal(webPublishing.settingsComponent, 'web-publishing-settings');
    assert.equal(webPublishing.sourcePlugin.key, 'web-publishing/web-publishing-settings');
    assert.equal(webPublishing.assetRootPath, '.ploinky/repos/basic/web-publishing/IDE-plugins/web-publishing-settings');
});

test('buildAgentSettingsItems marks missing source plugin unavailable', () => {
    const items = buildAgentSettingsItems([
        {
            key: 'missing-agent',
            label: 'Missing Agent',
            ownerAgent: 'missingAgent',
            pluginKey: 'missingAgent/missing-settings',
            scope: 'workspace',
            settingsComponent: 'missing-settings',
            adminOnly: false
        }
    ], []);

    assert.equal(items.length, 1);
    assert.equal(items[0].available, false);
    assert.equal(items[0].sourcePlugin, null);
});

test('buildAgentSettingsItems hides admin-only entries for non-admin view models', () => {
    const items = buildAgentSettingsItems([
        {
            key: 'admin-settings',
            label: 'Admin Settings',
            ownerAgent: 'adminAgent',
            pluginKey: 'adminAgent/admin-settings',
            scope: 'workspace',
            settingsComponent: 'admin-settings',
            adminOnly: true
        },
        {
            key: 'user-settings',
            label: 'User Settings',
            ownerAgent: 'userAgent',
            pluginKey: 'userAgent/user-settings',
            scope: 'workspace',
            settingsComponent: 'user-settings',
            adminOnly: false
        }
    ], [], { isAdmin: false });

    assert.deepEqual(items.map((item) => item.key), ['user-settings']);
});
