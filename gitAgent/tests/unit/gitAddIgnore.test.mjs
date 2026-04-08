import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempRepo(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-add-ignore-'));
    try {
        const init = spawnSync('git', ['init'], { cwd: tempDir, encoding: 'utf8' });
        if (init.status !== 0) {
            throw new Error(init.stderr || init.stdout || 'git init failed');
        }
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

test('gitAddIgnore appends file and directory patterns without duplication', async () => {
    await withTempRepo(async (repoDir) => {
        const filePath = path.join(repoDir, 'notes.txt');
        const dirPath = path.join(repoDir, 'build');
        await fs.writeFile(filePath, 'hello', 'utf8');
        await fs.mkdir(dirPath);
        await fs.writeFile(path.join(dirPath, 'artifact.txt'), 'artifact', 'utf8');
        const addTracked = spawnSync('git', ['add', 'notes.txt', 'build/artifact.txt'], { cwd: repoDir, encoding: 'utf8' });
        if (addTracked.status !== 0) {
            throw new Error(addTracked.stderr || addTracked.stdout || 'git add failed');
        }

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const firstFile = await gitService.gitAddIgnore({ path: filePath });
        assert.deepEqual(firstFile.added, ['notes.txt']);
        assert.deepEqual(firstFile.alreadyPresent, []);
        assert.equal(firstFile.stopTracking, true);
        assert.deepEqual(firstFile.untrackedPaths, ['notes.txt']);

        const firstDir = await gitService.gitAddIgnore({ path: dirPath });
        assert.deepEqual(firstDir.added, ['build/']);
        assert.deepEqual(firstDir.alreadyPresent, []);
        assert.equal(firstDir.stopTracking, true);
        assert.deepEqual(firstDir.untrackedPaths, ['build/artifact.txt']);

        const duplicateFile = await gitService.gitAddIgnore({ path: filePath });
        assert.deepEqual(duplicateFile.added, []);
        assert.deepEqual(duplicateFile.alreadyPresent, ['notes.txt']);
        assert.equal(duplicateFile.stopTracking, false);

        const ignoreContent = await fs.readFile(path.join(repoDir, '.gitignore'), 'utf8');
        assert.equal(ignoreContent, 'notes.txt\nbuild/\n');

        const trackedAfter = spawnSync('git', ['ls-files', '-z', '--', 'notes.txt', 'build/artifact.txt'], {
            cwd: repoDir,
            encoding: 'utf8'
        });
        assert.equal(trackedAfter.stdout, '');
    });
});

test('gitInfo returns repo root and repo-relative path for file targets', async () => {
    await withTempRepo(async (repoDir) => {
        const nestedDir = path.join(repoDir, 'src');
        const filePath = path.join(nestedDir, 'notes.txt');
        await fs.mkdir(nestedDir);
        await fs.writeFile(filePath, 'hello', 'utf8');
        const normalizedRepoDir = await fs.realpath(repoDir);

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const info = await gitService.gitInfo({ path: filePath });
        assert.equal(info.ok, true);
        assert.equal(info.repoPath, normalizedRepoDir);
        assert.equal(info.repoRelativePath, 'src/notes.txt');
    });
});

test('gitRemoveIgnore removes rule and restores tracking', async () => {
    await withTempRepo(async (repoDir) => {
        const filePath = path.join(repoDir, 'notes.txt');
        await fs.writeFile(filePath, 'hello', 'utf8');
        const addTracked = spawnSync('git', ['add', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
        if (addTracked.status !== 0) {
            throw new Error(addTracked.stderr || addTracked.stdout || 'git add failed');
        }

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const ignored = await gitService.gitAddIgnore({ path: filePath });
        assert.equal(ignored.stopTracking, true);

        const removed = await gitService.gitRemoveIgnore({ path: filePath });
        assert.equal(removed.ok, true);
        assert.equal(removed.removed, true);
        assert.equal(removed.retracked, true);

        const ignoreContent = await fs.readFile(path.join(repoDir, '.gitignore'), 'utf8');
        assert.equal(ignoreContent, '\n');

        const trackedAfter = spawnSync('git', ['ls-files', '--', 'notes.txt'], {
            cwd: repoDir,
            encoding: 'utf8'
        });
        assert.equal(trackedAfter.stdout.trim(), 'notes.txt');
    });
});

test('gitAddIgnore force-untracks staged content that differs from HEAD and worktree', async () => {
    await withTempRepo(async (repoDir) => {
        const filePath = path.join(repoDir, 'notes.txt');
        await fs.writeFile(filePath, 'v1\n', 'utf8');
        let result = spawnSync('git', ['add', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || 'git add failed');
        }
        result = spawnSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], {
            cwd: repoDir,
            encoding: 'utf8'
        });
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || 'git commit failed');
        }

        await fs.writeFile(filePath, 'v2-worktree\n', 'utf8');
        result = spawnSync('git', ['add', 'notes.txt'], { cwd: repoDir, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || 'git add staged update failed');
        }
        await fs.writeFile(filePath, 'v3-worktree-only\n', 'utf8');

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const ignored = await gitService.gitAddIgnore({ path: filePath });
        assert.equal(ignored.ok, true);
        assert.equal(ignored.stopTracking, true);
        assert.deepEqual(ignored.untrackedPaths, ['notes.txt']);

        const trackedAfter = spawnSync('git', ['ls-files', '--', 'notes.txt'], {
            cwd: repoDir,
            encoding: 'utf8'
        });
        assert.equal(trackedAfter.stdout.trim(), '');

        const statusAfter = spawnSync('git', ['status', '--short', '--ignored', '--', 'notes.txt'], {
            cwd: repoDir,
            encoding: 'utf8'
        });
        assert.match(statusAfter.stdout, /!!\s+notes\.txt/);
    });
});
