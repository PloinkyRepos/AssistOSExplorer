#!/usr/bin/env node
import { spawn } from 'node:child_process';

const children = new Set();
let stopping = false;

function start(command, args, options = {}) {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env, ...options });
    children.add(child);
    child.once('close', () => children.delete(child));
    return child;
}

function supervise(label, command, args) {
    let delayMs = 1_000;
    const launch = () => {
        if (stopping) return;
        const child = start(command, args);
        child.once('close', (code) => {
            if (stopping) return;
            console.error(`[workspace-monitor] ${label} stopped unexpectedly (${code ?? 'signal'}); restarting.`);
            const timer = setTimeout(launch, delayMs);
            timer.unref?.();
            delayMs = Math.min(delayMs * 2, 30_000);
        });
    };
    launch();
}

function stopAll(signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
        try { child.kill(signal); } catch (_) {}
    }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(signal));

supervise('collector', process.execPath, ['/code/server/collector.mjs']);
supervise('log maintenance', process.execPath, ['/code/server/logMaintenance.mjs']);
const agentServer = start('/bin/sh', ['/Agent/server/AgentServer.sh']);

agentServer.once('close', (code, signal) => {
    stopAll();
    process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
});
await new Promise((resolve) => agentServer.once('close', resolve));
