import test from 'node:test';
import assert from 'node:assert/strict';
import { computeComponentBaseUrl, resolveRuntimeAssetUrl } from '../../utils/pluginUtils.core.js';

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
