import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.resolve(
    import.meta.dirname,
    '../../IDE-plugins/marketplace/components/marketplace-modal/marketplace-modal.js'
);

async function loadMarketplaceModal() {
    const source = await fs.readFile(sourcePath, 'utf8');
    const withoutImports = source.replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';\s*/g, '');
    const dependencies = `
        const callExplorerTool = async () => ({});
        const parseToolResult = (value) => value;
        const buildAgentSettingsItems = () => [];
        const ensureSettingsComponentRegistered = async () => {};
        const resolvePluginSettingsUrl = () => '';
        const flattenPluginsByKey = () => [];
        const getCachedRuntimePlugins = () => null;
    `;
    const url = `data:text/javascript;base64,${Buffer.from(dependencies + withoutImports).toString('base64')}`;
    return import(url);
}

test('Marketplace status and busy updates do not rebuild reactive child components', async () => {
    const {MarketplaceModal} = await loadMarketplaceModal();
    const modal = Object.create(MarketplaceModal.prototype);
    modal.state = {status: '', statusType: '', busy: false};
    let statusRenders = 0;
    let interactiveSyncs = 0;
    modal.renderStatus = () => { statusRenders += 1; };
    modal.syncInteractiveState = () => { interactiveSyncs += 1; };
    modal.renderState = () => assert.fail('status and busy updates must not rebuild Marketplace content');

    modal.setStatus('Loading marketplace...');
    modal.setBusy(true);

    assert.equal(statusRenders, 1);
    assert.equal(interactiveSyncs, 1);
    assert.equal(modal.state.status, 'Loading marketplace...');
    assert.equal(modal.state.busy, true);
});

test('Marketplace initial load performs one structural render after state settles', async () => {
    const {MarketplaceModal} = await loadMarketplaceModal();
    const modal = Object.create(MarketplaceModal.prototype);
    modal.state = {marketplace: null, status: 'Loading marketplace...', statusType: '', busy: false};
    modal.requestMarketplace = async () => ({permissions: {canManage: false}, repositories: [], agents: []});
    modal.renderStatus = () => {};
    modal.syncInteractiveState = () => {};
    let structuralRenders = 0;
    modal.renderState = () => { structuralRenders += 1; };

    await modal.loadMarketplace();

    assert.equal(structuralRenders, 1);
    assert.equal(modal.state.busy, false);
    assert.deepEqual(modal.state.marketplace.repositories, []);
});
