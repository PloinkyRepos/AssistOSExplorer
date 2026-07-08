import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateIdePlugins } from '../../utils/ide-plugins.mjs';
import { buildAgentSettingsItems } from '../../web-components/modals/settings-modal/settings-modal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const explorerRoot = path.resolve(__dirname, '../..');
const pluginRoot = path.join(explorerRoot, 'IDE-plugins', 'cloudflared-settings');

test('Explorer exposes cloudflared settings as an admin-only agent setting', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-cloudflared-settings-'));
    try {
        const explorerDir = path.join(workspaceRoot, 'explorer');
        const pluginDir = path.join(explorerDir, 'IDE-plugins', 'cloudflared-settings');
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(path.join(explorerDir, 'manifest.json'), JSON.stringify({
            ideSettings: [
                {
                    key: 'cloudflared',
                    label: 'Cloudflare Tunnel',
                    scope: 'workspace',
                    pluginKey: 'explorer/cloudflared-settings',
                    settingsComponent: 'cloudflared-settings',
                    adminOnly: true
                }
            ]
        }, null, 2));
        await fs.writeFile(path.join(pluginDir, 'config.json'), JSON.stringify({
            pluginCategory: 'application',
            id: 'cloudflared-settings',
            component: 'cloudflared-settings',
            presenter: 'CloudflaredSettings',
            label: 'Cloudflare Tunnel',
            location: [],
            type: 'global',
            adminOnly: true
        }, null, 2));

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const plugin = aggregated.application[''][0];
        const items = buildAgentSettingsItems(aggregated.agentSettings, [{
            key: 'explorer/cloudflared-settings',
            agent: plugin.agent,
            component: plugin.component,
            pluginId: plugin.id,
            settingsComponent: plugin.component,
            assetRootPath: plugin.assetRootPath,
            adminOnly: plugin.adminOnly
        }]);

        assert.equal(plugin.agent, 'explorer');
        assert.equal(plugin.id, 'cloudflared-settings');
        assert.equal(plugin.adminOnly, true);
        assert.equal(items[0].key, 'cloudflared');
        assert.equal(items[0].available, true);
        assert.equal(items[0].settingsComponent, 'cloudflared-settings');
        assert.equal(items[0].adminOnly, true);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('cloudflared settings plugin is hidden, admin-only, and uses router MCP helpers', () => {
    assert.equal(fsSync.existsSync(path.join(pluginRoot, 'config.json')), true);
    assert.equal(
        fsSync.existsSync(path.join(pluginRoot, 'cloudflared-settings', 'cloudflared-settings.js')),
        true
    );
    const config = JSON.parse(fsSync.readFileSync(path.join(pluginRoot, 'config.json'), 'utf8'));
    const source = fsSync.readFileSync(
        path.join(pluginRoot, 'cloudflared-settings', 'cloudflared-settings.js'),
        'utf8'
    );

    assert.equal(config.pluginCategory, 'application');
    assert.equal(config.id, 'cloudflared-settings');
    assert.equal(config.component, 'cloudflared-settings');
    assert.equal(config.presenter, 'CloudflaredSettings');
    assert.deepEqual(config.location, []);
    assert.equal(config.type, 'global');
    assert.equal(config.adminOnly, true);
    assert.match(source, /from '\/explorer\/services\/infrastructure\/explorerApi\.js'/);
    assert.match(source, /callAgentTool\('cloudflared'/);
    assert.doesNotMatch(source, /localhost:\d+|127\.0\.0\.1:\d+|host\.containers\.internal:\d+/);
});
