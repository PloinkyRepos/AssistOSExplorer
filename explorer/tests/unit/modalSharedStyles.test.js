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
