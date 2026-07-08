import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimePluginLoader } from '../../services/runtime/runtimePluginLoader.js';

test('runtime plugin loader prefers workspace component URLs over legacy agent URLs', async () => {
    const loaded = [];
    const componentRegistry = {
        async loadComponent(meta) {
            loaded.push(meta);
            return meta;
        },
        getCachedComponent() {
            return undefined;
        }
    };
    const loader = createRuntimePluginLoader({
        agentId: 'explorer',
        runtimePluginTool: 'collect_ide_plugins',
        assistosSDK: {
            async fetchRuntimePlugins() {
                return {};
            }
        },
        componentRegistry
    });

    await loader.ensureComponentRegistered('git-new-repository-modal', {
        application: {
            'file-exp:new-menu': [{
                id: 'git',
                agent: 'gitAgent',
                contributionType: 'menu',
                dependencies: [{
                    component: 'git-new-repository-modal',
                    presenter: 'GitNewRepositoryModal',
                    type: 'modal',
                    ownerComponent: 'git-tool-button',
                    baseUrl: '/gitAgent/IDE-plugins/git-tool-button/components/git-new-repository-modal/git-new-repository-modal'
                }]
            }],
            'file-exp:toolbar': [{
                id: 'git',
                agent: 'gitAgent',
                component: 'git-tool-button',
                presenter: 'GitToolButton',
                componentBaseUrl: '/workspace-files/.ploinky/repos/AchillesIDE/gitAgent/IDE-plugins/git-tool-button/git-tool-button',
                dependencies: [{
                    component: 'git-new-repository-modal',
                    presenter: 'GitNewRepositoryModal',
                    type: 'modal',
                    baseUrl: '/workspace-files/.ploinky/repos/AchillesIDE/gitAgent/IDE-plugins/git-tool-button/components/git-new-repository-modal/git-new-repository-modal'
                }]
            }]
        }
    });

    const modalLoad = loaded.find((meta) => meta.componentName === 'git-new-repository-modal');
    assert.equal(
        modalLoad.baseUrl,
        '/workspace-files/.ploinky/repos/AchillesIDE/gitAgent/IDE-plugins/git-tool-button/components/git-new-repository-modal/git-new-repository-modal'
    );
});

test('runtime plugin loader does not load URL-only global settings plugins as components', async () => {
    const loaded = [];
    const componentRegistry = {
        async loadComponent(meta) {
            loaded.push(meta);
            return meta;
        },
        getCachedComponent() {
            return undefined;
        }
    };
    const loader = createRuntimePluginLoader({
        agentId: 'explorer',
        runtimePluginTool: 'collect_ide_plugins',
        assistosSDK: {
            async fetchRuntimePlugins() {
                return {};
            }
        },
        componentRegistry
    });

    await loader.loadComponents({
        application: {
            '': [{
                id: 'soul-gateway',
                agent: 'soul-gateway',
                pluginCategory: 'application',
                contributionType: 'mount',
                component: 'soul-gateway-settings',
                type: 'global',
                settingsUrl: '/services/soul-gateway/management/'
            }],
            'file-exp:toolbar': [{
                id: 'git',
                agent: 'gitAgent',
                pluginCategory: 'application',
                contributionType: 'mount',
                component: 'git-tool-button',
                type: 'embedded'
            }]
        }
    });

    assert.deepEqual(
        loaded.map((meta) => `${meta.agent}/${meta.componentName}`),
        ['gitAgent/git-tool-button']
    );
});

test('runtime plugin loader imports presenter-backed global settings components', async () => {
    const loaded = [];
    const componentRegistry = {
        async loadComponent(meta) {
            loaded.push(meta);
            return meta;
        },
        getCachedComponent() {
            return undefined;
        }
    };
    const loader = createRuntimePluginLoader({
        agentId: 'explorer',
        runtimePluginTool: 'collect_ide_plugins',
        assistosSDK: {
            async fetchRuntimePlugins() {
                return {};
            }
        },
        componentRegistry
    });

    await loader.loadComponents({
        application: {
            '': [{
                id: 'cloudflared-settings',
                agent: 'explorer',
                pluginCategory: 'application',
                contributionType: 'mount',
                component: 'cloudflared-settings',
                presenter: 'CloudflaredSettings',
                type: 'global'
            }]
        }
    });

    assert.deepEqual(loaded, [{
        componentName: 'cloudflared-settings',
        presenterName: 'CloudflaredSettings',
        agent: 'explorer',
        ownerComponent: 'cloudflared-settings',
        isDependency: false,
        customPath: undefined,
        baseUrl: undefined,
        componentType: 'components'
    }]);
});
