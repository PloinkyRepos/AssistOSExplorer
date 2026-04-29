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
            name: 'sample-repo',
            remoteUrl: 'https://github.com/example/sample-repo.git'
        });

        assert.equal(result.ok, true);
        assert.equal(result.name, 'sample-repo');
        assert.equal(result.parentPath, await fs.realpath(workspaceDir));
        assert.equal(path.basename(result.repoPath), 'sample-repo');
        assert.equal(result.remote, 'origin');

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

test('gitInitRepository can configure origin remote for a new repository', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'remote-repo',
            remoteUrl: 'https://github.com/example/remote-repo.git'
        });

        assert.equal(result.ok, true);
        assert.equal(result.remote, 'origin');

        const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
            cwd: result.repoPath,
            encoding: 'utf8'
        });
        assert.equal(remote.status, 0);
        assert.equal(remote.stdout.trim(), 'https://github.com/example/remote-repo.git');
    });
});

test('gitDiff handles HEAD in a new repository without commits', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'empty-head-repo',
            remoteUrl: 'https://github.com/example/empty-head-repo.git'
        });
        await fs.writeFile(path.join(result.repoPath, 'test'), 'hello\n', 'utf8');

        const diff = await gitService.gitDiff({
            path: result.repoPath,
            file: 'test',
            ref: 'HEAD'
        });

        assert.match(diff, /new file mode|--- \/dev\/null/);
        assert.match(diff, /\+hello/);
    });
});

test('gitInitRepository requires a remote URL', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        await assert.rejects(
            () => gitService.gitInitRepository({
                path: workspaceDir,
                name: 'missing-remote'
            }),
            /Remote URL is required/
        );
    });
});
