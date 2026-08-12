#!/usr/bin/env node
import { runCollector } from '../lib/collector.mjs';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());

runCollector({ signal: controller.signal }).catch((error) => {
    console.error(`[workspace-monitor] collector stopped: ${error?.message || error}`);
    process.exitCode = 1;
});
