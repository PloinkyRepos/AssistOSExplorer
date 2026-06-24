import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';
import {
    listGithubRepositories,
    listGithubRepositoryTargets
} from '../../lib/git/github-remotes.mjs';

async function withTempWorkspace(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-github-picker-'));
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

test('listGithubRepositoryTargets returns organization URL targets', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url) === 'https://api.github.com/user/orgs?per_page=100') {
            return Response.json([{ login: 'AssistosTest', html_url: 'https://github.com/AssistosTest' }]);
        }
        return new Response('', { status: 404 });
    };
    try {
        const result = await listGithubRepositoryTargets({ token: 'token' });
        assert.equal(result.ok, true);
        assert.deepEqual(result.targets.map((target) => target.login), ['AssistosTest']);
        assert.equal(result.targets[0].repositoryUrl, 'https://github.com/AssistosTest');
        assert.equal(result.targets[0].type, 'Organization');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('listGithubRepositories returns sanitized clone choices', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        assert.equal(String(url), 'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
        return Response.json([{
            id: 10,
            full_name: 'AssistosTest/app',
            name: 'app',
            owner: { login: 'AssistosTest', type: 'Organization' },
            private: true,
            html_url: 'https://github.com/AssistosTest/app',
            clone_url: 'https://github.com/AssistosTest/app.git',
            default_branch: 'main',
            description: 'Test application',
            updated_at: '2026-06-23T12:00:00Z'
        }]);
    };
    try {
        const result = await listGithubRepositories({ token: 'token', query: 'assistos' });
        assert.equal(result.ok, true);
        assert.equal(result.repositories.length, 1);
        assert.equal(result.repositories[0].fullName, 'AssistosTest/app');
        assert.equal(result.repositories[0].cloneUrl, 'https://github.com/AssistosTest/app.git');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('gitCreateGithubRepository creates remote under selected organization and configures local origin', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const calls = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            calls.push({ url: String(url), method: options.method || 'GET' });
            if (String(url) === 'https://api.github.com/user') {
                return Response.json({ login: 'current-user' });
            }
            if (String(url) === 'https://api.github.com/orgs/AssistosTest/repos') {
                return Response.json({
                    full_name: 'AssistosTest/new-app',
                    name: 'new-app',
                    owner: { login: 'AssistosTest', type: 'Organization' },
                    private: true,
                    html_url: 'https://github.com/AssistosTest/new-app',
                    clone_url: 'https://github.com/AssistosTest/new-app.git',
                    default_branch: 'main'
                }, { status: 201 });
            }
            return new Response('', { status: 500 });
        };
        try {
            const gitService = createGitService({ validatePath: async (value) => value });
            const result = await gitService.gitCreateGithubRepository({
                path: workspaceDir,
                owner: 'AssistosTest',
                name: 'new-app',
                visibility: 'private',
                token: 'token'
            });

            assert.equal(result.ok, true);
            assert.equal(path.basename(result.repoPath), 'new-app');
            assert.equal(runGit(result.repoPath, ['remote', 'get-url', 'origin']), 'https://github.com/AssistosTest/new-app.git');
            assert.deepEqual(calls, [
                { url: 'https://api.github.com/user', method: 'GET' },
                { url: 'https://api.github.com/orgs/AssistosTest/repos', method: 'POST' }
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

test('gitCloneRepository clones into a new local directory', async () => {
    await withTempWorkspace(async (workspaceDir) => {
        const sourceRepo = path.join(workspaceDir, 'source');
        const bareRepo = path.join(workspaceDir, 'source.git');
        await fs.mkdir(sourceRepo);
        runGit(sourceRepo, ['init']);
        await fs.writeFile(path.join(sourceRepo, 'README.md'), '# Source\n', 'utf8');
        runGit(sourceRepo, ['add', 'README.md']);
        runGit(sourceRepo, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
        runGit(workspaceDir, ['clone', '--bare', sourceRepo, bareRepo]);

        const gitService = createGitService({ validatePath: async (value) => value });
        const result = await gitService.gitCloneRepository({
            path: workspaceDir,
            name: 'cloned',
            remoteUrl: bareRepo
        });

        assert.equal(result.ok, true);
        assert.equal(path.basename(result.repoPath), 'cloned');
        assert.equal(await fs.readFile(path.join(result.repoPath, 'README.md'), 'utf8'), '# Source\n');
        assert.equal(runGit(result.repoPath, ['remote', 'get-url', 'origin']), bareRepo);
    });
});
