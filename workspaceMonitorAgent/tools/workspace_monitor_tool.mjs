#!/usr/bin/env node
import { assertAdministrator } from '../lib/admin.mjs';
import { readSettings, writeSettings } from '../lib/settings.mjs';
import { queryHistory } from '../lib/sqliteStore.mjs';

async function readInput() {
    if (process.stdin.isTTY) return {};
    process.stdin.setEncoding('utf8');
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    if (!text.trim()) return {};
    const envelope = JSON.parse(text);
    return envelope && typeof envelope === 'object' ? envelope : {};
}

function unwrapInput(envelope) {
    return envelope?.input || envelope?.arguments || envelope?.params?.arguments || envelope?.params?.input || {};
}

async function invocationActor(envelope) {
    const modulePath = process.env.PLOINKY_INVOCATION_AUTH_MODULE || '/Agent/lib/invocation-auth.mjs';
    const { authInfoFromInvocation } = await import(modulePath);
    const invocation = envelope?.metadata?.invocation;
    if (!invocation) throw new Error('Authenticated invocation metadata is required.');
    return authInfoFromInvocation(invocation, { invocationToken: envelope?.metadata?.invocationToken || '' });
}

async function main() {
    const envelope = await readInput();
    assertAdministrator(await invocationActor(envelope));
    const input = unwrapInput(envelope);
    let result;
    switch (process.env.TOOL_NAME) {
        case 'workspace_monitor_settings_get':
            result = { ok: true, settings: await readSettings() };
            break;
        case 'workspace_monitor_settings_update':
            result = { ok: true, settings: await writeSettings(input) };
            break;
        case 'workspace_monitor_history_query':
            result = await queryHistory(input);
            break;
        default:
            throw new Error('Unsupported Workspace Monitor tool.');
    }
    process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: 'workspace_monitor_tool_failed', message: error?.message || String(error) }));
    process.exitCode = 1;
});
