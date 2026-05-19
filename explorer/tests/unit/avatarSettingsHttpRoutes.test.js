import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAvatarSettingsHttpHandler } from '../../utils/server/avatar-settings/avatar-settings-http-routes.mjs';

async function createTempWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-settings-http-'));
    await fs.mkdir(path.join(root, 'explorer'), { recursive: true });
    await fs.writeFile(path.join(root, 'explorer/manifest.json'), JSON.stringify({
        enable: ['llmAssistant global']
    }, null, 2));
    return root;
}

function createFakeDpuClientFactory(state) {
    return () => ({
        async callTool(name, args = {}) {
            switch (name) {
                case 'dpu_workspace_roots':
                    return { ok: true, roots: { mySpace: { id: 'root-1' } } };
                case 'dpu_confidential_list':
                    if (args.parentId === 'folder-1') {
                        return {
                            ok: true,
                            items: state.file
                                ? [{ id: 'file-1', name: 'avatar-config.json', type: 'file' }]
                                : []
                        };
                    }
                    return {
                        ok: true,
                        items: state.folder
                            ? [{ id: 'folder-1', name: 'profile', type: 'folder' }]
                            : []
                    };
                case 'dpu_confidential_get':
                    assert.equal(args.id, 'file-1');
                    return {
                        ok: true,
                        object: {
                            id: 'file-1',
                            content: state.file || ''
                        }
                    };
                case 'dpu_confidential_create':
                    if (args.type === 'folder') {
                        state.folder = true;
                        return { ok: true, object: { id: 'folder-1' } };
                    }
                    if (args.type === 'file') {
                        state.file = String(args.content || '');
                        return { ok: true, object: { id: 'file-1' } };
                    }
                    throw new Error(`Unsupported create type: ${args.type}`);
                case 'dpu_confidential_update':
                    assert.equal(args.id, 'file-1');
                    state.file = String(args.content || '');
                    return { ok: true, object: { id: 'file-1' } };
                default:
                    throw new Error(`Unexpected DPU tool: ${name}`);
            }
        },
        async close() {}
    });
}

async function invokeRoute(handler, {
    method = 'GET',
    pathname = '/avatar-settings/me',
    headers = {},
    body = ''
} = {}) {
    const request = Readable.from(body ? [Buffer.from(body)] : []);
    request.method = method;
    request.url = pathname;
    request.headers = headers;

    const responseState = {
        statusCode: 200,
        headers: {},
        body: ''
    };
    const response = {
        writeHead(statusCode, responseHeaders = {}) {
            responseState.statusCode = statusCode;
            responseState.headers = responseHeaders;
        },
        end(chunk = '') {
            responseState.body += String(chunk || '');
        }
    };

    const handled = await handler(request, response, new URL(`http://localhost${pathname}`));
    return {
        handled,
        statusCode: responseState.statusCode,
        headers: responseState.headers,
        body: responseState.body ? JSON.parse(responseState.body) : null
    };
}

function createAuthHeaders({ userId = 'user-1', username = 'user', roles = [] } = {}) {
    return {
        host: '127.0.0.1:8080',
        'x-forwarded-proto': 'http',
        'x-ploinky-auth-info': JSON.stringify({
            user: {
                id: userId,
                username,
                roles
            },
            invocationToken: 'caller-token'
        })
    };
}

test('GET and PATCH /avatar-settings/me round-trip the profile avatar through DPU', async () => {
    const workspaceRoot = await createTempWorkspace();
    const state = { folder: false, file: '' };
    const handler = createAvatarSettingsHttpHandler({
        fs: await import('node:fs'),
        path,
        workspaceRoot,
        createDpuClient: createFakeDpuClientFactory(state)
    });

    try {
        const initial = await invokeRoute(handler, {
            pathname: '/avatar-settings/me',
            headers: createAuthHeaders()
        });
        assert.equal(initial.statusCode, 200);
        assert.equal(initial.body.avatar.source.kind, 'fallback');
        assert.equal(initial.body.avatar.enabled, true);
        assert.equal(initial.body.enabled, true);
        assert.equal(initial.body.avatar.config.agentId, 'profile:user-1');

        const patch = await invokeRoute(handler, {
            method: 'PATCH',
            pathname: '/avatar-settings/me',
            headers: {
                ...createAuthHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                config: {
                    generated: true,
                    style: 'terminal',
                    palette: 'terminal',
                    emotion: 'thinking'
                },
                enabled: false
            })
        });
        assert.equal(patch.statusCode, 200);
        assert.equal(patch.body.avatar.enabled, false);
        assert.equal(patch.body.enabled, false);
        assert.equal(patch.body.avatar.config.agentId, 'profile:user-1');
        assert.equal(patch.body.avatar.config.style, 'terminal');

        const fetched = await invokeRoute(handler, {
            pathname: '/avatar-settings/me',
            headers: createAuthHeaders()
        });
        assert.equal(fetched.statusCode, 200);
        assert.equal(fetched.body.avatar.source.kind, 'dpu');
        assert.equal(fetched.body.avatar.enabled, false);
        assert.equal(fetched.body.avatar.config.style, 'terminal');
        assert.equal(fetched.body.avatar.config.palette, 'terminal');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('GET /avatar-settings/users rejects unresolved users', async () => {
    const workspaceRoot = await createTempWorkspace();
    const handler = createAvatarSettingsHttpHandler({
        fs: await import('node:fs'),
        path,
        workspaceRoot,
        createDpuClient: createFakeDpuClientFactory({ folder: false, file: '' })
    });

    try {
        const response = await invokeRoute(handler, {
            pathname: '/avatar-settings/users/other-user',
            headers: createAuthHeaders()
        });
        assert.equal(response.statusCode, 403);
        assert.match(response.body.error, /not safely resolvable/);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('PATCH /avatar-settings/agents requires admin privileges', async () => {
    const workspaceRoot = await createTempWorkspace();
    const handler = createAvatarSettingsHttpHandler({
        fs: await import('node:fs'),
        path,
        workspaceRoot,
        createDpuClient: createFakeDpuClientFactory({ folder: false, file: '' })
    });

    try {
        const response = await invokeRoute(handler, {
            method: 'PATCH',
            pathname: '/avatar-settings/agents/llmAssistant',
            headers: {
                ...createAuthHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                config: {
                    generated: true,
                    style: 'terminal'
                }
            })
        });
        assert.equal(response.statusCode, 403);
        assert.equal(response.body.error, 'Only admins can update agent avatars.');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});
