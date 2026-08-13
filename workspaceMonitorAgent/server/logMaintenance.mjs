import { maintainPloinkyLogs } from '../lib/ploinkyLogs.mjs';
import { readSettings } from '../lib/settings.mjs';
import { pathToFileURL } from 'node:url';

const MAX_RETRY_MS = 30_000;

export function millisecondsUntilNextUtcDay(now = new Date()) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

function wait(delayMs, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        timer.unref?.();
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

export async function runLogMaintenance({
    signal,
    readSettingsImpl = readSettings,
    maintainImpl = maintainPloinkyLogs,
    now = () => new Date(),
    waitImpl = wait,
} = {}) {
    let retryMs = 1_000;
    while (!signal?.aborted) {
        try {
            const settings = await readSettingsImpl();
            await maintainImpl(settings.logRetentionDays, { signal });
            retryMs = 1_000;
            await waitImpl(millisecondsUntilNextUtcDay(now()), signal);
        } catch (error) {
            if (signal?.aborted) return;
            console.error(`[workspace-monitor] log maintenance failed: ${error?.message || error}`);
            await waitImpl(retryMs, signal);
            retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        }
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const controller = new AbortController();
    for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => controller.abort());
    await runLogMaintenance({ signal: controller.signal });
}
