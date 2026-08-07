import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const explorerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hookPath = path.join(explorerRoot, 'scripts', 'hooks', 'preinstall.sh');

async function withTempDir(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-preinstall-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

test('preinstall does not require a master key or mutate workspace secrets', async () => {
    await withTempDir(async (tempDir) => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const ploinkyRoot = path.join(workspaceRoot, '.ploinky');
        const axifaceRoot = path.join(tempDir, 'axi-face');
        const envPath = path.join(workspaceRoot, '.env');
        const masterKeyPath = path.join(ploinkyRoot, 'master-key');
        const secretsPath = path.join(ploinkyRoot, '.secrets');
        const envContents = 'UNRELATED_SETTING=preserved\n';
        const masterKeyContents = `${'a'.repeat(64)}\n`;
        const secretsContents = 'existing-encrypted-payload\n';

        await fs.mkdir(path.join(axifaceRoot, 'src'), { recursive: true });
        await fs.mkdir(path.join(axifaceRoot, 'packs', 'default'), { recursive: true });
        await fs.mkdir(ploinkyRoot, { recursive: true });
        await fs.writeFile(path.join(axifaceRoot, 'src', 'axi-face.mjs'), 'export {};\n', 'utf8');
        await fs.writeFile(
            path.join(axifaceRoot, 'packs', 'default', 'manifest.json'),
            '{"id":"default"}\n',
            'utf8'
        );
        await fs.writeFile(envPath, envContents, 'utf8');
        await fs.writeFile(masterKeyPath, masterKeyContents, 'utf8');
        await fs.writeFile(secretsPath, secretsContents, 'utf8');

        const hookEnv = {
            ...process.env,
            PLOINKY_WORKSPACE_ROOT: workspaceRoot,
            AXIFACE_REPO_PATH: axifaceRoot
        };
        delete hookEnv.PLOINKY_MASTER_KEY;

        for (let run = 0; run < 2; run += 1) {
            const result = spawnSync('bash', [hookPath], {
                cwd: explorerRoot,
                env: hookEnv,
                encoding: 'utf8'
            });
            assert.equal(result.status, 0, result.stderr || result.stdout);
        }

        assert.equal(await fs.readFile(envPath, 'utf8'), envContents);
        assert.equal(await fs.readFile(masterKeyPath, 'utf8'), masterKeyContents);
        assert.equal(await fs.readFile(secretsPath, 'utf8'), secretsContents);
    });
});

test('preinstall does not create Ploinky state in a clean workspace', async () => {
    await withTempDir(async (tempDir) => {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const axifaceRoot = path.join(tempDir, 'axi-face');

        await fs.mkdir(workspaceRoot, { recursive: true });
        await fs.mkdir(path.join(axifaceRoot, 'src'), { recursive: true });
        await fs.mkdir(path.join(axifaceRoot, 'packs', 'default'), { recursive: true });
        await fs.writeFile(path.join(axifaceRoot, 'src', 'axi-face.mjs'), 'export {};\n', 'utf8');
        await fs.writeFile(
            path.join(axifaceRoot, 'packs', 'default', 'manifest.json'),
            '{"id":"default"}\n',
            'utf8'
        );

        const hookEnv = {
            ...process.env,
            PLOINKY_WORKSPACE_ROOT: workspaceRoot,
            AXIFACE_REPO_PATH: axifaceRoot
        };
        delete hookEnv.PLOINKY_MASTER_KEY;

        const result = spawnSync('bash', [hookPath], {
            cwd: explorerRoot,
            env: hookEnv,
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        await assert.rejects(fs.stat(path.join(workspaceRoot, '.ploinky')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(workspaceRoot, '.env')), { code: 'ENOENT' });
    });
});
