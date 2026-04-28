import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getSessionHistoryFileName, getSessionProfileFileName } from '../src/constants/datastore.mjs';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBASSIST_ROOT = path.resolve(TESTS_DIR, '..');
const REPO_ROOT = path.resolve(WEBASSIST_ROOT, '..');
const CLI_ENTRY = path.join(WEBASSIST_ROOT, 'src', 'index.mjs');

function runCli(args, { stdin = '', cwd = REPO_ROOT } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
            cwd,
            env: {
                ...process.env,
                ACHILLES_DEBUG: 'false',
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

async function assertDirectoryExists(targetPath) {
    const stats = await fs.stat(targetPath);
    assert.equal(stats.isDirectory(), true);
}

test('mcp mode supports required CLI variants', async (t) => {
    const defaultDataDir = path.join(REPO_ROOT, 'data');
    const createdDefaultSessions = [];

    t.after(async () => {
        await Promise.all(
            createdDefaultSessions.map((sessionId) => fs.rm(path.join(defaultDataDir, 'sessions', `${getSessionProfileFileName(sessionId)}.md`), {
                force: true,
            }))
        );
        await Promise.all(
            createdDefaultSessions.map((sessionId) => fs.rm(path.join(defaultDataDir, 'sessions', `${getSessionHistoryFileName(sessionId)}.md`), {
                force: true,
            }))
        );
    });

    await t.test('prints help with -h', async () => {
        const result = await runCli(['-h']);
        assert.equal(result.code, 0);
        assert.match(result.stdout, /Usage:/);
        assert.match(result.stdout, /-mcp/);
        assert.match(result.stdout, /--agent-root <dir>/);
    });

    await t.test('runs -mcp with explicit --session-id without --json and without --data-dir', async () => {
        const sessionId = `mcp-explicit-${Date.now()}`;
        const result = await runCli(['-mcp', '--session-id', sessionId, 'Hello from explicit session']);

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.sessionId, sessionId);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);

        await assertDirectoryExists(defaultDataDir);
        const sessionPath = path.join(defaultDataDir, 'sessions', `${getSessionHistoryFileName(sessionId)}.md`);
        const sessionContent = await fs.readFile(sessionPath, 'utf8');
        const profilePath = path.join(defaultDataDir, 'sessions', `${getSessionProfileFileName(sessionId)}.md`);
        await fs.readFile(profilePath, 'utf8');
        assert.match(sessionContent, /### 1\. History/);
        createdDefaultSessions.push(sessionId);
    });

    await t.test('runs -mcp without --session-id with --json and without --data-dir', async () => {
        const result = await runCli(['-mcp', '--json', 'Hello with generated session']);

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);
        assert.match(payload.sessionId, /^session-/);

        await assertDirectoryExists(defaultDataDir);
        const sessionPath = path.join(defaultDataDir, 'sessions', `${getSessionHistoryFileName(payload.sessionId)}.md`);
        const sessionContent = await fs.readFile(sessionPath, 'utf8');
        const profilePath = path.join(defaultDataDir, 'sessions', `${getSessionProfileFileName(payload.sessionId)}.md`);
        await fs.readFile(profilePath, 'utf8');
        assert.match(sessionContent, /### 1\. History/);
        createdDefaultSessions.push(payload.sessionId);
    });

    await t.test('runs -mcp with --data-dir override', async (sub) => {
        const customDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-mcp-data-'));
        sub.after(async () => {
            await fs.rm(customDataDir, { recursive: true, force: true });
        });

        const sessionId = `mcp-custom-${Date.now()}`;
        const result = await runCli([
            '-mcp',
            '--json',
            '--session-id',
            sessionId,
            '--data-dir',
            customDataDir,
            'Hello with custom data dir',
        ]);

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);
        assert.equal(payload.sessionId, sessionId);

        await assertDirectoryExists(customDataDir);
        const sessionPath = path.join(customDataDir, 'sessions', `${getSessionHistoryFileName(sessionId)}.md`);
        const sessionContent = await fs.readFile(sessionPath, 'utf8');
        const profilePath = path.join(customDataDir, 'sessions', `${getSessionProfileFileName(sessionId)}.md`);
        await fs.readFile(profilePath, 'utf8');
        assert.match(sessionContent, /### 1\. History/);
    });

    await t.test('runs -mcp with --agent-root override', async (sub) => {
        const customRuntimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-agent-root-'));
        const customAgentRoot = path.join(customRuntimeRoot, 'agent-root');
        const customSkillsDir = path.join(customAgentRoot, 'skills');
        const customDataDir = path.join(customRuntimeRoot, 'data');

        await fs.mkdir(customAgentRoot, { recursive: true });
        await fs.cp(path.join(WEBASSIST_ROOT, 'skills'), customSkillsDir, { recursive: true });
        await fs.cp(path.join(REPO_ROOT, 'data'), customDataDir, { recursive: true });

        sub.after(async () => {
            await fs.rm(customRuntimeRoot, { recursive: true, force: true });
        });

        const sessionId = `mcp-agent-root-${Date.now()}`;
        const result = await runCli([
            '-mcp',
            '--json',
            '--session-id',
            sessionId,
            '--agent-root',
            customAgentRoot,
            'Hello with custom agent root',
        ]);

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);
        assert.equal(payload.sessionId, sessionId);

        const expectedDataDir = path.join(customRuntimeRoot, 'data');
        await assertDirectoryExists(expectedDataDir);
        const sessionPath = path.join(expectedDataDir, 'sessions', `${getSessionHistoryFileName(sessionId)}.md`);
        const sessionContent = await fs.readFile(sessionPath, 'utf8');
        const profilePath = path.join(expectedDataDir, 'sessions', `${getSessionProfileFileName(sessionId)}.md`);
        await fs.readFile(profilePath, 'utf8');
        assert.match(sessionContent, /### 1\. History/);
    });

    await t.test('supports -- to separate options from message', async () => {
        const sessionId = `mcp-separator-${Date.now()}`;
        const result = await runCli([
            '-mcp',
            '--json',
            '--session-id',
            sessionId,
            '--',
            '--this starts like an option but is message text',
        ]);

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);
        assert.equal(payload.sessionId, sessionId);

        const sessionPath = path.join(defaultDataDir, 'sessions', `${getSessionHistoryFileName(sessionId)}.md`);
        const sessionContent = await fs.readFile(sessionPath, 'utf8');
        const profilePath = path.join(defaultDataDir, 'sessions', `${getSessionProfileFileName(sessionId)}.md`);
        await fs.readFile(profilePath, 'utf8');
        assert.match(sessionContent, /### 1\. History/);
        createdDefaultSessions.push(sessionId);
    });

    await t.test('supports MCP envelope input when -mcp flag is present', async () => {
        const envelope = {
            input: {
                message: 'Hello from envelope mode',
            },
        };
        const result = await runCli(['-mcp'], {
            stdin: `${JSON.stringify(envelope)}\n`,
        });

        assert.equal(result.code, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(typeof payload.message, 'string');
        assert.equal(payload.message.length > 0, true);
        assert.match(payload.sessionId, /^session-/);
    });
});
