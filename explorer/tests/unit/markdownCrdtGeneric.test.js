import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMarkdownCrdtStore } from '../../utils/server/markdown-crdt/markdown-crdt-store.mjs';

function computeTextDelta(previous, next) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
        previousEnd -= 1;
        nextEnd -= 1;
    }
    return {
        type: 'replaceTextRange',
        from: start,
        deleteCount: previousEnd - start,
        insertText: next.slice(start, nextEnd),
    };
}

async function createFixture() {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-markdown-crdt-'));
    const validatePath = async (input) => {
        const target = path.resolve(workspaceRoot, String(input || '').replace(/^\/+/, ''));
        if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
            throw new Error('Path outside workspace.');
        }
        return target;
    };
    const store = createMarkdownCrdtStore({
        fs,
        path,
        workspaceRoot,
        validatePath,
        writeFileContent: (target, content) => fs.writeFile(target, content, 'utf8'),
        invalidateCachesForPath() {},
    });
    return { workspaceRoot, store };
}

test('Markdown CRDT initialization persists document identity before returning', async () => {
    const { workspaceRoot, store } = await createFixture();
    const originalPath = path.join(workspaceRoot, 'notes.md');
    const renamedPath = path.join(workspaceRoot, 'renamed.md');
    try {
        await fs.writeFile(originalPath, '# Notes\n\nPortable text.\n', 'utf8');

        const opened = await store.open('/notes.md');
        const persisted = await fs.readFile(originalPath, 'utf8');
        assert.match(persisted, /<!--\s*\{"achilles-ide-document":/);
        assert.ok(persisted.includes(opened.documentId));

        await fs.rename(originalPath, renamedPath);
        const reopened = await store.open('/renamed.md');
        assert.equal(reopened.documentId, opened.documentId);
        assert.equal(reopened.path, renamedPath);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('plain Markdown changes based on the same heads converge instead of shifting offsets', async () => {
    const { workspaceRoot, store } = await createFixture();
    const documentPath = path.join(workspaceRoot, 'concurrent.md');
    try {
        await fs.writeFile(documentPath, '# Notes\n\nAlpha beta gamma.\n', 'utf8');
        const opened = await store.open('/concurrent.md');
        const firstText = opened.markdown.replace('Alpha', 'First Alpha');
        const secondText = opened.markdown.replace('gamma', 'final gamma');

        const first = await store.applyChange({
            documentId: opened.documentId,
            baseHeads: opened.heads,
            change: computeTextDelta(opened.markdown, firstText),
        });
        const second = await store.applyChange({
            documentId: opened.documentId,
            baseHeads: opened.heads,
            change: computeTextDelta(opened.markdown, secondText),
        });

        assert.ok(first.markdown.includes('First Alpha beta gamma.'));
        assert.ok(second.markdown.includes('First Alpha beta final gamma.'), second.markdown);
        assert.equal(second.heads.length, 2);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});
