import assert from 'node:assert/strict';
import test from 'node:test';

import { getNewFileInitialContent } from '../../services/onlyoffice/onlyoffice-new-file-content.js';

test('new .doc files are initialized with a valid blank RTF document', () => {
    const initialContent = getNewFileInitialContent('draft.doc');
    const decodedDpuContent = Buffer.from(initialContent.dpuContent, 'base64').toString('utf8');

    assert.equal(initialContent.mimeType, 'application/msword');
    assert.match(initialContent.content, /^\{\\rtf1\\ansi/);
    assert.match(initialContent.content, /\\pard\\f0\\fs22\\par/);
    assert.equal(decodedDpuContent, initialContent.content);
});

test('new non-Office files keep the existing empty-text initialization', () => {
    assert.deepEqual(getNewFileInitialContent('notes.md'), {
        content: '',
        dpuContent: '',
        mimeType: ''
    });
});

