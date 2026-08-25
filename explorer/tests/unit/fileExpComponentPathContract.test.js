import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const previewRendererSource = fs.readFileSync(
    new URL('../../web-components/pages/file-exp/file-exp-preview-renderer.js', import.meta.url),
    'utf8',
);
const fileEditorSource = fs.readFileSync(
    new URL('../../web-components/components/file-editor/file-editor.js', import.meta.url),
    'utf8',
);

test('file preview components do not use WebSkel reserved data-path for component state', () => {
    assert.doesNotMatch(previewRendererSource, /['"]data-path['"]|\bdata-path=/);
    assert.match(previewRendererSource, /['"]data-file-path['"]|\bdata-file-path=/);
    assert.match(fileEditorSource, /dataset\.filePath/);
    assert.doesNotMatch(fileEditorSource, /dataset\.path\b/);
});
