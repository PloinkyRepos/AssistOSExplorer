import test from 'node:test';
import assert from 'node:assert/strict';

import { createComponentRegistry } from '../../services/runtime/componentRegistry.js';
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
                settingsUrl: '/base-agent-additional-server/soul-gateway/7000/management/'
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

test('runtime plugin loader registers a component together with its cross-agent dependencies', async () => {
    const loaded = [];
    const componentRegistry = {
        async loadComponent(meta) {
            loaded.push(meta);
            return meta;
        },
        getCachedComponent(meta) {
            return loaded.find((entry) => (
                entry.agent === meta.agent
                && entry.componentName === meta.componentName
            ));
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
    const runtimePlugins = {
        document: {
            paragraph: [{
                agent: 'soplangAgent',
                component: 'scripta-variants',
                presenter: 'ScriptaVariants',
                dependencies: [{
                    agent: 'explorer',
                    component: 'scripta-variants-view',
                    presenter: 'ScriptaVariantsView',
                    baseUrl: '/explorer/shared/ui/scripta-variants-view/scripta-variants-view'
                }]
            }]
        }
    };

    await loader.ensureComponentRegistered('scripta-variants', runtimePlugins);

    assert.deepEqual(
        loaded.map((meta) => `${meta.agent}/${meta.componentName}`).sort(),
        ['explorer/scripta-variants-view', 'soplangAgent/scripta-variants']
    );
});

test('runtime plugin loader propagates transient asset failures to bootstrap recovery', async () => {
    const loader = createRuntimePluginLoader({
        agentId: 'explorer',
        runtimePluginTool: 'collect_ide_plugins',
        assistosSDK: {
            async fetchRuntimePlugins() {
                return {};
            }
        },
        componentRegistry: {
            async loadComponent() {
                throw new Error('Failed to load plugin template (503)');
            },
            getCachedComponent() {
                return undefined;
            }
        }
    });

    await assert.rejects(
        loader.loadComponents({
            application: {
                'file-exp:toolbar': [{
                    id: 'git',
                    agent: 'gitAgent',
                    component: 'git-tool-button',
                    presenter: 'GitToolButton'
                }]
            }
        }),
        /\(503\)/
    );
});

test('component registry reuses host-registered WebSkel components without fetching runtime assets', async () => {
    const previousCustomElements = globalThis.customElements;
    globalThis.customElements = {
        get(name) {
            return name === 'custom-select' ? class CustomSelectElement {} : undefined;
        }
    };
    try {
        const registry = createComponentRegistry({
            configs: {
                components: [{
                    name: 'custom-select',
                    type: 'components',
                    presenterClassName: 'CustomSelect'
                }]
            }
        });
        const component = await registry.loadComponent({
            agent: 'explorer',
            componentName: 'custom-select',
            presenterName: 'CustomSelect',
            baseUrl: '/invalid-url-that-must-not-be-fetched'
        });

        assert.equal(component.name, 'custom-select');
        assert.equal(component.hostRegistered, true);
    } finally {
        if (previousCustomElements === undefined) delete globalThis.customElements;
        else globalThis.customElements = previousCustomElements;
    }
});
