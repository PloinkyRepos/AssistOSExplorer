import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentRoot = new URL('../IDE-plugins/workspace-monitor/components/workspace-monitor-dashboard/', import.meta.url);
const explorerApiUrl = new URL('../../explorer/services/infrastructure/explorerApi.js', import.meta.url).href;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Resolve browser-root imports for Node, without replacing any implementation.
const apiSource = (await readFile(new URL('workspace-monitor-api.js', componentRoot), 'utf8'))
    .replace('/explorer/services/infrastructure/explorerApi.js', explorerApiUrl);
const apiUrl = moduleUrl(apiSource);
const { callMonitor, isTransientHistoryError } = await import(apiUrl);
const dashboardSource = (await readFile(new URL('workspace-monitor-dashboard.js', componentRoot), 'utf8'))
    .replace('./workspace-monitor-api.js', apiUrl)
    .replaceAll(/'\.\/(workspace-monitor-[\w-]+\.js)'/g, (_match, file) => `'${new URL(file, componentRoot).href}'`);
const { WorkspaceMonitorDashboard } = await import(moduleUrl(dashboardSource));
const HISTORY_TOOL = 'workspace_monitor_history_query';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const gatewayError = () => new Error('Error POSTing to endpoint (HTTP 502): <html>origin_bad_gateway private origin details</html>');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function setup(t, respond) {
    const previousWindow = globalThis.window;
    const calls = [];
    const resets = [];
    globalThis.window = { webSkel: { appServices: {
        getClient: () => ({ callTool: (name, args) => {
            calls.push({ name, args });
            return respond(name, args, calls.length);
        } }),
        resetClient: (name) => resets.push(name),
    } } };
    t.after(() => { globalThis.window = previousWindow; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    return { calls, resets };
}

function history(args) {
    return {
        ok: true,
        from: args.from,
        to: args.to,
        stepSeconds: 60,
        series: Object.fromEntries((args.series || ['workspace.cpu']).map((key) => [key, {
            values: [[Date.parse(args.from), 1], [Date.parse(args.to), 2]],
        }])),
    };
}

function dashboard(t, respond) {
    const transport = setup(t, respond);
    const nodes = new Map();
    const node = (role) => {
        if (!nodes.has(role)) nodes.set(role, {
            value: '', textContent: '', hidden: true, clears: 0,
            closest: () => null,
            replaceChildren() { this.clears += 1; },
        });
        return nodes.get(role);
    };
    const element = {
        querySelector: (selector) => {
            const role = /^\[data-role="([\w-]+)"\]$/.exec(selector)?.[1];
            return role ? node(role) : null;
        },
        querySelectorAll: () => [],
    };
    const presenter = new WorkspaceMonitorDashboard(element, () => {});
    const charts = [];
    presenter.renderHistoryChart = (...args) => charts.push(args);
    presenter.resources.entries = [{ key: 'repo%2Fruntime-a', name: 'runtime-a' }];
    presenter.resources.selectedKey = 'repo%2Fruntime-a';
    for (const prefix of ['', 'runtime-']) {
        node(`${prefix}history-from`).value = '2026-01-01T00:00';
        node(`${prefix}history-to`).value = '2026-01-02T00:00';
    }
    t.after(() => presenter.afterUnload());
    return { ...transport, presenter, node, charts };
}

test('selected history recovers from one 502 without reselection or live polling', async (t) => {
    const { presenter, calls, resets, node, charts } = dashboard(t, (_name, args, count) => {
        if (count === 1) throw gatewayError();
        return history(args);
    });
    const pending = presenter.loadSelectedRuntimeHistory();
    await flush();
    assert.equal(calls.length, 1);
    assert.match(node('runtime-history-state').textContent, /Loading runtime-a/);
    t.mock.timers.tick(299);
    await flush();
    assert.equal(calls.length, 1);
    t.mock.timers.tick(1);
    await pending;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(resets, []);
    assert.equal(charts.length, 2);
    assert.equal(node('runtime-history-state').textContent, 'runtime-a: 4 persisted samples');
    assert.equal(node('runtime-history-retry').hidden, true);
});

test('retry budget exhausts at four calls, hides raw error, and manual retry recovers', async (t) => {
    const { presenter, calls, node, charts } = dashboard(t, (_name, args, count) => {
        if (count <= 4) throw gatewayError();
        return history(args);
    });
    const pending = presenter.loadSelectedRuntimeHistory();
    await flush();
    for (const delay of [300, 900, 1800]) {
        t.mock.timers.tick(delay - 1);
        await flush();
        const before = calls.length;
        t.mock.timers.tick(1);
        await flush();
        assert.equal(calls.length, before + 1);
    }
    await pending;
    assert.equal(calls.length, 4);
    assert.match(node('runtime-history-state').textContent, /temporarily unavailable.*Retry history/);
    assert.doesNotMatch(node('runtime-history-state').textContent, /HTTP|html|origin|private/);
    assert.equal(node('runtime-history-retry').hidden, false);
    assert.equal(node('selected-runtime-cpu-history-chart').clears, 1);
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls.length, 4);
    await presenter.loadSelectedRuntimeHistory();
    assert.equal(calls.length, 5);
    assert.equal(charts.length, 2);
    assert.equal(node('runtime-history-retry').hidden, true);
});

test('history retries only recognized transient transport errors', async (t) => {
    for (const error of [
        new Error('HTTP 503 unavailable'), new Error('HTTP 504 timeout'),
        Object.assign(new Error('bad gateway'), { status: 502 }),
        Object.assign(new Error('upstream'), { code: 'origin_bad_gateway' }),
        new TypeError('Failed to fetch'), new TypeError('Load failed'),
    ]) assert.equal(isTransientHistoryError(error), true, error.message);
    const { calls } = setup(t, () => { throw new Error('HTTP 403 origin_bad_gateway administrator required'); });
    await assert.rejects(callMonitor(HISTORY_TOOL), /HTTP 403/);
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls.length, 1);
    for (const error of [
        new Error('HTTP 400 invalid range'), new Error('HTTP 401 origin_bad_gateway'),
        new Error('HTTP 500 internal failure'), new Error('Query validation failed'),
        new TypeError('Cannot read property values'), new DOMException('Aborted', 'AbortError'),
        Object.assign(new Error('origin_bad_gateway'), { code: 'tool_error' }),
        Object.assign(new Error('origin_bad_gateway'), { code: 'ADMIN_REQUIRED' }),
    ]) assert.equal(isTransientHistoryError(error), false, error.message);
});

test('tool validation errors do not gain gateway retries', async (t) => {
    const { calls } = setup(t, () => ({ isError: true, content: [{ type: 'text', text: 'HTTP 502 invalid history series' }] }));
    await assert.rejects(callMonitor(HISTORY_TOOL), /invalid history series/);
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls.length, 1);
});

test('non-history reads and monitor mutations do not gain gateway retries', async (t) => {
    const { calls } = setup(t, () => { throw gatewayError(); });
    for (const name of ['workspace_monitor_settings_update', 'workspace_monitor_snapshot_get', 'workspace_monitor_logs_get']) {
        await assert.rejects(callMonitor(name), /HTTP 502/);
    }
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls.length, 3);
});

test('existing generation recovery shares the same bounded history budget', async (t) => {
    const { calls, resets } = setup(t, (_name, _args, count) => {
        if (count <= 2) throw new Error('edge_generation_changed');
        throw gatewayError();
    });
    const failed = assert.rejects(callMonitor(HISTORY_TOOL), /HTTP 502/);
    await flush();
    for (const delay of [300, 900, 1800]) {
        t.mock.timers.tick(delay);
        await flush();
    }
    await failed;
    assert.equal(calls.length, 4);
    assert.deepEqual(resets, ['workspaceMonitorAgent', 'workspaceMonitorAgent']);
});

for (const outcome of ['resolve', 'reject']) {
    test(`obsolete runtime ${outcome} cannot replace the new selection`, async (t) => {
        const old = deferred();
        const { presenter, calls, node, charts } = dashboard(t, (_name, args, count) => count === 1 ? old.promise : history(args));
        const first = presenter.loadSelectedRuntimeHistory();
        await flush();
        presenter.resources.entries = [{ key: 'repo%2Fruntime-b', name: 'runtime-b' }];
        presenter.resources.selectedKey = 'repo%2Fruntime-b';
        await presenter.loadSelectedRuntimeHistory();
        old[outcome](outcome === 'resolve' ? history(calls[0].args) : gatewayError());
        await first;
        await flush();
        assert.equal(charts.length, 2);
        assert.equal(node('runtime-history-state').textContent, 'runtime-b: 4 persisted samples');
        t.mock.timers.tick(60_000);
        await flush();
        assert.equal(calls.length, 2);
    });
}

test('range replacement cancels a retry and renders only the new interval', async (t) => {
    const { presenter, calls, node, charts } = dashboard(t, (_name, args, count) => {
        if (count === 1) throw gatewayError();
        return history(args);
    });
    const first = presenter.loadSelectedRuntimeHistory();
    await flush();
    node('runtime-history-from').value = '2026-01-01T12:00';
    presenter.handleRuntimeHistoryWindowChange();
    await first;
    await flush();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(charts.length, 2);
    assert.equal(charts[0][2].from, new Date('2026-01-01T12:00').getTime());
});

test('invalid or empty replacement intervals cancel pending requests and clear old charts', async (t) => {
    const old = deferred();
    const { presenter, calls, node, charts } = dashboard(t, () => old.promise);
    const first = presenter.loadSelectedRuntimeHistory();
    await flush();
    node('runtime-history-from').value = '';
    presenter.handleRuntimeHistoryWindowChange();
    await first;
    old.resolve(history(calls[0].args));
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(charts.length, 0);
    assert.match(node('runtime-history-state').textContent, /Choose a valid history interval/);
    assert.equal(node('runtime-history-retry').hidden, true);
    assert.equal(node('selected-runtime-cpu-history-chart').clears, 1);
});

for (const action of ['clear', 'tab', 'unload']) {
    test(`${action} cancels scheduled history retries`, async (t) => {
        const { presenter, calls, node } = dashboard(t, () => { throw gatewayError(); });
        const pending = presenter.loadSelectedRuntimeHistory();
        await flush();
        if (action === 'clear') {
            presenter.resources.entries = [];
            presenter.resources.selectedKey = null;
            presenter.resources.onSelectionCleared();
        } else if (action === 'tab') {
            presenter.selectTab(null, 'inactive');
        } else presenter.afterUnload();
        const state = node('runtime-history-state').textContent;
        await pending;
        t.mock.timers.tick(60_000);
        await flush();
        assert.equal(calls.length, 1);
        assert.equal(node('runtime-history-state').textContent, state);
        if (action === 'unload') {
            await presenter.loadSelectedRuntimeHistory();
            assert.equal(calls.length, 1);
        }
    });
}

test('unload abandons an in-flight request before its transport finishes', async (t) => {
    const old = deferred();
    const { presenter, calls, charts } = dashboard(t, () => old.promise);
    const pending = presenter.loadSelectedRuntimeHistory();
    await flush();
    presenter.afterUnload();
    await pending;
    old.reject(gatewayError());
    await flush();
    t.mock.timers.tick(60_000);
    assert.equal(calls.length, 1);
    assert.equal(charts.length, 0);
});

test('overview history also guards range replacements', async (t) => {
    const old = deferred();
    const { presenter, calls, node, charts } = dashboard(t, (_name, args, count) => count === 1 ? old.promise : history(args));
    const first = presenter.loadHistory();
    await flush();
    node('history-to').value = '2026-01-01T12:00';
    await presenter.loadHistory();
    old.resolve(history(calls[0].args));
    await first;
    await flush();
    assert.equal(charts.length, 2);
    assert.equal(presenter.history.to, calls[1].args.to);
});

test('unload during initial settings cannot launch a late history request', async (t) => {
    const settings = deferred();
    const { presenter, calls } = dashboard(t, () => settings.promise);
    const pending = presenter.loadSettingsAndHistory();
    await flush();
    presenter.afterUnload();
    await pending;
    settings.resolve({ settings: {} });
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(presenter.settings, null);
});

test('history retry control uses the WebSkel action lifecycle and shared button style', async () => {
    const html = await readFile(new URL('workspace-monitor-dashboard.html', componentRoot), 'utf8');
    assert.match(html, /class="general-button secondary" data-role="runtime-history-retry"\s+data-local-action="loadSelectedRuntimeHistory" hidden>Retry history/);
    assert.match(html, /data-role="runtime-history-state" role="status"/);
});
