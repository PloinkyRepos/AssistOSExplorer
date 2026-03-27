import test from 'node:test';
import assert from 'node:assert/strict';

import DocumentFsService from '../../services/document/documentFsService.js';

class FakeDocumentFsService extends DocumentFsService {
    constructor() {
        super(null);
        this.dpuCalls = [];
        this.confidentialContent = '# Plan\n\nOriginal paragraph.';
        this.secretValue = 'initial-secret';
    }

    async callDpu(name, args = {}) {
        this.dpuCalls.push({ name, args });

        if (name === 'dpu_secret_get') {
            return {
                ok: true,
                secret: {
                    key: args.key,
                    valueVisible: true,
                    value: this.secretValue
                }
            };
        }

        if (name === 'dpu_secret_put') {
            this.secretValue = String(args.value ?? '');
            return {
                ok: true,
                secret: {
                    key: args.key,
                    canWrite: true,
                    valueVisible: true,
                    value: this.secretValue
                }
            };
        }

        if (name === 'dpu_workspace_roots') {
            return {
                ok: true,
                roots: {
                    mySpace: { id: 'root-1' }
                }
            };
        }

        if (name === 'dpu_confidential_list') {
            if (args.scope === 'shared') {
                return {
                    ok: true,
                    items: [
                        { id: 'folder-1', ownerId: 'owner@example.com', name: 'docs', type: 'folder' }
                    ]
                };
            }
            if (args.parentId === 'folder-1') {
                return {
                    ok: true,
                    items: [
                        { id: 'file-1', ownerId: 'owner@example.com', name: 'plan.md', type: 'file' }
                    ]
                };
            }
            return { ok: true, items: [] };
        }

        if (name === 'dpu_confidential_get') {
            return {
                ok: true,
                object: {
                    id: args.id,
                    type: 'file',
                    name: 'plan.md',
                    contentVisible: true,
                    content: this.confidentialContent
                }
            };
        }

        if (name === 'dpu_confidential_update') {
            this.confidentialContent = String(args.content ?? '');
            return {
                ok: true,
                object: {
                    id: args.id,
                    type: 'file',
                    name: 'plan.md',
                    contentVisible: true,
                    content: this.confidentialContent
                }
            };
        }

        throw new Error(`Unexpected DPU call: ${name}`);
    }
}

test('DocumentFsService reads and writes secrets through DPU tools', async () => {
    const service = new FakeDocumentFsService();

    const value = await service.readRaw('/Confidential/Secrets/API_KEY');
    assert.equal(value, 'initial-secret');

    await service.writeRaw('/Confidential/Secrets/API_KEY', 'updated-secret');
    assert.equal(service.secretValue, 'updated-secret');

    assert.deepEqual(
        service.dpuCalls.map((entry) => entry.name),
        ['dpu_secret_get', 'dpu_secret_put']
    );
});

test('DocumentFsService loads and saves confidential markdown documents through DPU', async () => {
    const service = new FakeDocumentFsService();
    const path = '/Confidential/Shared/docs/plan.md';

    const document = await service.readDocument(path);
    assert.equal(document.path, path);
    assert.match(document.raw, /Original paragraph/);
    assert.ok(document.document.chapters.length >= 1);

    document.document.chapters[0].paragraphs[0].text = 'Updated paragraph.';
    const serialized = await service.writeDocument(path, document.document);

    assert.match(serialized, /Updated paragraph/);
    assert.match(service.confidentialContent, /Updated paragraph/);
    assert.ok(
        service.dpuCalls.some((entry) => entry.name === 'dpu_confidential_get' && entry.args.id === 'file-1')
    );
    assert.ok(
        service.dpuCalls.some((entry) => entry.name === 'dpu_confidential_update' && entry.args.id === 'file-1')
    );
});

test('DocumentFsService accepts confidential file reads when get response omits the type but the path resolver identified a file', async () => {
    class MissingTypeDocumentFsService extends FakeDocumentFsService {
        async callDpu(name, args = {}) {
            if (name === 'dpu_confidential_get') {
                return {
                    ok: true,
                    object: {
                        id: args.id,
                        name: 'plan.md',
                        contentVisible: true,
                        content: this.confidentialContent
                    }
                };
            }
            return super.callDpu(name, args);
        }
    }

    const service = new MissingTypeDocumentFsService();
    const content = await service.readRaw('/Confidential/Shared/docs/plan.md');

    assert.match(content, /Original paragraph/);
});
