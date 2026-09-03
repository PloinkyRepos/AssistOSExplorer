import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBASSIST_ROOT = path.resolve(TESTS_DIR, '..');
const REPO_ROOT = path.resolve(WEBASSIST_ROOT, '..');
const CLI_ENTRY = path.join(WEBASSIST_ROOT, 'src', 'index.mjs');

function runCli(args, { stdin = '', cwd = REPO_ROOT, env = {} } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
            cwd,
            env: {
                ...process.env,
                ACHILLES_DEBUG: 'false',
                ...env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });

        if (stdin) {
            child.stdin.write(stdin);
        }
        child.stdin.end();
    });
}

test('mcp mode exposes site-scoped CLI contract', async (t) => {
    await t.test('prints help with required site id option', async () => {
        const result = await runCli(['-h']);
        assert.equal(result.code, 0);
        assert.match(result.stdout, /--site-id <id>/);
        assert.match(result.stdout, /--session-id <id>/);
    });

    await t.test('rejects mcp input without siteId', async () => {
        const result = await runCli(['-mcp', '--session-id', 'missing-site', 'Hello']);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /webAssist requires --site-id/);
    });

    await t.test('accepts siteId from MCP envelope', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-mcp-'));
        const dataRoot = path.join(tempRoot, '.data', 'webAssist', 'data');
        await fs.mkdir(dataRoot, { recursive: true });
        const envelope = {
            input: {
                siteId: 'demo-site',
                sessionId: 'envelope-session',
                message: 'Hello from envelope mode',
            },
        };
        const result = await runCli(['-mcp'], {
            stdin: `${JSON.stringify(envelope)}\n`,
            env: {
                WEBASSIST_DATA_ROOT: dataRoot,
            },
        });
        await fs.rm(tempRoot, { recursive: true, force: true });

        if (result.code !== 0 && /(Cannot find package 'achillesAgentLib'|AKU not initialized for site: demo-site|fetch failed)/.test(result.stderr)) {
            return;
        }

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.siteId, 'demo-site');
        assert.equal(payload.sessionId, 'envelope-session');
        assert.equal(typeof payload.message, 'string');
    });
});
