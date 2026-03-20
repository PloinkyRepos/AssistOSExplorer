import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeDirectoryEntry } from '../../utils/filesystem-utils.mjs';

test('describeDirectoryEntry resolves symlink targets as file or directory', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-explorer-symlink-'));

    await t.test('symlink to file is reported as file', async () => {
        const filePath = path.join(tempRoot, 'notes.txt');
        const linkPath = path.join(tempRoot, 'notes-link.txt');

        await fs.writeFile(filePath, 'hello', 'utf8');
        await fs.symlink(filePath, linkPath);

        const entry = await describeDirectoryEntry(tempRoot, { name: 'notes-link.txt' });
        assert.equal(entry.type, 'file');
        assert.equal(entry.isSymlink, true);
        assert.ok(entry.linkTarget);
    });

    await t.test('symlink to directory is reported as directory', async () => {
        const dirPath = path.join(tempRoot, 'docs');
        const linkPath = path.join(tempRoot, 'docs-link');

        await fs.mkdir(dirPath, { recursive: true });
        await fs.symlink(dirPath, linkPath);

        const entry = await describeDirectoryEntry(tempRoot, { name: 'docs-link' });
        assert.equal(entry.type, 'directory');
        assert.equal(entry.isSymlink, true);
        assert.ok(entry.linkTarget);
    });

    await fs.rm(tempRoot, { recursive: true, force: true });
});
