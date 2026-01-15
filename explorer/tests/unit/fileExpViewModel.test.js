import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEntriesView } from '../../web-components/pages/file-exp/file-exp-view-model.js';

test('buildEntriesView renders a stable row snapshot', async () => {
    const state = {
        path: '/',
        entries: [
            {
                name: 'notes.txt',
                type: 'file',
                size: 12,
                modified: '2024-01-01',
                path: '/notes.txt'
            }
        ],
        selectedPath: '/notes.txt',
        openMenuPath: null,
        clipboard: null
    };
    const helpers = {
        joinPath: (base, name) => (base === '/' ? `/${name}` : `${base}/${name}`),
        formatBytes: (value) => `bytes:${value}`,
        formatDate: (value) => value
    };
    const html = buildEntriesView(state, helpers);
    const normalized = html.replace(/\s+/g, ' ').trim();

    const snapshotPath = path.join(path.dirname(new URL(import.meta.url).pathname), '__snapshots__', 'fileExpViewModel.snap');
    const expected = (await fs.readFile(snapshotPath, 'utf8')).trim();
    assert.equal(normalized, expected);
});
