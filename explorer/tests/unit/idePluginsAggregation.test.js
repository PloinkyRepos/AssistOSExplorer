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

test('aggregateIdePlugins follows symlinked repos under .ploinky/repos', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-ide-plugins-workspace-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-ide-plugins-source-'));
    try {
        await writePluginConfig(sourceRoot, 'gitAgent', 'git-tool-button', {
            pluginCategory: 'application',
            id: 'git',
            component: 'git-tool-button',
            location: ['file-exp:toolbar'],
            presenter: 'GitToolButton',
            type: 'embedded'
        });

        const reposRoot = path.join(workspaceRoot, '.ploinky', 'repos');
        await fs.mkdir(reposRoot, { recursive: true });
        await fs.symlink(sourceRoot, path.join(reposRoot, 'AssistOSExplorer'));

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const toolbarPlugins = aggregated.application['file-exp:toolbar'] || [];

        assert.equal(toolbarPlugins.length, 1);
        assert.equal(toolbarPlugins[0].agent, 'gitAgent');
        assert.equal(toolbarPlugins[0].id, 'git');
        assert.equal(toolbarPlugins[0].component, 'git-tool-button');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
        await fs.rm(sourceRoot, { recursive: true, force: true });
    }
});
