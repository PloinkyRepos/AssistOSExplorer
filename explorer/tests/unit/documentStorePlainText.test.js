import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeDocumentModel } from '../../services/document/local/documentStore.js';

test('document persistence preserves plain text and plugin state without entity decoding', () => {
    const serialized = serializeDocumentModel({
        id: 'document-1',
        metadata: {id: 'document-1'},
        title: 'Title &lt;literal&gt; & <raw>',
        infoText: 'Info &amp; literal <script>text only</script>',
        commands: '',
        comments: {messages: []},
        pluginState: {scripta: {label: '&lt;keep&gt;'}},
        chapters: [{
            id: 'chapter-1',
            metadata: {id: 'chapter-1'},
            title: 'Chapter &lt;one&gt; & <two>',
            headingText: 'Chapter &lt;one&gt; & <two>',
            headingLevel: 2,
            leading: 'Leading &nbsp; literal',
            commands: '',
            comments: {messages: []},
            pluginState: {},
            paragraphs: [{
                id: 'paragraph-1',
                metadata: {id: 'paragraph-1'},
                text: 'Paragraph &lt;literal&gt; & <script>text only</script>',
                leading: 'Before &amp;',
                trailing: 'After &gt;',
                commands: '',
                comments: {messages: []},
                pluginState: {scripta: {variants: [{text: '&lt;variant&gt;'}]}},
            }],
        }],
    });

    assert.equal(serialized.metadata.title, 'Title &lt;literal&gt; & <raw>');
    assert.equal(serialized.metadata.infoText, 'Info &amp; literal <script>text only</script>');
    assert.equal(serialized.metadata.pluginState.scripta.label, '&lt;keep&gt;');
    assert.equal(serialized.chapters[0].metadata.title, 'Chapter &lt;one&gt; & <two>');
    assert.equal(serialized.chapters[0].leading, 'Leading &nbsp; literal');
    assert.equal(serialized.chapters[0].paragraphs[0].text, 'Paragraph &lt;literal&gt; & <script>text only</script>');
    assert.equal(serialized.chapters[0].paragraphs[0].metadata.pluginState.scripta.variants[0].text, '&lt;variant&gt;');
});
