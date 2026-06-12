import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

async function startWacServer(wacData) {
    const server = http.createServer((req, res) => {
        if (req.url === '/WAC.json') {
            res.setHeader('content-type', 'application/json');
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
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test('prepare-wac delegates prompt, projectDir, and model to opencodeAgent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-prepare-wac-'));
    const captureFile = path.join(tempDir, 'captured-call.json');
    const mockClientModule = path.join(tempDir, 'mock-agent-client.mjs');
    await fs.writeFile(mockClientModule, `
        import fs from 'node:fs/promises';
        export function createAgentClient(agentName) {
            return {
                async callTool(toolName, args) {
                    await fs.writeFile(process.env.CAPTURE_ARGS_FILE, JSON.stringify({ agentName, toolName, args }, null, 2));
                    return { ok: true };
                }
            };
        }
    `);

    const server = await startWacServer(SAMPLE_WAC);
    try {
        const result = await runPrepareWac({
            siteUrl: server.url,
            dataDir: path.join(tempDir, 'data'),
            model: 'opencode/test-model',
        }, {
            WORKSPACE_PATH: tempDir,
            WEBASSIST_AGENT_MCP_CLIENT_MODULE: mockClientModule,
            CAPTURE_ARGS_FILE: captureFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.model, 'opencode/test-model');
        assert.equal(payload.projectDir, path.join(tempDir, 'data', 'sites', '127.0.0.1'));
        assert.equal(payload.akuDir, path.join(payload.projectDir, '.aku'));

        const captured = JSON.parse(await fs.readFile(captureFile, 'utf8'));
        assert.equal(captured.agentName, 'opencodeAgent');
        assert.equal(captured.toolName, 'execute-task');
        assert.equal(captured.args.projectDir, path.join(tempDir, 'data', 'sites', '127.0.0.1'));
        assert.equal(captured.args.model, 'opencode/test-model');
        assert.equal(typeof captured.args.prompt, 'string');
        assert.match(captured.args.prompt, /WAC\.json:/);
        assert.match(captured.args.prompt, /Example site information/);
        assert.equal('wacData' in captured.args, false);
    } finally {
        await server.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
