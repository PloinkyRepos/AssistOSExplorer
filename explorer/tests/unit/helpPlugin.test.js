import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { aggregateIdePlugins } from '../../utils/ide-plugins.mjs';
import { normalizeRuntimePlugins } from '../../utils/pluginUtils.core.js';
import {
    HELP_TABS,
    normalizeHelpTab
} from '../../IDE-plugins/help/components/help-modal/help-modal.js';

const explorerRoot = path.resolve(import.meta.dirname, '../..');
const repoRoot = path.resolve(explorerRoot, '..');
const helpRoot = path.join(explorerRoot, 'IDE-plugins/help');

test('Help plugin is a discoverable Explorer toolbar application with a modal dependency', async () => {
    const [config, manifest] = await Promise.all([
        fs.readFile(path.join(helpRoot, 'config.json'), 'utf8').then(JSON.parse),
        fs.readFile(path.join(explorerRoot, 'manifest.json'), 'utf8').then(JSON.parse)
    ]);

    assert.equal(config.pluginCategory, 'application');
    assert.equal(config.id, 'help');
    assert.equal(config.component, 'help-tool-button');
    assert.deepEqual(config.location, ['file-exp:toolbar']);
    assert.equal(config.locationOrder, 400);
    assert.equal(config.label, 'Help');
    assert.equal(config.type, 'embedded');
    assert.deepEqual(config.dependencies, [{
        component: 'help-modal',
        presenter: 'HelpModal',
        type: 'modal'
    }]);
    assert.equal(manifest.applicationPlugins.help, true);

    const aggregated = await aggregateIdePlugins(repoRoot);
    const helpPlugin = (aggregated.application['file-exp:toolbar'] || [])
        .find((plugin) => plugin.agent === 'explorer' && plugin.id === 'help');

    assert.ok(helpPlugin);
    assert.equal(helpPlugin.component, 'help-tool-button');
    assert.equal(helpPlugin.dependencies[0].component, 'help-modal');

    const normalized = normalizeRuntimePlugins(aggregated);
    const toolbarPluginIds = (normalized.application['file-exp:toolbar'] || [])
        .map((plugin) => plugin.id);
    assert.deepEqual(toolbarPluginIds, ['git', 'marketplace', 'webmeet', 'help']);
});

test('Help modal exposes the six documented, accessible topics', async () => {
    const template = await fs.readFile(
        path.join(helpRoot, 'components/help-modal/help-modal.html'),
        'utf8'
    );

    assert.deepEqual(HELP_TABS, [
        'explorer',
        'git',
        'webmeet',
        'confidential',
        'copilot',
        'admin'
    ]);

    for (const tab of HELP_TABS) {
        assert.match(template, new RegExp(`id="help-tab-${tab}"[^>]*role="tab"`));
        assert.match(template, new RegExp(`id="help-panel-${tab}"[^>]*role="tabpanel"`));
        assert.match(template, new RegExp(`aria-controls="help-panel-${tab}"`));
        assert.match(template, new RegExp(`aria-labelledby="help-tab-${tab}"`));
    }

    assert.equal(normalizeHelpTab('Git'), 'git');
    assert.equal(normalizeHelpTab('unknown'), 'explorer');
    assert.equal(normalizeHelpTab(null), 'explorer');
});

test('Help guidance identifies domain ownership without adding a runtime data dependency', async () => {
    const [template, modalSource, buttonSource, styles] = await Promise.all([
        fs.readFile(path.join(helpRoot, 'components/help-modal/help-modal.html'), 'utf8'),
        fs.readFile(path.join(helpRoot, 'components/help-modal/help-modal.js'), 'utf8'),
        fs.readFile(path.join(helpRoot, 'help-tool-button.js'), 'utf8'),
        fs.readFile(path.join(helpRoot, 'components/help-modal/help-modal.css'), 'utf8')
    ]);

    assert.match(template, /gitAgent/);
    assert.match(template, /dpuAgent/);
    assert.match(template, /AchillesCLI manages Copilot/);
    assert.match(template, /separate agents from Explorer/);
    assert.match(template, /Administration controls are shown only to authorized users/);
    assert.doesNotMatch(modalSource, /\bfetch\s*\(|callAgentTool|callExplorerTool/);
    assert.match(modalSource, /ArrowRight/);
    assert.match(modalSource, /ArrowLeft/);
    assert.match(modalSource, /Home/);
    assert.match(modalSource, /End/);
    assert.match(buttonSource, /createReactiveModal\('help-modal'/);
    assert.match(buttonSource, /this\.button\?\.focus/);
    assert.match(styles, /@media \(max-width: 720px\)/);
});
