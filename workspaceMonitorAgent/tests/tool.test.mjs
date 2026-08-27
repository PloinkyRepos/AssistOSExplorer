import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeCurrentSnapshot } from '../lib/currentSnapshot.mjs';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolPath = path.join(agentRoot, 'tools', 'workspace_monitor_tool.mjs');

async function temporaryEnvironment(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-monitor-tool-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const authModule = path.join(root, 'invocation-auth.mjs');
    await fs.writeFile(authModule, 'export async function authInfoFromInvocation(invocation) { return invocation; }\n', 'utf8');
    return {
        ...process.env,
        TOOL_NAME: 'workspace_monitor_snapshot_get',
        WORKSPACE_MONITOR_DATA_ROOT: root,
        PLOINKY_INVOCATION_AUTH_MODULE: pathToFileURL(authModule).href,
    };
}

function runTool(env, invocation) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [toolPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(JSON.stringify({ metadata: { invocation } }));
    });
}

test('current snapshot tool returns the sanitized snapshot to an administrator', async (t) => {
    const env = await temporaryEnvironment(t);
    await writeCurrentSnapshot({
        sampledAt: new Date().toISOString(),
        router: { status: 'running', pid: 123, metrics: { available: true, cpuPercent: 1, memoryBytes: 2 } },
        runtimes: [],
        total: { cpuPercent: 1, memoryBytes: 2 },
        secret: 'not persisted',
    }, env);

    const result = await runTool(env, { roles: ['admin'] });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.available, true);
    assert.equal(payload.stale, false);
    assert.equal(Object.hasOwn(payload.snapshot, 'secret'), false);
    assert.equal(Object.hasOwn(payload.snapshot.router, 'pid'), false);
});

test('current snapshot tool rejects a non-administrator', async (t) => {
    const env = await temporaryEnvironment(t);
    const result = await runTool(env, { roles: ['user'] });
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.message, /requires an administrator/);
});
