import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aggregateIdePlugins } from '../../utils/ide-plugins.mjs';

async function writePluginConfig(rootDir, agentName, pluginName, config) {
    const pluginDir = path.join(rootDir, agentName, 'IDE-plugins', pluginName);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

test('aggregateIdePlugins accepts application plugins with global type and slot', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-ide-plugins-'));
    try {
        await writePluginConfig(workspaceRoot, 'webCli', 'webcli-global-chat', {
            pluginCategory: 'application',
            id: 'webcli-chat',
            component: 'webcli-global-chat',
            location: ['file-exp:global'],
            presenter: 'WebCliGlobalChat',
            type: 'global'
        });

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const globalPlugins = aggregated.application['file-exp:global'];

        assert.ok(Array.isArray(globalPlugins));
        assert.equal(globalPlugins.length, 1);
        assert.equal(globalPlugins[0].agent, 'webCli');
        assert.equal(globalPlugins[0].type, 'global');
        assert.equal(globalPlugins[0].component, 'webcli-global-chat');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('aggregateIdePlugins rejects global type for document plugins', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-ide-plugins-'));
    try {
        await writePluginConfig(workspaceRoot, 'badDocs', 'invalid-global-doc-plugin', {
            pluginCategory: 'document',
            component: 'invalid-global-doc-plugin',
            location: ['document'],
            presenter: 'InvalidGlobalDocPlugin',
            type: 'global'
        });

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const documentPlugins = aggregated.document.document || [];

        assert.equal(documentPlugins.length, 0);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('aggregateIdePlugins keeps application plugins with empty location for settings visibility', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-ide-plugins-'));
    try {
        await writePluginConfig(workspaceRoot, 'webCli', 'webcli-global-chat', {
            pluginCategory: 'application',
            id: 'webcli-chat',
            component: 'webcli-global-chat',
            location: [],
            presenter: 'WebCliGlobalChat',
            type: 'global'
        });

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const hiddenLocationPlugins = aggregated.application[''];

        assert.ok(Array.isArray(hiddenLocationPlugins));
        assert.equal(hiddenLocationPlugins.length, 1);
        assert.equal(hiddenLocationPlugins[0].agent, 'webCli');
        assert.equal(hiddenLocationPlugins[0].id, 'webcli-chat');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});
