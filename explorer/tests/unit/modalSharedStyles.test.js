import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('Explorer plugin stylesheet does not override shared modal padding', async () => {
    const commonCss = await fs.readFile(path.join(repoRoot, 'shared/ui/ui-common.css'), 'utf8');
    const pluginsCss = await fs.readFile(path.join(repoRoot, 'plugins.css'), 'utf8');
    const sharedModalRule = commonCss.match(/dialog\.modal\s*\{[^}]*\}/)?.[0] || '';

    assert.match(sharedModalRule, /padding:\s*var\(--space-xl\)/);
    assert.match(pluginsCss, /dialog:not\(\.modal\)\s*\{/);
    assert.doesNotMatch(pluginsCss, /dialog\s*\{[^}]*padding:\s*0\s*!important/i);
});

test('Explorer serves shared libraries from the whitelisted shared folder', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
    const mainSource = await fs.readFile(path.join(repoRoot, 'main.js'), 'utf8');
    const webskelSource = await fs.readFile(path.join(repoRoot, 'shared/libs/webskel/webskel.mjs'), 'utf8');
    const sharedRoute = manifest.routerAccess?.httpRoutes?.find((entry) => entry?.path === '/shared/*');
    const oldSharedRoutes = manifest.routerAccess?.httpRoutes?.filter((entry) => [
        '/ui-common.css'
    ].includes(entry?.path)) || [];

    assert.equal(sharedRoute?.access, 'public');
    assert.equal(oldSharedRoutes.length, 0);
    assert.match(mainSource, /from '\.\/shared\/libs\/webskel\/webskel\.mjs'/);
    assert.doesNotMatch(mainSource, /\/web-libs\/webskel/);
    assert.match(webskelSource, /\bWebSkel\b/);
    assert.match(webskelSource, /\bdefault\b/);
});

test('Explorer serves the reusable SCRIPTA variants component from the shared whitelist', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
    const componentRoot = path.join(repoRoot, 'shared/ui/scripta-variants-view');
    const [template, styles, source] = await Promise.all([
        fs.readFile(path.join(componentRoot, 'scripta-variants-view.html'), 'utf8'),
        fs.readFile(path.join(componentRoot, 'scripta-variants-view.css'), 'utf8'),
        fs.readFile(path.join(componentRoot, 'scripta-variants-view.js'), 'utf8')
    ]);

    assert.equal(manifest.routerAccess?.httpRoutes?.find((entry) => entry?.path === '/shared/*')?.access, 'public');
    assert.match(template, /scripta-variants-view-root/);
    assert.match(source, /data-scripta-action="cancel-edit"/);
    assert.match(source, /editingVariantId/);
    assert.match(source, /Empty paragraph — click to add text\./);
    assert.doesNotMatch(source, /scripta-edit-button/);
    assert.match(source, /<div class="scripta-panel-header">/);
    assert.doesNotMatch(source, /<header class="scripta-panel-header">/);
    assert.match(source, /class="scripta-variant-text[\s\S]*data-scripta-action="edit"/);
    assert.doesNotMatch(styles, /\.scripta-tab\.is-active/);
    assert.match(source, /scripta-tab-active-icon/);
    assert.doesNotMatch(source, /scripta-tab-score/);
    assert.doesNotMatch(styles, /\.scripta-tab-score/);
    assert.match(source, /export class ScriptaVariantsView/);
    assert.match(source, /scripta-p-variant-vote/);
    assert.match(source, /scripta-p-variant-select/);
    assert.match(source, /scripta-p-variant-edit-start/);
    assert.match(source, /scripta-p-variant-edit-draft/);
    assert.match(source, /scripta-p-variant-edit-cancel/);
    assert.match(source, /scripta-p-variant-edit/);
    assert.match(source, /scripta-p-variant-add/);
    assert.match(source, /scripta-p-variant-delete/);
    assert.match(source, /variant\.canEdit/);
    assert.match(source, /variant\.canDelete/);
    assert.match(
        source,
        /<div class="scripta-panel-header">[\s\S]*class="scripta-reaction-actions"[\s\S]*class="scripta-variant-delete-button"[\s\S]*<\/div>\s*\$\{this\.renderVoters/
    );
    assert.match(styles, /\.scripta-variant-delete-button\s*\{\s*margin-left:\s*auto;/);
});
