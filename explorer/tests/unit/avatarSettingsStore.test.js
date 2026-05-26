import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createAvatarSettingsStore,
    normalizeAxiFaceConfig,
    validateAxiFaceConfig
} from '../../utils/server/avatar-settings/avatar-settings-store.mjs';

async function createTempWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-settings-'));
    await fs.mkdir(path.join(root, 'explorer'), { recursive: true });
    await fs.writeFile(path.join(root, 'explorer/manifest.json'), JSON.stringify({
        enable: [
            'gitAgent global',
            { agent: 'llmAssistant global', profile: 'embedded' },
            { agent: 'webAssist', profile: 'embedded' },
            'webmeetAgent global'
        ]
    }, null, 2));
    await fs.mkdir(path.join(root, 'llmAssistant'), { recursive: true });
    await fs.writeFile(path.join(root, 'llmAssistant/manifest.json'), JSON.stringify({
        avatar: {
            generated: true,
            style: 'emoji',
            palette: 'sunset',
            emotion: 'happy'
        }
    }, null, 2));
    return root;
}

test('normalizes AxiFace config and rejects unknown or unsafe fields', () => {
    const config = normalizeAxiFaceConfig({
        agentId: 'agent-a',
        sourceMode: 'pack',
        generated: true,
        emotion: 'happy',
        assetMode: 'inline',
        packSrc: '/axi-face/packs/robot-soft/manifest.json'
    });

    assert.equal(config.agentId, 'agent-a');
    assert.equal(config.sourceMode, 'pack');
    assert.equal(config.generated, false);
    assert.equal(config.emotion, 'happy');
    assert.equal(config.assetMode, 'inline');
    assert.throws(() => normalizeAxiFaceConfig({ unknown: true }), /Unknown avatar config field/);
    assert.throws(() => normalizeAxiFaceConfig({ src: 'javascript:alert(1)' }), /unsafe URL/);
    assert.throws(() => normalizeAxiFaceConfig({ packSrc: 'http://example.com/pack.json' }), /HTTPS/);
});

test('lists AI agents from manifest and applies saved overrides', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = createAvatarSettingsStore({ fs: await import('node:fs'), path, workspaceRoot });

    let agents = await store.listAgents();
    assert.deepEqual(agents.map((agent) => agent.id), ['llmAssistant', 'webAssist']);
    const defaultLlm = agents.find((agent) => agent.id === 'llmAssistant');
    assert.equal(defaultLlm.config.generated, true);
    assert.equal(defaultLlm.config.style, 'emoji');
    assert.equal(defaultLlm.config.palette, 'sunset');

    await store.updateAgent('llmAssistant', {
        generated: true,
        style: 'terminal',
        palette: 'terminal',
        emotion: 'thinking'
    });
    await store.setAgentVisibility('llmAssistant', false);

    agents = await store.listAgents();
    const llm = agents.find((agent) => agent.id === 'llmAssistant');
    assert.equal(llm.config.style, 'terminal');
    assert.equal(llm.enabled, false);
});

test('keeps saved agent override as missing when it is no longer in manifest', async () => {
    const workspaceRoot = await createTempWorkspace();
    const store = createAvatarSettingsStore({ fs: await import('node:fs'), path, workspaceRoot });
    await store.updateAgent('removedAgent', { generated: true, emotion: 'alert' });

    const agents = await store.listAgents();
    const removed = agents.find((agent) => agent.id === 'removedAgent');

    assert.equal(removed.missing, true);
    assert.equal(removed.config.emotion, 'alert');
});

test('reads manifest from Ploinky repo workspace layout', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-settings-ploinky-'));
    const manifestDir = path.join(workspaceRoot, '.ploinky/repos/AchillesIDE/explorer');
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({
        enable: [{ agent: 'webAssist', profile: 'embedded' }]
    }, null, 2));

    const store = createAvatarSettingsStore({ fs: await import('node:fs'), path, workspaceRoot });
    const agents = await store.listAgents();

    assert.deepEqual(agents.map((agent) => agent.id), ['webAssist']);
});

test('rejects unsafe inline SVG sources during backend validation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('<svg onclick="alert(1)"></svg>', {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' }
    });

    try {
        await assert.rejects(
            () => validateAxiFaceConfig({
                agentId: 'agent-a',
                assetMode: 'inline',
                src: '/avatars/unsafe.svg'
            }, {
                assetBaseUrl: 'http://127.0.0.1:8080',
                assetLoader: {
                    resolveRelativeUrl: (baseUrl, relativeUrl) => new URL(relativeUrl, baseUrl).href,
                    loadInlineSvg: async (src, fetchImpl) => {
                        const response = await fetchImpl(src);
                        const text = await response.text();
                        if (/\son[a-z]+\s*=/i.test(text)) {
                            throw new Error('Inline SVG contains inline event handlers.');
                        }
                        return text;
                    }
                }
            }),
            /Inline SVG contains inline event handlers/
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
