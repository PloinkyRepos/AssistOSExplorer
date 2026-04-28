import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DPU_SECRETS_PATH,
    createDpuFile,
    deleteDpuEntry,
    getDpuPathCapabilities,
    readConfidentialUploadPayload,
    renameDpuEntry
} from '../../web-components/pages/file-exp/file-exp-dpu-provider.js';

function createFakeFileExp() {
    const invalidated = [];
    return {
        __dpuVirtualState: null,
        invalidated,
        normalizePath(value) {
            const input = String(value || '').replace(/\/+/g, '/');
            if (!input || input === '/') return '/';
            return input.startsWith('/') ? input.replace(/\/$/, '') || '/' : `/${input.replace(/\/$/, '')}`;
        },
        joinPath(base, name) {
            const normalizedBase = this.normalizePath(base);
            const normalizedName = String(name || '').replace(/^\/+/, '');
            return normalizedBase === '/' ? `/${normalizedName}` : `${normalizedBase}/${normalizedName}`;
        },
        parentPath(value) {
            const normalized = this.normalizePath(value);
            if (normalized === '/') return '/';
            const index = normalized.lastIndexOf('/');
            return index <= 0 ? '/' : normalized.slice(0, index);
        },
        caches: {
            dirListing: {
                invalidate(_host, path) {
                    invalidated.push({ type: 'dir', path });
                }
            },
            filePreview: {
                invalidateForPath(path) {
                    invalidated.push({ type: 'preview', path });
                }
            }
        }
    };
}

function withMockDpuClient(handler) {
    const previousWindow = globalThis.window;
    globalThis.window = {
        webSkel: {
            appServices: {
                getClient(agentName) {
                    if (agentName !== 'dpuAgent') return null;
                    return {
                        async callTool(name, args) {
                            return handler(name, args);
                        }
                    };
                }
            }
        }
    };
    return () => {
        globalThis.window = previousWindow;
    };
}

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

test('getDpuPathCapabilities reports Secrets root as file-create-only', async () => {
    const restoreWindow = withMockDpuClient(async (name) => {
        if (name === 'dpu_workspace_roots') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, roots: { mySpace: { id: 'root-1' } } }) }]
            };
        }
        throw new Error(`Unexpected tool: ${name}`);
    });

    try {
        const fileExp = createFakeFileExp();
        const capabilities = await getDpuPathCapabilities(fileExp, DPU_SECRETS_PATH);

        assert.equal(capabilities.isDpu, true);
        assert.equal(capabilities.canWrite, true);
        assert.equal(capabilities.canCreateFiles, true);
        assert.equal(capabilities.canCreateDirectories, false);
        assert.equal(capabilities.canRename, false);
        assert.equal(capabilities.canDelete, false);
    } finally {
        restoreWindow();
    }
});

test('createDpuFile creates a secret when parent path is /Confidential/Secrets', async () => {
    const calls = [];
    const restoreWindow = withMockDpuClient(async (name, args) => {
        calls.push({ name, args });
        if (name === 'dpu_secret_put') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, secret: { key: args.key, value: args.value } }) }]
            };
        }
        throw new Error(`Unexpected tool: ${name}`);
    });

    try {
        const fileExp = createFakeFileExp();
        const created = await createDpuFile(fileExp, DPU_SECRETS_PATH, 'API_KEY', { content: 'secret-value' });

        assert.deepEqual(created, {
            key: 'API_KEY',
            name: 'API_KEY',
            path: `${DPU_SECRETS_PATH}/API_KEY`,
            type: 'file'
        });
        assert.deepEqual(calls, [
            {
                name: 'dpu_secret_put',
                args: {
                    key: 'API_KEY',
                    displayName: 'API_KEY',
                    value: 'secret-value'
                }
            }
        ]);
        assert.ok(fileExp.invalidated.some((entry) => entry.path === DPU_SECRETS_PATH));
    } finally {
        restoreWindow();
    }
});

test('createDpuFile derives a strict key while preserving secret display name', async () => {
    const calls = [];
    const restoreWindow = withMockDpuClient(async (name, args) => {
        calls.push({ name, args });
        if (name === 'dpu_secret_put') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, secret: { key: args.key, displayName: args.displayName, value: args.value } }) }]
            };
        }
        throw new Error(`Unexpected tool: ${name}`);
    });

    try {
        const fileExp = createFakeFileExp();
        const created = await createDpuFile(fileExp, DPU_SECRETS_PATH, 'secret 3', { content: 'value' });

        assert.deepEqual(created, {
            key: 'secret_3',
            name: 'secret 3',
            path: `${DPU_SECRETS_PATH}/secret_3`,
            type: 'file'
        });
        assert.deepEqual(calls, [
            {
                name: 'dpu_secret_put',
                args: {
                    key: 'secret_3',
                    displayName: 'secret 3',
                    value: 'value'
                }
            }
        ]);
    } finally {
        restoreWindow();
    }
});

test('renameDpuEntry rejects secret keys as non-renamable file-like entries', async () => {
    const restoreWindow = withMockDpuClient(async (name) => {
        if (name === 'dpu_secret_list') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, secrets: [{ key: 'API_KEY', canWrite: true }] }) }]
            };
        }
        throw new Error(`Unexpected tool: ${name}`);
    });

    try {
        const fileExp = createFakeFileExp();
        await assert.rejects(
            () => renameDpuEntry(fileExp, `${DPU_SECRETS_PATH}/API_KEY`, 'RENAMED_KEY'),
            /Secret keys cannot be renamed/
        );
    } finally {
        restoreWindow();
    }
});

test('deleteDpuEntry deletes secrets through dpu_secret_delete', async () => {
    const calls = [];
    const restoreWindow = withMockDpuClient(async (name, args) => {
        calls.push({ name, args });
        if (name === 'dpu_secret_list') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true, secrets: [{ key: 'API_KEY', canWrite: true }] }) }]
            };
        }
        if (name === 'dpu_secret_delete') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
            };
        }
        throw new Error(`Unexpected tool: ${name}`);
    });

    try {
        const fileExp = createFakeFileExp();
        const result = await deleteDpuEntry(fileExp, `${DPU_SECRETS_PATH}/API_KEY`);

        assert.equal(result, true);
        assert.deepEqual(
            calls.map((entry) => entry.name),
            ['dpu_secret_list', 'dpu_secret_delete']
        );
        assert.deepEqual(calls.at(-1)?.args, { key: 'API_KEY' });
        assert.ok(fileExp.invalidated.some((entry) => entry.path === DPU_SECRETS_PATH));
    } finally {
        restoreWindow();
    }
});
