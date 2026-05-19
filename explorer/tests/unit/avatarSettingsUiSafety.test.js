import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('avatar settings escapes manifest agent ids before interpolating local actions', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../web-components/modals/settings-modal/settings-modal.js'),
        'utf8'
    );

    assert.match(source, /data-local-action="selectAvatarAgent \$\{escapeHtml\(item\.id\)\}"/);
    assert.doesNotMatch(source, /data-local-action="selectAvatarAgent \$\{item\.id\}"/);
});
