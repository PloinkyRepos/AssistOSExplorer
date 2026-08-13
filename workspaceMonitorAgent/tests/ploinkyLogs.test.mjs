import assert from 'node:assert/strict';
import test from 'node:test';

import { callPloinkyLogs, getPloinkyLog, maintainPloinkyLogs } from '../lib/ploinkyLogs.mjs';
import { millisecondsUntilNextUtcDay, runLogMaintenance } from '../server/logMaintenance.mjs';

test('Ploinky log client signs the exact POST body and returns the response', async () => {
    let signed = null;
    let request = null;
    const result = await callPloinkyLogs({ action: 'list', source: 'router' }, {
        env: { PLOINKY_INTERNAL_ROUTER_URL: 'http://router.internal' },
        signImpl(input) { signed = input; return 'assertion'; },
        async fetchImpl(url, options) {
            request = { url, options };
            return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
        },
    });
    assert.deepEqual(result, { ok: true, items: [] });
    assert.equal(request.url, 'http://router.internal/api/edge/workspace-logs');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['ploinky-agent-assertion'], 'assertion');
    assert.equal(Buffer.compare(signed.body, request.options.body), 0);
});

test('log helpers request live Ploinky files and maintenance without local archives', async () => {
    const bodies = [];
    const options = {
        env: { PLOINKY_INTERNAL_ROUTER_URL: 'http://router.internal' },
        signImpl: () => 'assertion',
        async fetchImpl(_url, request) {
            bodies.push(JSON.parse(request.body.toString('utf8')));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        },
    };
    await getPloinkyLog('router', { name: 'live', maxBytes: 100 }, options);
    await maintainPloinkyLogs(7, options);
    assert.deepEqual(bodies, [
        { action: 'get', source: 'router', name: 'live', maxBytes: 100 },
        { action: 'maintenance', retentionDays: 7 },
    ]);
});

test('maintenance runs at startup and then schedules the next UTC day', async () => {
    const calls = [];
    const waits = [];
    const controller = new AbortController();
    await runLogMaintenance({
        signal: controller.signal,
        readSettingsImpl: async () => ({ logRetentionDays: 11 }),
        maintainImpl: async (days) => { calls.push(days); },
        now: () => new Date('2026-08-13T22:30:00.000Z'),
        waitImpl: async (delay) => { waits.push(delay); controller.abort(); },
    });
    assert.deepEqual(calls, [11]);
    assert.deepEqual(waits, [90 * 60 * 1000]);
    assert.equal(millisecondsUntilNextUtcDay(new Date('2026-08-13T23:59:59.000Z')), 1000);
});

test('failed maintenance retries with bounded backoff', async () => {
    const waits = [];
    const controller = new AbortController();
    let attempts = 0;
    await runLogMaintenance({
        signal: controller.signal,
        readSettingsImpl: async () => ({ logRetentionDays: 7 }),
        maintainImpl: async () => { attempts += 1; throw new Error('offline'); },
        waitImpl: async (delay) => { waits.push(delay); if (waits.length === 3) controller.abort(); },
    });
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [1000, 2000, 4000]);
});
