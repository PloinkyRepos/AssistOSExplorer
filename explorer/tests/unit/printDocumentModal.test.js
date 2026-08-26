import test from 'node:test';
import assert from 'node:assert/strict';

import { PrintDocumentModal } from '../../web-components/modals/print-document-modal/print-document-modal.js';

test('print document HTML escapes plain SCRIPTA text at the rendering boundary', () => {
    const modal = Object.create(PrintDocumentModal.prototype);
    modal.document = {
        title: '<img src=x onerror="globalThis.compromised=true"> & Notes',
        abstract: '<script>globalThis.compromised=true</script>',
        chapters: [{
            title: 'Chapter <One> & "Review"',
            paragraphs: [{
                text: 'First line\n</p><script>globalThis.compromised=true</script>',
                commands: {},
            }],
        }],
    };

    const html = modal.generateHTMLFromDocument();

    assert.doesNotMatch(html, /<script>|<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.compromised=true&quot;&gt; &amp; Notes/);
    assert.match(html, /Chapter &lt;One&gt; &amp; &quot;Review&quot;/);
    assert.match(html, /First line<br>&lt;\/p&gt;&lt;script&gt;globalThis\.compromised=true&lt;\/script&gt;/);
});
