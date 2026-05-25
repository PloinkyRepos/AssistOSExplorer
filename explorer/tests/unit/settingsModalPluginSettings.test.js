import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSettingsComponentBase } from '../../web-components/modals/settings-modal/settings-modal.js';

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
