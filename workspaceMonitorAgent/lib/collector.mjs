import { readSettings } from './settings.mjs';
import { persistSamples } from './sqliteStore.mjs';

export const PERSIST_INTERVAL_MS = 10_000;
const PRIVATE_PATH = '/api/edge/workspace-metrics';
const PRIVATE_QUERY = '?follow=1';

function metricDefinitions(snapshot, settings) {
    const runtimes = Array.isArray(snapshot?.runtimes) ? snapshot.runtimes : [];
    const runtimeTotals = runtimes.reduce((sum, runtime) => ({
        cpuPercent: sum.cpuPercent + (runtime?.metrics?.available === false ? 0 : Number(runtime?.metrics?.cpuPercent) || 0),
        memoryBytes: sum.memoryBytes + (runtime?.metrics?.available === false ? 0 : Number(runtime?.metrics?.memoryBytes) || 0),
    }), { cpuPercent: 0, memoryBytes: 0 });
    const routerCpu = Number(snapshot?.router?.metrics?.cpuPercent);
    const routerMemory = Number(snapshot?.router?.metrics?.memoryBytes);
    const agentsCpu = runtimes.length ? runtimeTotals.cpuPercent : Number(snapshot?.total?.cpuPercent) - routerCpu;
    const agentsMemory = runtimes.length ? runtimeTotals.memoryBytes : Number(snapshot?.total?.memoryBytes) - routerMemory;
    return [
        { key: 'workspace.cpu', scope: 'workspace', resource: 'cpu', value: agentsCpu, threshold: settings.workspaceCpuPercent },
        { key: 'workspace.memory', scope: 'workspace', resource: 'memory', value: agentsMemory, threshold: settings.workspaceMemoryBytes },
        { key: 'router.cpu', scope: 'router', resource: 'cpu', value: routerCpu, threshold: settings.routerCpuPercent },
        { key: 'router.memory', scope: 'router', resource: 'memory', value: routerMemory, threshold: settings.routerMemoryBytes },
    ];
}

export function createSnapshotProcessor({
    readSettingsImpl = readSettings,
    persistSamplesImpl = persistSamples,
    now = () => Date.now(),
} = {}) {
    const lastPersisted = new Map();
    return async function processSnapshot(snapshot) {
        const settings = await readSettingsImpl();
        const timestamp = Number.isFinite(Date.parse(snapshot?.sampledAt)) ? Date.parse(snapshot.sampledAt) : now();
        const due = metricDefinitions(snapshot, settings).filter((metric) => Number.isFinite(metric.value)
            && timestamp - Number(lastPersisted.get(metric.key) || 0) >= PERSIST_INTERVAL_MS);
        if (!due.length) return { persisted: [] };
        await persistSamplesImpl(due, timestamp);
        for (const metric of due) lastPersisted.set(metric.key, timestamp);
        return { persisted: due.map((metric) => metric.key) };
    };
}

export async function consumeNdjson(response, onSnapshot) {
    if (!response.ok || !response.body) throw new Error(`Metrics stream failed with HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) await onSnapshot(JSON.parse(line));
        }
        if (done) {
            if (buffer.trim()) await onSnapshot(JSON.parse(buffer));
            return;
        }
    }
}

async function loadAssertionSigner() {
    const module = await import('/Agent/lib/agentAssertion.mjs');
    if (typeof module.signPrivateRouterAssertion !== 'function') throw new Error('Private Router assertion signer is unavailable.');
    return module.signPrivateRouterAssertion;
}

export async function runCollector({ env = process.env, fetchImpl = fetch, signal } = {}) {
    const routerUrl = String(env.PLOINKY_INTERNAL_ROUTER_URL || '').replace(/\/$/, '');
    if (!routerUrl) throw new Error('PLOINKY_INTERNAL_ROUTER_URL is required.');
    const sign = await loadAssertionSigner();
    const processSnapshot = createSnapshotProcessor();
    let delayMs = 1_000;
    let persistenceRetryAt = 0;
    let persistenceDelayMs = 1_000;
    while (!signal?.aborted) {
        try {
            const assertion = sign({ method: 'GET', path: PRIVATE_PATH, query: PRIVATE_QUERY, env });
            const response = await fetchImpl(`${routerUrl}${PRIVATE_PATH}${PRIVATE_QUERY}`, {
                headers: { 'ploinky-agent-assertion': assertion, accept: 'application/x-ndjson' },
                signal,
            });
            delayMs = 1_000;
            await consumeNdjson(response, async (snapshot) => {
                if (Date.now() < persistenceRetryAt) return;
                try {
                    await processSnapshot(snapshot);
                    persistenceRetryAt = 0;
                    persistenceDelayMs = 1_000;
                } catch (error) {
                    persistenceRetryAt = Date.now() + persistenceDelayMs;
                    persistenceDelayMs = Math.min(persistenceDelayMs * 2, 30_000);
                    console.error(`[workspace-monitor] sample persistence failed: ${error?.message || error}`);
                }
            });
        } catch (error) {
            if (signal?.aborted) return;
            console.error(`[workspace-monitor] metrics stream unavailable: ${error?.message || error}`);
        }
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, delayMs);
            signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        delayMs = Math.min(delayMs * 2, 30_000);
    }
}
