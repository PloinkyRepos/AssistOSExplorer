import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    createOnlyOfficeDpuClient,
    getDpuRouterMcpUrl,
    resolveOnlyOfficeRouterBaseUrl
} from '../../utils/server/onlyoffice/onlyoffice-dpu-client.mjs';

function createWorkspace() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-dpu-client-'));
    fs.mkdirSync(path.join(workspaceRoot, '.ploinky'), { recursive: true });
    fs.writeFileSync(
        path.join(workspaceRoot, '.ploinky', 'routing.json'),
        JSON.stringify({ port: 8097, routes: { dpuAgent: { hostPort: 12345 } } }, null, 2)
    );
    return workspaceRoot;
}

test('OnlyOffice DPU client resolves router MCP endpoint', () => {
    assert.equal(
        resolveOnlyOfficeRouterBaseUrl({
            routing: { port: 8097 },
            env: { PLOINKY_ROUTER_HOST: 'host.containers.internal' }
        }),
        'http://host.containers.internal:8097'
    );
    assert.equal(
        getDpuRouterMcpUrl({
            routing: { port: 8097 },
            env: {
                PLOINKY_ROUTER_URL: 'http://router.internal:8097/',
                PLOINKY_DPU_ROUTE: 'dpuAgent'
            }
        }),
        'http://router.internal:8097/mcps/dpuAgent/mcp'
    );
});

test('OnlyOffice DPU client calls DPU through router delegated MCP endpoint', async () => {
    const workspaceRoot = createWorkspace();
    const originalFetch = globalThis.fetch;
    const requests = [];

    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });
        return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 'response-1',
            result: {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ ok: true, roots: { mySpace: { id: 'root-1' } } })
                }]
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    try {
        const client = createOnlyOfficeDpuClient({
            workspaceRoot,
            authInfo: { invocationToken: 'caller-token' },
            env: {
                PLOINKY_ROUTER_URL: 'http://host.containers.internal:8097',
                PLOINKY_DPU_ROUTE: 'dpuAgent'
            }
        });
        const payload = await client.callTool('dpu_workspace_roots', {});

        assert.equal(payload.roots.mySpace.id, 'root-1');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'http://host.containers.internal:8097/mcps/dpuAgent/mcp');
        assert.equal(requests[0].options.headers['x-ploinky-caller-jwt'], 'caller-token');
        assert.equal(JSON.parse(requests[0].options.body).params.name, 'dpu_workspace_roots');
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});

test('OnlyOffice DPU client requires router invocation token', async () => {
    const workspaceRoot = createWorkspace();
    try {
        const client = createOnlyOfficeDpuClient({
            workspaceRoot,
            authInfo: {},
            env: { PLOINKY_ROUTER_URL: 'http://host.containers.internal:8097' }
        });
        await assert.rejects(
            () => client.callTool('dpu_workspace_roots', {}),
            /router-issued invocation token/
        );
    } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
