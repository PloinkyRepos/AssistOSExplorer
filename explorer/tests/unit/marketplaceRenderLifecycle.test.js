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
        const fetchAdminControlProof = (...args) => globalThis.__marketplaceFetchAdminControlProof(...args);
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

test('Marketplace reads omit admin proof and mutations attach a fresh proof', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalProofFetcher = globalThis.__marketplaceFetchAdminControlProof;
    t.after(() => {
        globalThis.fetch = originalFetch;
        if (originalProofFetcher === undefined) delete globalThis.__marketplaceFetchAdminControlProof;
        else globalThis.__marketplaceFetchAdminControlProof = originalProofFetcher;
    });

    let proofCalls = 0;
    const calls = [];
    globalThis.__marketplaceFetchAdminControlProof = async () => {
        proofCalls += 1;
        return { origin: 'http://localhost:8082', csrfToken: `v1.proof-${proofCalls}` };
    };
    globalThis.fetch = async (path, options) => {
        calls.push({
            path,
            method: options.method || 'GET',
            headers: { ...options.headers },
            body: options.body
        });
        return {
            status: 200,
            ok: true,
            json: async () => ({ ok: true, marketplace: { agents: [] } })
        };
    };

    const {MarketplaceModal} = await loadMarketplaceModal();
    const modal = Object.create(MarketplaceModal.prototype);
    await modal.requestMarketplace();
    await modal.requestMarketplace({ action: 'enable_agent', agentRef: 'proxies/searchAgent' });

    assert.equal(proofCalls, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers['x-ploinky-csrf-token'], undefined);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].headers['x-ploinky-csrf-token'], 'v1.proof-1');
    assert.equal(calls[1].headers['Content-Type'], 'application/json');
    assert.equal(calls[1].body, JSON.stringify({ action: 'enable_agent', agentRef: 'proxies/searchAgent' }));
});

test('Marketplace retries once with a new proof only after csrf_invalid', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalProofFetcher = globalThis.__marketplaceFetchAdminControlProof;
    t.after(() => {
        globalThis.fetch = originalFetch;
        if (originalProofFetcher === undefined) delete globalThis.__marketplaceFetchAdminControlProof;
        else globalThis.__marketplaceFetchAdminControlProof = originalProofFetcher;
    });

    let proofCalls = 0;
    const suppliedProofs = [];
    globalThis.__marketplaceFetchAdminControlProof = async () => ({
        origin: 'http://localhost:8082',
        csrfToken: `v1.proof-${++proofCalls}`
    });
    globalThis.fetch = async (_path, options) => {
        suppliedProofs.push(options.headers['x-ploinky-csrf-token']);
        if (suppliedProofs.length === 1) {
            return {
                status: 403,
                ok: false,
                json: async () => ({ ok: false, error: 'csrf_invalid' })
            };
        }
        return {
            status: 200,
            ok: true,
            json: async () => ({ ok: true, marketplace: { agents: [] } })
        };
    };

    const {MarketplaceModal} = await loadMarketplaceModal();
    const modal = Object.create(MarketplaceModal.prototype);
    await modal.requestMarketplace({ action: 'enable_agent', agentRef: 'proxies/searchAgent' });

    assert.equal(proofCalls, 2);
    assert.deepEqual(suppliedProofs, ['v1.proof-1', 'v1.proof-2']);
});

test('Marketplace does not retry a rejected mutation for non-CSRF failures', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalProofFetcher = globalThis.__marketplaceFetchAdminControlProof;
    t.after(() => {
        globalThis.fetch = originalFetch;
        if (originalProofFetcher === undefined) delete globalThis.__marketplaceFetchAdminControlProof;
        else globalThis.__marketplaceFetchAdminControlProof = originalProofFetcher;
    });

    let proofCalls = 0;
    let mutationCalls = 0;
    globalThis.__marketplaceFetchAdminControlProof = async () => {
        proofCalls += 1;
        return { origin: 'http://localhost:8082', csrfToken: 'v1.proof' };
    };
    globalThis.fetch = async () => {
        mutationCalls += 1;
        return {
            status: 403,
            ok: false,
            json: async () => ({ ok: false, error: 'admin_required', message: 'Administrator access is required.' })
        };
    };

    const {MarketplaceModal} = await loadMarketplaceModal();
    const modal = Object.create(MarketplaceModal.prototype);
    await assert.rejects(
        modal.requestMarketplace({ action: 'enable_agent', agentRef: 'proxies/searchAgent' }),
        /Administrator access is required/
    );

    assert.equal(proofCalls, 1);
    assert.equal(mutationCalls, 1);
});
