import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempWorkspace(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-submodule-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

function runGit(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
}

async function createCommittedRepository(repoPath, fileName = 'README.md') {
    await fs.mkdir(repoPath);
    runGit(repoPath, ['init']);
    await fs.writeFile(path.join(repoPath, fileName), '# Test repository\n', 'utf8');
    runGit(repoPath, ['add', fileName]);
    runGit(repoPath, [
        '-c', 'user.name=Ploinky Test',
        '-c', 'user.email=ploinky-test@example.com',
        'commit', '-m', 'Initial commit'
    ]);
}

async function createFixture(workspaceDir) {
    const parentRepo = path.join(workspaceDir, 'parent');
    const sourceRepo = path.join(workspaceDir, 'source');
    const bareRemote = path.join(workspaceDir, 'source.git');
    await createCommittedRepository(parentRepo);
    await createCommittedRepository(sourceRepo, 'source.txt');
    runGit(workspaceDir, ['clone', '--bare', sourceRepo, bareRemote]);
    const gitService = createGitService({ validatePath: async (value) => value });
    return { parentRepo, sourceRepo, bareRemote, gitService };
}

test('gitSubmoduleAdd adds and stages a local repository as a submodule', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const { parentRepo, bareRemote, gitService } = await createFixture(workspaceDir);

        const result = await gitService.gitSubmoduleAdd({
            path: parentRepo,
            name: 'vendor-source',
            remoteUrl: bareRemote
        });

        assert.equal(result.ok, true);
        assert.equal(result.parentRepoPath, await fs.realpath(parentRepo));
        assert.equal(result.repoPath, await fs.realpath(path.join(parentRepo, 'vendor-source')));
        assert.equal(result.submodulePath, 'vendor-source');
        assert.equal(result.name, 'vendor-source');
        assert.equal(result.remoteUrl, bareRemote);
        assert.equal(await fs.readFile(path.join(result.repoPath, 'source.txt'), 'utf8'), '# Test repository\n');
        assert.equal(runGit(parentRepo, ['config', '--file', '.gitmodules', '--get', 'submodule.vendor-source.path']), 'vendor-source');
        assert.equal(runGit(parentRepo, ['config', '--file', '.gitmodules', '--get', 'submodule.vendor-source.url']), bareRemote);
        assert.match(runGit(parentRepo, ['ls-files', '--stage', '--', 'vendor-source']), /^160000 /);
        assert.match(runGit(parentRepo, ['diff', '--cached', '--name-only']), /\.gitmodules/);
    });
});

test('gitSubmoduleAdd resolves a subdirectory relative to the nearest parent repository', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const { parentRepo, bareRemote, gitService } = await createFixture(workspaceDir);
        const packagesPath = path.join(parentRepo, 'packages');
        await fs.mkdir(packagesPath);

        const result = await gitService.gitSubmoduleAdd({
            path: packagesPath,
            name: 'shared',
            remoteUrl: bareRemote
        });

        assert.equal(result.submodulePath, 'packages/shared');
        assert.match(runGit(parentRepo, ['ls-files', '--stage', '--', 'packages/shared']), /^160000 /);
    });
});

test('gitSubmoduleAdd targets the nearest repository when called from an existing submodule', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const { parentRepo, bareRemote, gitService } = await createFixture(workspaceDir);
        const outer = await gitService.gitSubmoduleAdd({
            path: parentRepo,
            name: 'outer',
            remoteUrl: bareRemote
        });

        const nested = await gitService.gitSubmoduleAdd({
            path: outer.repoPath,
            name: 'nested',
            remoteUrl: bareRemote
        });

        assert.equal(nested.parentRepoPath, outer.repoPath);
        assert.equal(nested.submodulePath, 'nested');
        assert.match(runGit(outer.repoPath, ['ls-files', '--stage', '--', 'nested']), /^160000 /);
    });
});

test('gitSubmoduleAdd rejects invalid parent and occupied target paths', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const { parentRepo, bareRemote, gitService } = await createFixture(workspaceDir);
        await fs.mkdir(path.join(parentRepo, 'occupied'));

        await assert.rejects(
            () => gitService.gitSubmoduleAdd({ path: workspaceDir, name: 'outside', remoteUrl: bareRemote }),
            /Not a git repository/
        );
        await assert.rejects(
            () => gitService.gitSubmoduleAdd({ path: parentRepo, name: 'occupied', remoteUrl: bareRemote }),
            /Submodule directory already exists/
        );
    });
});

test('repository creation operations reject independent repositories inside a Git worktree', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const { parentRepo, bareRemote, gitService } = await createFixture(workspaceDir);

        await assert.rejects(
            () => gitService.gitInitRepository({
                path: parentRepo,
                name: 'nested-init',
                remoteUrl: bareRemote
            }),
            /Add it as a Git submodule instead/
        );
        await assert.rejects(
            () => gitService.gitCloneRepository({
                path: parentRepo,
                name: 'nested-clone',
                remoteUrl: bareRemote
            }),
            /Add it as a Git submodule instead/
        );

        let githubCalled = false;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => {
            githubCalled = true;
            throw new Error('GitHub must not be called');
        };
        try {
            await assert.rejects(
                () => gitService.gitCreateGithubRepository({
                    path: parentRepo,
                    owner: 'example',
                    name: 'nested-github',
                    token: 'test-token'
                }),
                /Add it as a Git submodule instead/
            );
            assert.equal(githubCalled, false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test('gitSubmoduleAdd cleans the target directory after clone failure', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const parentRepo = path.join(workspaceDir, 'parent');
        const emptyRemote = path.join(workspaceDir, 'empty.git');
        await createCommittedRepository(parentRepo);
        runGit(workspaceDir, ['init', '--bare', emptyRemote]);
        const gitService = createGitService({ validatePath: async (value) => value });

        await assert.rejects(
            () => gitService.gitSubmoduleAdd({
                path: parentRepo,
                name: 'empty',
                remoteUrl: emptyRemote
            })
        );
        await assert.rejects(() => fs.lstat(path.join(parentRepo, 'empty')), { code: 'ENOENT' });
        await assert.rejects(() => fs.lstat(path.join(parentRepo, '.gitmodules')), { code: 'ENOENT' });
        await assert.rejects(() => fs.lstat(path.join(parentRepo, '.git', 'modules', 'empty')), { code: 'ENOENT' });
    });
});
