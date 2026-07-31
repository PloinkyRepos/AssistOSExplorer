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

function runGit(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
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

test('gitInitRepository derives the GitHub repository URL from the local repository name when only the owner URL is provided', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'local-repo-name',
            remoteUrl: 'https://github.com/AssistosTest/'
        });

        assert.equal(result.ok, true);

        const remote = runGit(result.repoPath, ['remote', 'get-url', 'origin']);
        assert.equal(remote, 'https://github.com/AssistosTest/local-repo-name.git');
    });
});

test('gitInitRepository stores canonical GitHub repository URLs', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'canonical-repo',
            remoteUrl: 'https://github.com/AssistosTest/canonical-repo.git/'
        });

        assert.equal(result.ok, true);
        assert.equal(runGit(result.repoPath, ['remote', 'get-url', 'origin']), 'https://github.com/AssistosTest/canonical-repo.git');
    });
});

test('gitInitRepository rejects a remote that already exists in the workspace', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const existingRepo = path.join(workspaceDir, 'existing-repo');
        await fs.mkdir(existingRepo);
        runGit(existingRepo, ['init']);
        runGit(existingRepo, ['remote', 'add', 'origin', 'https://github.com/Example/existing-repo.git']);

        const gitService = createGitService({
            validatePath: async (value) => value,
            workspaceRoots: [workspaceDir]
        });

        await assert.rejects(
            () => gitService.gitInitRepository({
                path: workspaceDir,
                name: 'duplicate-repo',
                remoteUrl: 'git@github.com:example/existing-repo.git'
            }),
            /Remote repository already exists in workspace at: existing-repo/
        );
        await assert.rejects(() => fs.lstat(path.join(workspaceDir, 'duplicate-repo')), { code: 'ENOENT' });
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

test('gitPush sets upstream on first push from a newly created repository', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const remotePath = path.join(workspaceDir, 'remote.git');
        runGit(workspaceDir, ['init', '--bare', remotePath]);

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const result = await gitService.gitInitRepository({
            path: workspaceDir,
            name: 'pushable-repo',
            remoteUrl: remotePath
        });

        await fs.writeFile(path.join(result.repoPath, 'README.md'), '# Pushable repo\n', 'utf8');
        runGit(result.repoPath, ['add', 'README.md']);
        runGit(result.repoPath, [
            '-c',
            'user.name=Ploinky Test',
            '-c',
            'user.email=ploinky-test@example.com',
            'commit',
            '-m',
            'Initial commit'
        ]);

        const branch = runGit(result.repoPath, ['branch', '--show-current']);
        const push = await gitService.gitPush({ path: result.repoPath });

        assert.equal(push.ok, true);
        assert.equal(runGit(result.repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']), `origin/${branch}`);
        assert.equal(runGit(remotePath, ['rev-parse', '--verify', branch]).length > 0, true);
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
