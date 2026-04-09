import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempWorkspace(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-init-repo-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

test('gitInitRepository creates a new directory with a git repository inside it', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'sample-repo'
        });

        assert.equal(result.ok, true);
        assert.equal(result.name, 'sample-repo');
        assert.equal(result.parentPath, await fs.realpath(workspaceDir));
        assert.equal(path.basename(result.repoPath), 'sample-repo');

        const gitDir = path.join(result.repoPath, '.git');
        const gitDirStat = await fs.lstat(gitDir);
        assert.equal(gitDirStat.isDirectory(), true);

        const revParse = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: result.repoPath,
            encoding: 'utf8'
        });
        assert.equal(revParse.status, 0);
        assert.equal(revParse.stdout.trim(), 'true');
    });
});
