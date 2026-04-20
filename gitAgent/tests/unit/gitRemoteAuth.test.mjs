import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempWorkspace(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-remote-auth-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

function runGit(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
    return result.stdout.trim();
}

test('gitPush and gitPull ignore token auth for local filesystem remotes', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const remoteDir = path.join(workspaceDir, 'remote.git');
        const repoDir = path.join(workspaceDir, 'repo');

        await fs.mkdir(repoDir, { recursive: true });
        runGit(['init', '--bare', remoteDir], workspaceDir);
        runGit(['init'], repoDir);
        await fs.writeFile(path.join(repoDir, 'README.md'), 'one\n', 'utf8');
        runGit(['add', 'README.md'], repoDir);
        runGit(['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], repoDir);
        runGit(['remote', 'add', 'origin', remoteDir], repoDir);
        const branchName = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir) || 'main';
        runGit(['push', '-u', 'origin', branchName], repoDir);

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        await fs.writeFile(path.join(repoDir, 'README.md'), 'two\n', 'utf8');
        runGit(['add', 'README.md'], repoDir);
        await gitService.gitCommit({
            path: repoDir,
            message: 'second',
            userName: 'Test User',
            userEmail: 'test@example.com'
        });

        const pushed = await gitService.gitPush({
            path: repoDir,
            token: 'dummy-token-that-should-be-ignored'
        });
        assert.equal(pushed.ok, true);

        const pulled = await gitService.gitPull({
            path: repoDir,
            token: 'dummy-token-that-should-be-ignored',
            rebase: false,
            ffOnly: false
        });
        assert.equal(pulled.ok, true);
    });
});
