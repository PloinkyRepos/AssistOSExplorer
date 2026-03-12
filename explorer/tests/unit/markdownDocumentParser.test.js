import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../../services/document/markdownDocumentParser.js';

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

test('legacy achiles comments are accepted and serialized back as achilles comments', () => {
    const markdown = [
        '<!--{"achiles-ide-document":{"id":"doc-1","title":"Legacy Doc"}}-->',
        '<!--{"achiles-ide-chapter":{"title":"Intro"}}-->',
        '<!--{"achiles-ide-paragraph":{"title":"P1"}}-->',
        'Hello from legacy markdown.'
    ].join('\n');

    const document = parseMarkdownDocument(markdown);
    const serialized = serializeMarkdownDocument(document);

    assert.equal(document.metadata.id, 'doc-1');
    assert.equal(document.chapters[0].metadata.title, 'Intro');
    assert.equal(document.chapters[0].paragraphs[0].metadata.title, 'P1');
    assert.match(document.chapters[0].paragraphs[0].text, /Hello from legacy markdown/);
    assert.match(serialized, /achilles-ide-document/);
    assert.doesNotMatch(serialized, /achiles-ide-document/);
});
