import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../../services/document/markdownDocumentParser.js';
import { stripScriptaMetadataComments } from '../../utils/server/markdown-crdt/markdown-crdt-model.mjs';

test('parseMarkdownDocument converts plain markdown into visible chapters', () => {
    const markdown = [
        '# Project Title',
        '',
        'First paragraph.',
        '',
        '## Details',
        '',
        'Second paragraph.'
    ].join('\n');

    const document = parseMarkdownDocument(markdown);

    assert.equal(document.chapters.length, 2);
    assert.equal(document.chapters[0].heading.text, 'Project Title');
    assert.match(document.chapters[0].paragraphs[0].text, /First paragraph/);
    assert.equal(document.chapters[1].heading.text, 'Details');
    assert.match(document.chapters[1].paragraphs[0].text, /Second paragraph/);
});

test('plugin state preserves semantically meaningful empty strings', () => {
    const document = {
        metadata: { id: 'document-1' },
        chapters: [{
            id: 'chapter-1',
            heading: { level: 2, text: 'Chapter 1' },
            metadata: { id: 'chapter-1' },
            paragraphs: [{
                id: 'paragraph-1',
                text: '',
                metadata: {
                    id: 'paragraph-1',
                    pluginState: {
                        scripta: {
                            activeVariantId: 'variant-1',
                            variants: [{ id: 'variant-1', text: '' }],
                        },
                    },
                },
            }],
        }],
    };

    const parsed = parseMarkdownDocument(serializeMarkdownDocument(document));
    const variant = parsed.chapters[0].paragraphs[0]
        .metadata.pluginState.scripta.variants[0];

    assert.equal(Object.hasOwn(variant, 'text'), true);
    assert.equal(variant.text, '');
});

test('metadata stripping preserves user comments and content before SCRIPTA comments', () => {
    const source = [
        '<!-- Ana: verify achilles-ide-paragraph wording with the team -->',
        '',
        'Important user-authored note.',
        '',
        '<!-- {"achilles-ide-paragraph":{"id":"paragraph-1"}} -->',
        '',
        '<!-- <achilles-ide-references> -->',
        '',
        'Visible paragraph.',
    ].join('\n');

    const stripped = stripScriptaMetadataComments(source);

    assert.match(stripped, /Ana: verify achilles-ide-paragraph wording with the team/);
    assert.match(stripped, /Important user-authored note/);
    assert.match(stripped, /Visible paragraph/);
    assert.doesNotMatch(stripped, /"achilles-ide-paragraph":\{"id":"paragraph-1"\}/);
    assert.doesNotMatch(stripped, /<achilles-ide-references>/);
});
