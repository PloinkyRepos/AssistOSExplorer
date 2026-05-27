import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
