import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../lib/settings.mjs';

test('settings use documented defaults and persist atomically', async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-monitor-settings-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const env = { WORKSPACE_MONITOR_DATA_ROOT: root };
    assert.deepEqual(await readSettings(env), DEFAULT_SETTINGS);
    const updated = { ...DEFAULT_SETTINGS, routerCpuPercent: 72.5, routerMemoryBytes: 900_000_000 };
    assert.deepEqual(await writeSettings(updated, env), updated);
    assert.deepEqual(await readSettings(env), updated);
    assert.equal((await fs.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('settings reject invalid thresholds', async () => {
    await assert.rejects(writeSettings({ ...DEFAULT_SETTINGS, workspaceMemoryBytes: 0 }, { WORKSPACE_MONITOR_DATA_ROOT: os.tmpdir() }), /workspaceMemoryBytes/);
});
