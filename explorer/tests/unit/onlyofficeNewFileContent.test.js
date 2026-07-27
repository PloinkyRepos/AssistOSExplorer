import assert from 'node:assert/strict';
import test from 'node:test';

import { getNewFileInitialContent } from '../../services/onlyoffice/onlyoffice-new-file-content.js';

test('new Confidential DOCX files contain a valid minimal Open XML package', () => {
    const generated = getNewFileInitialContent('blank.docx');
    const bytes = Buffer.from(generated.dpuContent, 'base64');
    const text = bytes.toString('utf8');

    assert.equal(
        generated.mimeType,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304');
    assert.equal(bytes.subarray(-22, -18).toString('hex'), '504b0506');
    assert.match(text, /\[Content_Types\]\.xml/);
    assert.match(text, /_rels\/\.rels/);
    assert.match(text, /word\/document\.xml/);
    assert.match(text, /officeDocument\/2006\/relationships\/officeDocument/);
});
