import test from 'node:test';
import assert from 'node:assert/strict';

import { readConfidentialUploadPayload } from '../../web-components/pages/file-exp/file-exp-dpu-provider.js';

test('readConfidentialUploadPayload keeps text uploads as plain text', async () => {
    const payload = await readConfidentialUploadPayload({
        name: 'notes.md',
        type: 'text/markdown',
        async text() {
            return '# Notes';
        }
    });

    assert.deepEqual(payload, {
        content: '# Notes',
        mimeType: 'text/markdown',
        isBinary: false
    });
});

test('readConfidentialUploadPayload encodes binary uploads as base64', async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    const payload = await readConfidentialUploadPayload({
        name: 'archive.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
    });

    assert.deepEqual(payload, {
        content: 'UEsDBA==',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        isBinary: true
    });
});

test('readConfidentialUploadPayload falls back to application/octet-stream for binary files without type', async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    const payload = await readConfidentialUploadPayload({
        name: 'scan.pdf',
        type: '',
        async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
    });

    assert.equal(payload.content, 'JVBERg==');
    assert.equal(payload.mimeType, 'application/octet-stream');
    assert.equal(payload.isBinary, true);
});
