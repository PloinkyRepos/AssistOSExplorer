import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMarkdownLink,
    buildMarkdownImageTarget,
    escapeMarkdownLabel,
    formatMarkdownDestination,
    getSelectedEditorText,
    validateMarkdownImage,
    validateMarkdownLinkDestination
} from '../../web-components/components/markdown-editor/markdown-editor-media.js';

test('buildMarkdownImageTarget creates a relative document asset path', () => {
    const file = { name: 'Architecture diagram.PNG', type: 'image/png', size: 1024 };
    assert.deepEqual(buildMarkdownImageTarget('/docs/Guide.md', file, 'abc123'), {
        assetDirectory: '/docs/Guide.assets',
        targetPath: '/docs/Guide.assets/Architecture-diagram-abc123.png',
        markdownPath: './Guide.assets/Architecture-diagram-abc123.png',
        altText: 'Architecture diagram'
    });
});

test('validateMarkdownImage rejects SVG and oversized images', () => {
    assert.throws(
        () => validateMarkdownImage({ name: 'unsafe.svg', type: 'image/svg+xml', size: 100 }),
        /Only PNG, JPEG, WebP, and GIF/
    );
    assert.throws(
        () => validateMarkdownImage({ name: 'large.png', type: 'image/png', size: 21 * 1024 * 1024 }),
        /20 MB/
    );
});

test('Markdown destinations and labels escape structural characters', () => {
    assert.equal(formatMarkdownDestination('docs/my image(1).png'), '<docs/my image(1).png>');
    assert.equal(escapeMarkdownLabel('A [diagram]'), 'A \\[diagram\\]');
});

test('buildMarkdownLink creates labels, relative links, and optional titles', () => {
    assert.equal(
        buildMarkdownLink({ label: 'Explorer', url: './docs/Explorer guide.md', title: 'Open "guide"' }),
        '[Explorer](<./docs/Explorer guide.md> "Open \\"guide\\"")'
    );
    assert.equal(buildMarkdownLink({ url: 'https://example.com' }), '[https://example.com](https://example.com)');
});

test('validateMarkdownLinkDestination rejects active URL schemes', () => {
    assert.equal(validateMarkdownLinkDestination('../guide.md'), '../guide.md');
    assert.throws(() => validateMarkdownLinkDestination('javascript:alert(1)'), /not supported/);
    assert.throws(() => validateMarkdownLinkDestination('data:text/html,test'), /not supported/);
});

test('getSelectedEditorText reads forward and reverse multiline selections', () => {
    const editor = { getContent: () => 'alpha\nbeta\ngamma' };
    const forward = {
        focus: { row: 0, col: 2 },
        anchor: { row: 1, col: 2 }
    };
    const reverse = { focus: forward.anchor, anchor: forward.focus };
    assert.equal(getSelectedEditorText(editor, forward), 'pha\nbe');
    assert.equal(getSelectedEditorText(editor, reverse), 'pha\nbe');
});
