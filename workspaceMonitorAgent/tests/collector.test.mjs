import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createCollectorSnapshotConsumer,
    createSnapshotProcessor,
    PERSIST_INTERVAL_MS,
} from '../lib/collector.mjs';

const settings = {
    workspaceCpuPercent: 80,
    workspaceMemoryBytes: 4_000,
    routerCpuPercent: 80,
    routerMemoryBytes: 500,
};

function snapshot(timestamp, overrides = {}) {
    const total = { cpuPercent: 110, memoryBytes: 3_600, ...(overrides.total || {}) };
    const router = { cpuPercent: 20, memoryBytes: 600, ...(overrides.router || {}) };
    return {
        sampledAt: new Date(timestamp).toISOString(),
        total,
        router: { metrics: router },
        runtimes: [{ repoName: 'AchillesIDE', agentName: 'explorer', containerName: 'runtime-123', metrics: { available: true, cpuPercent: 90, memoryBytes: 3_000 } }],
    };
}

test('collector persists every metric and enforces the ten-second cadence per series', async () => {
    const writes = [];
    const processSnapshot = createSnapshotProcessor({
        readSettingsImpl: async () => settings,
        persistSamplesImpl: async (samples, timestamp) => writes.push({ samples, timestamp }),
    });
    const start = Date.parse('2026-08-11T10:00:00Z');
    assert.deepEqual((await processSnapshot(snapshot(start))).persisted, ['workspace.cpu', 'workspace.memory', 'router.cpu', 'router.memory', 'runtime:AchillesIDE%2Fexplorer:cpu', 'runtime:AchillesIDE%2Fexplorer:memory']);
    assert.deepEqual((await processSnapshot(snapshot(start + PERSIST_INTERVAL_MS - 1))).persisted, []);
    assert.deepEqual((await processSnapshot(snapshot(start + PERSIST_INTERVAL_MS))).persisted, ['workspace.cpu', 'workspace.memory', 'router.cpu', 'router.memory', 'runtime:AchillesIDE%2Fexplorer:cpu', 'runtime:AchillesIDE%2Fexplorer:memory']);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].timestamp, start);
    assert.deepEqual(writes[0].samples.map(({ key, value, threshold }) => ({ key, value, threshold })), [
        { key: 'workspace.cpu', value: 90, threshold: 80 },
        { key: 'workspace.memory', value: 3_000, threshold: 4_000 },
        { key: 'router.cpu', value: 20, threshold: 80 },
        { key: 'router.memory', value: 600, threshold: 500 },
        { key: 'runtime:AchillesIDE%2Fexplorer:cpu', value: 90, threshold: 0 },
        { key: 'runtime:AchillesIDE%2Fexplorer:memory', value: 3_000, threshold: 0 },
    ]);
});

test('collector derives Agents independently from Router and total', async () => {
    const writes = [];
    const processSnapshot = createSnapshotProcessor({
        readSettingsImpl: async () => settings,
        persistSamplesImpl: async (samples) => writes.push(samples),
    });
    await processSnapshot(snapshot(Date.parse('2026-08-11T10:00:00Z')));
    assert.deepEqual(writes[0].map(({ key, value }) => ({ key, value })), [
        { key: 'workspace.cpu', value: 90 },
        { key: 'workspace.memory', value: 3_000 },
        { key: 'router.cpu', value: 20 },
        { key: 'router.memory', value: 600 },
        { key: 'runtime:AchillesIDE%2Fexplorer:cpu', value: 90 },
        { key: 'runtime:AchillesIDE%2Fexplorer:memory', value: 3_000 },
    ]);
});

test('failed SQLite writes do not consume the persistence checkpoint', async () => {
    let attempts = 0;
    const processSnapshot = createSnapshotProcessor({
        readSettingsImpl: async () => settings,
        persistSamplesImpl: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('unavailable');
        },
    });
    const start = Date.parse('2026-08-11T10:00:00Z');
    await assert.rejects(processSnapshot(snapshot(start)), /unavailable/);
    assert.deepEqual((await processSnapshot(snapshot(start + 1))).persisted, ['workspace.cpu', 'workspace.memory', 'router.cpu', 'router.memory', 'runtime:AchillesIDE%2Fexplorer:cpu', 'runtime:AchillesIDE%2Fexplorer:memory']);
});

test('current snapshot and history retries remain independent', async () => {
    let timestamp = 1_000;
    let currentAttempts = 0;
    let historyAttempts = 0;
    const errors = [];
    const consumeSnapshot = createCollectorSnapshotConsumer({
        env: { WORKSPACE_MONITOR_DATA_ROOT: '/unused' },
        now: () => timestamp,
        writeCurrentSnapshotImpl: async () => {
            currentAttempts += 1;
            if (currentAttempts === 1) throw new Error('current unavailable');
        },
        processSnapshotImpl: async () => {
            historyAttempts += 1;
            if (historyAttempts === 1) throw new Error('history unavailable');
        },
        reportError: (message) => errors.push(message),
    });

    await consumeSnapshot(snapshot(timestamp));
    timestamp += 999;
    await consumeSnapshot(snapshot(timestamp));
    assert.deepEqual([currentAttempts, historyAttempts], [1, 1]);

    timestamp += 1;
    await consumeSnapshot(snapshot(timestamp));
    assert.deepEqual([currentAttempts, historyAttempts], [2, 2]);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /current snapshot write failed/);
    assert.match(errors[1], /sample persistence failed/);
});
