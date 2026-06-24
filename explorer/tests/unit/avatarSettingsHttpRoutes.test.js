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

test('profile avatar routes are not served by avatar settings backend', async () => {
    const workspaceRoot = await createTempWorkspace();
    const handler = createAvatarSettingsHttpHandler({
        fs: await import('node:fs'),
        path,
        workspaceRoot
    });

    try {
        const response = await invokeRoute(handler, {
            pathname: '/avatar-settings/me',
            headers: createAuthHeaders()
        });
        assert.equal(response.statusCode, 404);
        assert.equal(response.body.error, 'Avatar settings route not found.');
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('PATCH /avatar-settings/agents requires admin privileges', async () => {
    const workspaceRoot = await createTempWorkspace();
    const handler = createAvatarSettingsHttpHandler({
        fs: await import('node:fs'),
        path,
        workspaceRoot
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
