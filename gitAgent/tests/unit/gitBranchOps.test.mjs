import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

function git(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
    return result.stdout.trim();
}

async function withTempRepo(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-'));
    try {
        git(tempDir, ['init']);
        git(tempDir, ['config', 'user.name', 'Test User']);
        git(tempDir, ['config', 'user.email', 'test@example.com']);
        await fs.writeFile(path.join(tempDir, 'notes.txt'), 'main\n', 'utf8');
        git(tempDir, ['add', 'notes.txt']);
        git(tempDir, ['commit', '-m', 'initial']);
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

test('gitBranchCreate creates and checks out a new branch', async () => {
    await withTempRepo(async (repoDir) => {
        const gitService = createGitService({ validatePath: async (value) => value });

        const created = await gitService.gitBranchCreate({
            path: repoDir,
            name: 'feature/test'
        });

        assert.equal(created.ok, true);
        assert.equal(created.branch, 'feature/test');
        assert.equal(created.checkedOut, true);

        const listed = await gitService.gitBranchList({ path: repoDir });
        assert.equal(listed.currentBranch, 'feature/test');
        assert.equal(listed.branches.some((branch) => branch.name === 'feature/test' && branch.current), true);
    });
});

test('gitBranchCheckout checks out an existing local branch', async () => {
    await withTempRepo(async (repoDir) => {
        git(repoDir, ['checkout', '-b', 'work']);
        git(repoDir, ['checkout', 'master']);
        const gitService = createGitService({ validatePath: async (value) => value });

        const checkedOut = await gitService.gitBranchCheckout({
            path: repoDir,
            branch: 'work'
        });

        assert.equal(checkedOut.ok, true);
        assert.equal(checkedOut.branch, 'work');
    });
});

test('gitBranchCheckout creates a local tracking branch for a remote branch', async () => {
    const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-remote-'));
    try {
        git(remoteDir, ['init', '--bare']);
        await withTempRepo(async (repoDir) => {
            git(repoDir, ['remote', 'add', 'origin', remoteDir]);
            git(repoDir, ['push', '-u', 'origin', 'master']);
            git(repoDir, ['checkout', '-b', 'remote-work']);
            await fs.writeFile(path.join(repoDir, 'remote.txt'), 'remote\n', 'utf8');
            git(repoDir, ['add', 'remote.txt']);
            git(repoDir, ['commit', '-m', 'remote branch']);
            git(repoDir, ['push', '-u', 'origin', 'remote-work']);
            git(repoDir, ['checkout', 'master']);
            git(repoDir, ['branch', '-D', 'remote-work']);

            const gitService = createGitService({ validatePath: async (value) => value });
            const checkedOut = await gitService.gitBranchCheckout({
                path: repoDir,
                branch: 'origin/remote-work'
            });

            assert.equal(checkedOut.ok, true);
            assert.equal(checkedOut.branch, 'remote-work');
            assert.equal(git(repoDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']), 'origin/remote-work');
        });
    } finally {
        await fs.rm(remoteDir, { recursive: true, force: true });
    }
});

test('gitBranchMerge reports conflicts without throwing', async () => {
    await withTempRepo(async (repoDir) => {
        git(repoDir, ['checkout', '-b', 'feature']);
        await fs.writeFile(path.join(repoDir, 'notes.txt'), 'feature\n', 'utf8');
        git(repoDir, ['add', 'notes.txt']);
        git(repoDir, ['commit', '-m', 'feature change']);
        git(repoDir, ['checkout', 'master']);
        await fs.writeFile(path.join(repoDir, 'notes.txt'), 'main changed\n', 'utf8');
        git(repoDir, ['add', 'notes.txt']);
        git(repoDir, ['commit', '-m', 'main change']);

        const gitService = createGitService({ validatePath: async (value) => value });
        const merged = await gitService.gitBranchMerge({
            path: repoDir,
            sourceBranch: 'feature'
        });

        assert.equal(merged.ok, false);
        assert.equal(merged.conflicts, true);
        assert.deepEqual(merged.conflictPaths, ['notes.txt']);
    });
});
