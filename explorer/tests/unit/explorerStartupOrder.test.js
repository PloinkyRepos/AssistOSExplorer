import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const explorerRoot = path.resolve(import.meta.dirname, '..', '..');

test('file explorer mounts before runtime plugin discovery completes', () => {
    const source = fs.readFileSync(path.join(explorerRoot, 'main.js'), 'utf8');
    const mountIndex = source.indexOf('await mountInitialApplicationRoute({');
    const deferredRuntimeIndex = source.indexOf('Promise.all([\n                waitForAgentRuntimeAvailability({', mountIndex);

    assert.ok(mountIndex > 0);
    assert.ok(deferredRuntimeIndex > mountIndex);
    assert.match(source, /const isFileExplorerRoute = !roomEntry && pageName === 'file-exp'/);
    assert.match(source, /const \[explorerManifest, pluginPayload, pluginSettingsResult, authenticatedUser\] = await Promise\.all/);
    assert.match(source, /RUNTIME_PLUGIN_MOUNT_GRACE_MS = 2500/);
    assert.match(source, /label: 'Explorer plugins',\s*operation: loadRuntimeContext/);
    assert.doesNotMatch(source, /runtimePluginLoader\.loadComponents\(/);
});

test('initial route replaces the static spinner before WebSkel mounts its loader', () => {
    const source = fs.readFileSync(path.join(explorerRoot, 'main.js'), 'utf8');
    const removeIndex = source.indexOf('loader?.remove?.();');
    const mountIndex = source.indexOf('await mountInitialApplicationRoute({');

    assert.ok(removeIndex > 0);
    assert.ok(mountIndex > removeIndex);
});

test('file explorer refreshes plugin slots when deferred discovery completes', () => {
    const mainSource = fs.readFileSync(path.join(explorerRoot, 'main.js'), 'utf8');
    const hostSource = fs.readFileSync(
        path.join(explorerRoot, 'web-components', 'pages', 'file-exp', 'file-exp-application-plugins.js'),
        'utf8'
    );

    assert.match(mainSource, /assistos:runtime-plugins-updated/);
    assert.match(hostSource, /assistos:runtime-plugins-updated/);
});

test('optional plugin failures do not reject file explorer rendering', () => {
    const hostSource = fs.readFileSync(
        path.join(explorerRoot, 'web-components', 'pages', 'file-exp', 'file-exp-application-plugins.js'),
        'utf8'
    );
    const layoutSource = fs.readFileSync(
        path.join(explorerRoot, 'web-components', 'pages', 'file-exp', 'file-exp-layout-controller.js'),
        'utf8'
    );

    assert.match(hostSource, /try \{\s*await ensureRuntimeComponent\(plugin\.component\);\s*\} catch \(error\)/);
    assert.match(layoutSource, /renderApplicationPluginSlots\(fileExp\)\.catch/);
    assert.doesNotMatch(layoutSource, /await renderApplicationPluginSlots\(fileExp\)/);
});
