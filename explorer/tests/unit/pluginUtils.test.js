import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterRuntimePluginsByApplicationPolicy,
    computeComponentBaseUrl,
    mergeRuntimePluginsIntoAssistOS,
    normalizeRuntimePlugins,
    resolveRuntimeAssetUrl
} from '../../utils/pluginUtils.core.js';

test('computeComponentBaseUrl builds dependency paths', () => {
    const base = computeComponentBaseUrl('agent', 'child', {
        ownerComponent: 'parent',
        isDependency: true
    });
    assert.equal(base, '/agent/IDE-plugins/parent/components/child/child');
});

test('computeComponentBaseUrl handles overrides via custom path', () => {
    const base = computeComponentBaseUrl('agent', 'child', {
        customPath: 'shared/widgets/widget'
    });
    assert.equal(base, '/agent/IDE-plugins/shared/widgets/widget');
});

test('resolveRuntimeAssetUrl ignores absolute urls', () => {
    const value = resolveRuntimeAssetUrl('agent', 'component', 'https://example.com/icon.svg');
    assert.equal(value, 'https://example.com/icon.svg');
});

test('computeComponentBaseUrl supports workspace asset roots for dependencies', () => {
    const base = computeComponentBaseUrl('soplang', 'add-variable', {
        ownerComponent: 'edit-variables',
        isDependency: true,
        ownerAssetBaseUrl: '/workspace-files/.ploinky/repos/fileExplorer/soplang/IDE-plugins/edit-variables'
    });
    assert.equal(
        base,
        '/workspace-files/.ploinky/repos/fileExplorer/soplang/IDE-plugins/edit-variables/components/add-variable/add-variable'
    );
});

test('resolveRuntimeAssetUrl remaps legacy absolute agent asset paths to workspace files', () => {
    const value = resolveRuntimeAssetUrl(
        'multimedia',
        'document-video-preview',
        '/multimedia/IDE-plugins/assets/icons/preview.svg',
        'icon.svg',
        {
            assetBaseUrl: '/workspace-files/.ploinky/repos/fileExplorer/multimedia/IDE-plugins/document-video-preview',
            pluginsBaseUrl: '/workspace-files/.ploinky/repos/fileExplorer/multimedia/IDE-plugins'
        }
    );
    assert.equal(
        value,
        '/workspace-files/.ploinky/repos/fileExplorer/multimedia/IDE-plugins/assets/icons/preview.svg'
    );
});

test('normalizeRuntimePlugins preserves document and application buckets', () => {
    const normalized = normalizeRuntimePlugins({
        document: {
            document: [{
                pluginCategory: 'document',
                location: 'document',
                agent: 'multimedia',
                component: 'document-video-preview',
                presenter: 'DocumentVideoPreview',
                type: 'embedded'
            }]
        },
        application: {
            'file-exp:toolbar': [{
                pluginCategory: 'application',
                location: 'file-exp:toolbar',
                agent: 'gitAgent',
                component: 'git-explorer-shell',
                presenter: 'GitExplorerShell',
                type: 'embedded'
            }]
        }
    });

    assert.equal(normalized.document.document.length, 1);
    assert.equal(normalized.document.document[0].pluginCategory, 'document');
    assert.equal(normalized.document.document[0].location, 'document');
    assert.equal(normalized.application['file-exp:toolbar'].length, 1);
    assert.equal(normalized.application['file-exp:toolbar'][0].pluginCategory, 'application');
    assert.equal(normalized.application['file-exp:toolbar'][0].location, 'file-exp:toolbar');
});

test('mergeRuntimePluginsIntoAssistOS separates document and application registries', () => {
    const assistOS = {
        workspace: {
            plugins: {},
            appPlugins: {}
        }
    };

    mergeRuntimePluginsIntoAssistOS(assistOS, {
        document: {
            paragraph: [{
                pluginCategory: 'document',
                location: 'paragraph',
                agent: 'multimedia',
                component: 'audio-plugin'
            }]
        },
        application: {
            'file-exp:toolbar': [{
                pluginCategory: 'application',
                location: 'file-exp:toolbar',
                agent: 'gitAgent',
                component: 'git-explorer-shell'
            }]
        }
    });

    assert.equal(assistOS.workspace.plugins.paragraph.length, 1);
    assert.equal(assistOS.workspace.plugins.paragraph[0].component, 'audio-plugin');
    assert.equal(assistOS.workspace.appPlugins['file-exp:toolbar'].length, 1);
    assert.equal(assistOS.workspace.appPlugins['file-exp:toolbar'][0].component, 'git-explorer-shell');
});

test('filterRuntimePluginsByApplicationPolicy removes disabled application plugins only', () => {
    const runtimePlugins = {
        document: {
            paragraph: [{
                pluginCategory: 'document',
                location: 'paragraph',
                agent: 'multimedia',
                component: 'audio-plugin'
            }]
        },
        application: {
            'file-exp:toolbar': [
                {
                    id: 'git',
                    pluginCategory: 'application',
                    location: 'file-exp:toolbar',
                    agent: 'gitAgent',
                    component: 'git-tool-button'
                },
                {
                    id: 'soplang-builder',
                    pluginCategory: 'application',
                    location: 'file-exp:toolbar',
                    agent: 'soplangAgent',
                    component: 'open-builder-button'
                }
            ]
        }
    };

    const filtered = filterRuntimePluginsByApplicationPolicy(runtimePlugins, {
        git: false,
        'soplang-builder': true
    });

    assert.equal(filtered.document.paragraph.length, 1);
    assert.equal(filtered.application['file-exp:toolbar'].length, 1);
    assert.equal(filtered.application['file-exp:toolbar'][0].component, 'open-builder-button');
});

test('filterRuntimePluginsByApplicationPolicy keeps enabled internal application plugins', () => {
    const runtimePlugins = {
        document: {},
        application: {
            'file-exp:internal': [
                {
                    id: 'dpu-runtime-support',
                    pluginCategory: 'application',
                    location: 'file-exp:internal',
                    agent: 'dpuAgent',
                    component: 'dpu-runtime-support'
                }
            ],
            'file-exp:toolbar': [
                {
                    id: 'git',
                    pluginCategory: 'application',
                    location: 'file-exp:toolbar',
                    agent: 'gitAgent',
                    component: 'git-tool-button'
                }
            ]
        }
    };

    const filtered = filterRuntimePluginsByApplicationPolicy(runtimePlugins, {
        git: false,
        'dpu-runtime-support': true
    });

    assert.equal(filtered.application['file-exp:internal'].length, 1);
    assert.equal(filtered.application['file-exp:internal'][0].component, 'dpu-runtime-support');
    assert.equal(filtered.application['file-exp:toolbar'], undefined);
});
