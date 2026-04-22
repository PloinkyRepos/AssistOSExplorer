import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createGitService } from '../../lib/git-service.mjs';

async function withTempRepo(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-stash-'));
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

test('gitStash succeeds when repository contains ignored directories', async () => {
    await withTempRepo(async (repoDir) => {
        await fs.writeFile(path.join(repoDir, '.gitignore'), 'node_modules/\npackage-lock.json\n', 'utf8');
        await fs.writeFile(path.join(repoDir, 'test.js'), 'console.log(\"x\");\n', 'utf8');

        let result = spawnSync('git', ['add', '.gitignore', 'test.js'], { cwd: repoDir, encoding: 'utf8' });
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

        await fs.writeFile(path.join(repoDir, 'test.js'), 'console.log(\"changed\");\n', 'utf8');
        await fs.mkdir(path.join(repoDir, 'node_modules'));
        await fs.writeFile(path.join(repoDir, 'node_modules', 'dep.js'), 'module.exports = 1;\n', 'utf8');
        await fs.writeFile(path.join(repoDir, 'package-lock.json'), '{}\n', 'utf8');

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const stashed = await gitService.gitStash({
            path: repoDir,
            includeUntracked: true,
            message: 'webskel:auto-pull'
        });

        assert.equal(stashed.ok, true);
        assert.equal(stashed.created, true);
        assert.equal(stashed.usedAll, false);
        assert.match(String(stashed.output || ''), /Saved working directory|Saved local changes/i);
    });
});

test('gitStash ignores stop-tracking ignored files and leaves unrelated local artifacts alone', async () => {
    await withTempRepo(async (repoDir) => {
        const trackedFile = path.join(repoDir, 'notes.txt');
        await fs.writeFile(trackedFile, 'v1\n', 'utf8');

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

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const ignored = await gitService.gitAddIgnore({ path: trackedFile });
        assert.equal(ignored.ok, true);
        assert.equal(ignored.stopTracking, true);

        await fs.mkdir(path.join(repoDir, 'node_modules'));
        await fs.writeFile(path.join(repoDir, 'node_modules', 'dep.js'), 'module.exports = 1;\n', 'utf8');

        const stashed = await gitService.gitStash({
            path: repoDir,
            includeUntracked: true,
            message: 'webskel:auto-pull'
        });

        assert.equal(stashed.ok, true);
        assert.equal(stashed.created, true);
        assert.equal(stashed.usedAll, false);

        const ignoredStillExists = await fs.readFile(path.join(repoDir, 'notes.txt'), 'utf8');
        assert.equal(ignoredStillExists, 'v1\n');

        const untrackedDir = await fs.stat(path.join(repoDir, 'node_modules'));
        assert.equal(untrackedDir.isDirectory(), true);
    });
});

test('gitStashList returns stable ordinal refs and gitStashPop accepts raw stash commit ids', async () => {
    await withTempRepo(async (repoDir) => {
        await fs.writeFile(path.join(repoDir, 'notes.txt'), 'v1\n', 'utf8');

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

        await fs.writeFile(path.join(repoDir, 'notes.txt'), 'v2\n', 'utf8');

        const gitService = createGitService({
            validatePath: async (value) => value
        });

        const stashed = await gitService.gitStash({
            path: repoDir,
            includeUntracked: true,
            message: 'ordinal-ref-test'
        });
        assert.equal(stashed.ok, true);
        assert.equal(stashed.created, true);
        assert.equal(stashed.ref, 'stash@{0}');

        const listed = await gitService.gitStashList({ path: repoDir });
        assert.equal(listed.ok, true);
        assert.equal(Array.isArray(listed.entries), true);
        assert.equal(listed.entries.length, 1);
        assert.equal(listed.entries[0].ref, 'stash@{0}');
        assert.match(String(listed.entries[0].oid || ''), /^[0-9a-f]{40}$/i);

        const popped = await gitService.gitStashPop({
            path: repoDir,
            ref: listed.entries[0].oid,
            reinstateIndex: true
        });
        assert.equal(popped.ok, true);
        assert.equal(popped.noStash, false);

        const content = await fs.readFile(path.join(repoDir, 'notes.txt'), 'utf8');
        assert.equal(content, 'v2\n');
    });
});
