import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    buildAkuPrompt,
    computeWacTimestamp,
    prepareWacForAkuPrompt,
    readWacCache,
    resolveOpenCodeModel,
} from '../src/mcp/prepare-wac.mjs';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBASSIST_ROOT = path.resolve(TESTS_DIR, '..');
const PREPARE_WAC_ENTRY = path.join(WEBASSIST_ROOT, 'src', 'mcp', 'prepare-wac.mjs');

const SAMPLE_WAC = {
    siteInfo: 'Example site information',
    profilesInfo: {
        developer: 'Developers evaluating the product',
    },
    contactInfo: 'Email: owner@example.test',
    siteMap: ['http://127.0.0.1/'],
};

function nextLastModified(offsetMs = 0) {
    return new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + offsetMs).toUTCString();
}

function runPrepareWac(input, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [PREPARE_WAC_ENTRY], {
            env: {
                ...process.env,
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

        child.stdin.write(`${JSON.stringify({ input })}\n`);
        child.stdin.end();
    });
}

async function startWacServer(initialWacData, options = {}) {
    let wacData = initialWacData;
    let lastModified = options.lastModified ?? nextLastModified();
    const server = http.createServer((req, res) => {
        if (req.url === '/WAC.json') {
            res.setHeader('content-type', 'application/json');
            if (lastModified) {
                res.setHeader('last-modified', lastModified);
            }
            res.end(JSON.stringify(wacData));
            return;
        }

        res.statusCode = 404;
        res.end('not found');
    });

    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        setWac(nextWacData, nextModified = nextLastModified(1000)) {
            wacData = nextWacData;
            lastModified = nextModified;
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

async function createMockClientModule(tempDir, options = {}) {
    const callsFile = path.join(tempDir, options.callsFileName ?? 'captured-calls.json');
    const mockClientModule = path.join(tempDir, options.moduleFileName ?? 'mock-agent-client.mjs');
    await fs.writeFile(mockClientModule, `
        import fs from 'node:fs/promises';
        import path from 'node:path';
        export function createAgentClient(agentName) {
            return {
                async callTool(toolName, args) {
                    const callsPath = process.env.CAPTURE_ARGS_FILE;
                    let calls = [];
                    try {
                        calls = JSON.parse(await fs.readFile(callsPath, 'utf8'));
                    } catch {
                    }
                    calls.push({ agentName, toolName, args });
                    await fs.writeFile(callsPath, JSON.stringify(calls, null, 2));
                    await fs.mkdir(path.join(args.projectDir, '.aku'), { recursive: true });
                    await fs.writeFile(path.join(args.projectDir, '.aku', 'aku.json'), JSON.stringify({ ok: true }));
                    return { ok: true };
                }
            };
        }
    `);
    return { callsFile, mockClientModule };
}

async function readCapturedCalls(callsFile) {
    try {
        return JSON.parse(await fs.readFile(callsFile, 'utf8'));
    } catch {
        return [];
    }
}

test('prepare-wac delegates prompt, projectDir, and model to opencodeAgent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);

    const server = await startWacServer(SAMPLE_WAC);
    const dataDir = path.join(tempDir, 'data');
    try {
        const result = await runPrepareWac({
            siteUrl: server.url,
            dataDir,
        }, {
            WORKSPACE_PATH: tempDir,
            WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
            CAPTURE_ARGS_FILE: callsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.model, 'opencode/deepseek-v4-flash-free');
        assert.equal(payload.akuBuilt, true);
        assert.equal(payload.cacheHit, false);
        assert.equal(payload.cachePath, path.join(dataDir, 'wac-cache.json'));
        assert.equal(payload.projectDir, path.join(dataDir, 'sites', '127.0.0.1'));
        assert.equal(payload.akuDir, path.join(payload.projectDir, '.aku'));

        const [captured] = await readCapturedCalls(callsFile);
        assert.equal(captured.agentName, 'opencodeAgent');
        assert.equal(captured.toolName, 'execute-task');
        assert.equal(captured.args.projectDir, path.join(dataDir, 'sites', '127.0.0.1'));
        assert.equal(captured.args.model, 'opencode/deepseek-v4-flash-free');
        assert.equal(typeof captured.args.prompt, 'string');
        assert.match(captured.args.prompt, /WAC\.json:/);
        assert.match(captured.args.prompt, /Example site information/);
        assert.match(captured.args.prompt, /Fetch every URL listed in siteMap/);
        assert.equal('wacData' in captured.args, false);

        const cache = await readWacCache(payload.cachePath);
        assert.equal(cache.entries[server.url].wacTimestamp, payload.wacTimestamp);
        assert.equal(cache.entries[server.url].projectDir, payload.projectDir);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('prepare-wac skips opencodeAgent when WAC timestamp and AKU manifest are cached', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-cache-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);
    const server = await startWacServer(SAMPLE_WAC);
    const dataDir = path.join(tempDir, 'data');
    const input = {
        siteUrl: server.url,
        dataDir,
    };
    const env = {
        WORKSPACE_PATH: tempDir,
        WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
        CAPTURE_ARGS_FILE: callsFile,
    };

    try {
        const first = await runPrepareWac(input, env);
        assert.equal(first.code, 0, first.stderr || first.stdout);
        const firstPayload = JSON.parse(first.stdout);
        assert.equal(firstPayload.akuBuilt, true);
        assert.equal(firstPayload.cacheHit, false);
        assert.equal((await readCapturedCalls(callsFile)).length, 1);

        const second = await runPrepareWac(input, env);
        assert.equal(second.code, 0, second.stderr || second.stdout);
        const secondPayload = JSON.parse(second.stdout);
        assert.equal(secondPayload.akuBuilt, false);
        assert.equal(secondPayload.cacheHit, true);
        assert.equal(secondPayload.wacTimestamp, firstPayload.wacTimestamp);
        assert.equal((await readCapturedCalls(callsFile)).length, 1);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('prepare-wac uses WEBASSIST_OPENCODE_MODEL', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-env-model-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);
    const server = await startWacServer(SAMPLE_WAC);
    const dataDir = path.join(tempDir, 'data');

    try {
        const result = await runPrepareWac({
            siteUrl: server.url,
            dataDir,
        }, {
            WORKSPACE_PATH: tempDir,
            WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
            CAPTURE_ARGS_FILE: callsFile,
            WEBASSIST_OPENCODE_MODEL: 'opencode/test-env-model',
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.model, 'opencode/test-env-model');
        const [captured] = await readCapturedCalls(callsFile);
        assert.equal(captured.args.model, 'opencode/test-env-model');
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('prepare-wac rebuilds when WAC timestamp changes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-changed-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);
    const server = await startWacServer(SAMPLE_WAC, { lastModified: nextLastModified() });
    const dataDir = path.join(tempDir, 'data');
    const input = {
        siteUrl: server.url,
        dataDir,
    };
    const env = {
        WORKSPACE_PATH: tempDir,
        WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
        CAPTURE_ARGS_FILE: callsFile,
    };

    try {
        const first = await runPrepareWac(input, env);
        assert.equal(first.code, 0, first.stderr || first.stdout);
        const firstPayload = JSON.parse(first.stdout);

        server.setWac({
            ...SAMPLE_WAC,
            siteInfo: 'Changed example site information',
        }, nextLastModified(2000));

        const second = await runPrepareWac(input, env);
        assert.equal(second.code, 0, second.stderr || second.stdout);
        const secondPayload = JSON.parse(second.stdout);
        assert.equal(secondPayload.akuBuilt, true);
        assert.equal(secondPayload.cacheHit, false);
        assert.notEqual(secondPayload.wacTimestamp, firstPayload.wacTimestamp);
        assert.equal((await readCapturedCalls(callsFile)).length, 2);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('prepare-wac rebuilds when cached AKU manifest is missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-missing-aku-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);
    const server = await startWacServer(SAMPLE_WAC);
    const dataDir = path.join(tempDir, 'data');
    const input = {
        siteUrl: server.url,
        dataDir,
    };
    const env = {
        WORKSPACE_PATH: tempDir,
        WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
        CAPTURE_ARGS_FILE: callsFile,
    };

    try {
        const first = await runPrepareWac(input, env);
        assert.equal(first.code, 0, first.stderr || first.stdout);
        const firstPayload = JSON.parse(first.stdout);
        await fs.rm(path.join(firstPayload.akuDir, 'aku.json'), { force: true });

        const second = await runPrepareWac(input, env);
        assert.equal(second.code, 0, second.stderr || second.stdout);
        const secondPayload = JSON.parse(second.stdout);
        assert.equal(secondPayload.akuBuilt, true);
        assert.equal(secondPayload.cacheHit, false);
        assert.equal(secondPayload.wacTimestamp, firstPayload.wacTimestamp);
        assert.equal((await readCapturedCalls(callsFile)).length, 2);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('prepare-wac treats corrupt WAC cache as miss and rewrites it', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-corrupt-'));
    const { callsFile, mockClientModule } = await createMockClientModule(tempDir);
    const server = await startWacServer(SAMPLE_WAC);
    const dataDir = path.join(tempDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    const cachePath = path.join(dataDir, 'wac-cache.json');
    await fs.writeFile(cachePath, '{not json', 'utf8');

    try {
        const result = await runPrepareWac({
            siteUrl: server.url,
            dataDir,
        }, {
            WORKSPACE_PATH: tempDir,
            WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
            CAPTURE_ARGS_FILE: callsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.akuBuilt, true);
        assert.equal(payload.cacheHit, false);
        assert.equal((await readCapturedCalls(callsFile)).length, 1);
        const cache = await readWacCache(cachePath);
        assert.equal(cache.entries[server.url].wacTimestamp, payload.wacTimestamp);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('computeWacTimestamp falls back to content hash when Last-Modified is absent', () => {
    const text = JSON.stringify(SAMPLE_WAC);
    const timestamp = computeWacTimestamp(text, new Headers());
    assert.match(timestamp, /^sha256:[a-f0-9]{64}$/);
    assert.equal(computeWacTimestamp(text, new Headers({ 'last-modified': nextLastModified() })), nextLastModified());
});

test('resolveOpenCodeModel uses WEBASSIST_OPENCODE_MODEL or built-in default', () => {
    assert.equal(
        resolveOpenCodeModel({
            WEBASSIST_OPENCODE_MODEL: 'opencode/env-model',
        }),
        'opencode/env-model',
    );
    assert.equal(resolveOpenCodeModel({}), 'opencode/deepseek-v4-flash-free');
});

test('prepare-wac rewrites localhost siteMap URLs for container prompt access', () => {
    const previousContainer = process.env.CONTAINER;
    process.env.CONTAINER = 'podman';

    try {
        const prepared = prepareWacForAkuPrompt({
            ...SAMPLE_WAC,
            siteMap: [
                'http://localhost:3000/assistos-info/chapter_01_vision.md',
                'http://127.0.0.1:3000/assistos-info/chapter_02_achilles_ide_as_assistos_explorer.md',
                'https://example.test/external.md',
            ],
        });

        assert.deepEqual(prepared.siteMap, [
            'http://host.containers.internal:3000/assistos-info/chapter_01_vision.md',
            'http://host.containers.internal:3000/assistos-info/chapter_02_achilles_ide_as_assistos_explorer.md',
            'https://example.test/external.md',
        ]);

        const prompt = buildAkuPrompt(prepared);
        assert.match(prompt, /host\.containers\.internal:3000\/assistos-info\/chapter_01_vision\.md/);
    } finally {
        if (previousContainer === undefined) {
            delete process.env.CONTAINER;
        } else {
            process.env.CONTAINER = previousContainer;
        }
    }
});
