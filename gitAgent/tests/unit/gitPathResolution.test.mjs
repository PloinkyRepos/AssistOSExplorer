import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempWorkspace(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-path-resolution-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function initRepo(repoDir) {
    const init = spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
    if (init.status !== 0) {
        throw new Error(init.stderr || init.stdout || 'git init failed');
    }
}

test('gitStatus resolves the repository from a file path inside the repository', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const repoDir = path.join(workspaceDir, 'repo');
        await fs.mkdir(repoDir, { recursive: true });
        await initRepo(repoDir);
        const filePath = path.join(repoDir, 'src', 'index.js');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, 'console.log("hello");\n', 'utf8');

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitStatus({ path: filePath });

        assert.equal(result.ok, true);
        assert.equal(Array.isArray(result.status.untracked), true);
        assert.equal(result.status.untracked.some((entry) => entry?.path === 'src/index.js'), true);
    });
});

test('gitPull does not fall back to a descendant repository when the provided path is outside any git repository', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const repoDir = path.join(workspaceDir, 'repo');
        await fs.mkdir(repoDir, { recursive: true });
        await initRepo(repoDir);

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        await assert.rejects(
            () => gitService.gitPull({ path: workspaceDir }),
            /Not a git repository|Set the path to a file or folder inside a git repository/i
        );
    });
});
