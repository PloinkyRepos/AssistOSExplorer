import fs from 'node:fs/promises';
import path from 'node:path';

import { dataRoot } from './settings.mjs';

export const CURRENT_SNAPSHOT_MAX_AGE_MS = 15_000;
const CURRENT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
const CURRENT_SNAPSHOT_MAX_RUNTIMES = 4_096;

export function currentSnapshotPath(env = process.env) {
    return path.join(dataRoot(env), 'current-snapshot.json');
}

function boundedString(value, fallback = '', maxLength = 512) {
    return String(value ?? fallback).slice(0, maxLength);
}

function finiteMetric(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeMetrics(value = {}) {
    return {
        available: value?.available === true,
        cpuPercent: finiteMetric(value?.cpuPercent),
        memoryBytes: finiteMetric(value?.memoryBytes),
    };
}

function normalizeRuntime(value = {}) {
    return {
        containerName: boundedString(value?.containerName),
        agentName: boundedString(value?.agentName, '-'),
        repoName: boundedString(value?.repoName, '-'),
        runtime: boundedString(value?.runtime, 'container', 128),
        enabled: Boolean(value?.enabled),
        state: {
            status: boundedString(value?.state?.status, 'unknown', 128),
            running: Boolean(value?.state?.running),
        },
        metrics: normalizeMetrics(value?.metrics),
    };
}

export function normalizeCurrentSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Current resource snapshot must be an object.');
    }
    const sampledAtMs = Date.parse(value.sampledAt);
    if (!Number.isFinite(sampledAtMs)) {
        throw new Error('Current resource snapshot requires a valid sampledAt instant.');
    }
    if (!Array.isArray(value.runtimes) || value.runtimes.length > CURRENT_SNAPSHOT_MAX_RUNTIMES) {
        throw new Error(`Current resource snapshot runtimes must contain at most ${CURRENT_SNAPSHOT_MAX_RUNTIMES} entries.`);
    }
    return {
        ok: true,
        sampledAt: new Date(sampledAtMs).toISOString(),
        router: {
            status: boundedString(value?.router?.status, 'unknown', 128),
            metrics: normalizeMetrics(value?.router?.metrics),
        },
        runtimes: value.runtimes.map(normalizeRuntime),
        total: {
            cpuPercent: finiteMetric(value?.total?.cpuPercent),
            memoryBytes: finiteMetric(value?.total?.memoryBytes),
        },
    };
}

export async function writeCurrentSnapshot(value, env = process.env) {
    const normalized = normalizeCurrentSnapshot(value);
    const serialized = `${JSON.stringify(normalized)}\n`;
    if (Buffer.byteLength(serialized) > CURRENT_SNAPSHOT_MAX_BYTES) {
        throw new Error('Current resource snapshot exceeds the supported size.');
    }
    const target = currentSnapshotPath(env);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
        await fs.writeFile(temporary, serialized, {
            encoding: 'utf8',
            mode: 0o600,
        });
        await fs.rename(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return normalized;
}

export async function readCurrentSnapshot(env = process.env) {
    const target = currentSnapshotPath(env);
    let size;
    try {
        size = (await fs.stat(target)).size;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
    if (size > CURRENT_SNAPSHOT_MAX_BYTES) {
        throw new Error('Current resource snapshot exceeds the supported size.');
    }
    let text;
    try {
        text = await fs.readFile(target, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
    if (Buffer.byteLength(text) > CURRENT_SNAPSHOT_MAX_BYTES) {
        throw new Error('Current resource snapshot exceeds the supported size.');
    }
    return normalizeCurrentSnapshot(JSON.parse(text));
}

export async function currentSnapshotState({
    env = process.env,
    now = () => Date.now(),
} = {}) {
    const snapshot = await readCurrentSnapshot(env);
    if (!snapshot) {
        return { ok: true, available: false, stale: true, ageMs: null, snapshot: null };
    }
    const ageMs = Math.max(0, now() - Date.parse(snapshot.sampledAt));
    return {
        ok: true,
        available: true,
        stale: ageMs > CURRENT_SNAPSHOT_MAX_AGE_MS,
        ageMs,
        snapshot,
    };
}
