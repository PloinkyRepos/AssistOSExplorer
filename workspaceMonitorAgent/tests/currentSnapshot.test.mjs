import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    CURRENT_SNAPSHOT_MAX_AGE_MS,
    currentSnapshotPath,
    currentSnapshotState,
    readCurrentSnapshot,
    writeCurrentSnapshot,
} from '../lib/currentSnapshot.mjs';

function snapshot(sampledAt) {
    return {
        sampledAt,
        router: {
            status: 'running',
            pid: 1234,
            metrics: { available: true, cpuPercent: 4.5, memoryBytes: 512, secret: 'omit-me' },
        },
        runtimes: [{
            containerName: 'explorer-container',
            agentName: 'explorer',
            repoName: 'AchillesIDE',
            runtime: 'podman',
            enabled: true,
            state: { status: 'running', running: true, pid: 999 },
            metrics: { available: true, cpuPercent: 12.5, memoryBytes: 2_048 },
            privateField: 'omit-me',
        }],
        total: { cpuPercent: 17, memoryBytes: 2_560 },
        unexpected: 'omit-me',
    };
}

async function temporaryEnvironment(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-monitor-current-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { WORKSPACE_MONITOR_DATA_ROOT: root };
}

test('current snapshot is atomically persisted as an allowlisted resource projection', async (t) => {
    const env = await temporaryEnvironment(t);
    const sampledAt = '2026-08-27T10:00:00.000Z';
    const written = await writeCurrentSnapshot(snapshot(sampledAt), env);
    assert.deepEqual(await readCurrentSnapshot(env), written);
    assert.equal(Object.hasOwn(written, 'unexpected'), false);
    assert.equal(Object.hasOwn(written.router, 'pid'), false);
    assert.equal(Object.hasOwn(written.router.metrics, 'secret'), false);
    assert.equal(Object.hasOwn(written.runtimes[0], 'privateField'), false);
    assert.equal(Object.hasOwn(written.runtimes[0].state, 'pid'), false);
    assert.equal((await fs.stat(currentSnapshotPath(env))).mode & 0o777, 0o600);
    assert.equal((await fs.readdir(env.WORKSPACE_MONITOR_DATA_ROOT)).some((name) => name.endsWith('.tmp')), false);
});

test('current snapshot state distinguishes unavailable, fresh, and stale data', async (t) => {
    const env = await temporaryEnvironment(t);
    assert.deepEqual(await currentSnapshotState({ env }), {
        ok: true,
        available: false,
        stale: true,
        ageMs: null,
        snapshot: null,
    });

    const sampledAt = Date.parse('2026-08-27T10:00:00.000Z');
    await writeCurrentSnapshot(snapshot(new Date(sampledAt).toISOString()), env);
    const fresh = await currentSnapshotState({ env, now: () => sampledAt + CURRENT_SNAPSHOT_MAX_AGE_MS });
    assert.equal(fresh.available, true);
    assert.equal(fresh.stale, false);
    assert.equal(fresh.ageMs, CURRENT_SNAPSHOT_MAX_AGE_MS);

    const stale = await currentSnapshotState({ env, now: () => sampledAt + CURRENT_SNAPSHOT_MAX_AGE_MS + 1 });
    assert.equal(stale.available, true);
    assert.equal(stale.stale, true);
});

test('current snapshot rejects malformed source data', async (t) => {
    const env = await temporaryEnvironment(t);
    await assert.rejects(writeCurrentSnapshot({ sampledAt: 'invalid', runtimes: [] }, env), /sampledAt/);
    await fs.writeFile(currentSnapshotPath(env), '{not-json', 'utf8');
    await assert.rejects(readCurrentSnapshot(env), /JSON/);

    await fs.writeFile(currentSnapshotPath(env), 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8');
    await assert.rejects(readCurrentSnapshot(env), /exceeds the supported size/);
});

test('current snapshot rejects an oversized normalized projection before replacing the current file', async (t) => {
    const env = await temporaryEnvironment(t);
    const sampledAt = '2026-08-27T10:00:00.000Z';
    const original = await writeCurrentSnapshot(snapshot(sampledAt), env);
    const runtime = {
        containerName: 'c'.repeat(512),
        agentName: 'a'.repeat(512),
        repoName: 'r'.repeat(512),
        runtime: 'container',
        enabled: true,
        state: { status: 'running', running: true },
        metrics: { available: true, cpuPercent: 1, memoryBytes: 2 },
    };
    await assert.rejects(writeCurrentSnapshot({
        sampledAt,
        router: snapshot(sampledAt).router,
        runtimes: Array.from({ length: 2_048 }, () => runtime),
        total: { cpuPercent: 1, memoryBytes: 2 },
    }, env), /exceeds the supported size/);
    assert.deepEqual(await readCurrentSnapshot(env), original);
});
