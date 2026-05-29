import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('avatar settings escapes manifest agent ids before interpolating local actions', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../web-components/modals/settings-modal/settings-avatar-controller.js'),
        'utf8'
    );

    assert.match(source, /data-local-action="selectAvatarAgent \$\{escapeHtml\(item\.id\)\}"/);
    assert.doesNotMatch(source, /data-local-action="selectAvatarAgent \$\{item\.id\}"/);
});

test('avatar settings use shared source-mode form for profile and agent avatars', async () => {
    const html = await fs.readFile(
        path.resolve(import.meta.dirname, '../../web-components/modals/settings-modal/settings-modal.html'),
        'utf8'
    );
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../web-components/modals/settings-modal/settings-avatar-controller.js'),
        'utf8'
    );

    assert.match(html, /data-avatar-tab="profile"/);
    assert.match(html, /data-avatar-tab="agent"/);
    assert.match(html, /<avatar-settings-form[^>]+data-avatar-scope="profile"/);
    assert.match(html, /<avatar-settings-form[^>]+data-avatar-scope="agent"/);
    assert.match(source, /shared\/ui\/avatar-settings-form\/avatar-settings-form/);
    assert.match(source, /ensureAvatarSettingsFormRegistered/);
    assert.match(source, /loadAxiFacePacks/);
    assert.doesNotMatch(source, /AVATAR_FIELD_DEFS/);
});

test('avatar settings hidden panels are not overridden by card layout CSS', async () => {
    const css = await fs.readFile(
        path.resolve(import.meta.dirname, '../../web-components/modals/settings-modal/settings-modal.css'),
        'utf8'
    );

    assert.match(css, /\[data-avatar-panel\]\[hidden\][\s\S]*display: none !important/);
    assert.match(css, /\.avatar-subtab\[hidden\]/);
});
