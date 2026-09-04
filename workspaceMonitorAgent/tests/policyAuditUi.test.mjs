import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkspaceMonitorLogs } from '../IDE-plugins/workspace-monitor/components/workspace-monitor-dashboard/workspace-monitor-logs.js';

class Element {
    constructor(tagName = 'pre') {
        this.tagName = tagName;
        this.attributes = new Map();
        this.children = [];
        this.dataset = {};
        this.text = '';
        this.writes = 0;
        this.listeners = new Map();
        this.selected = '';
        this.scrollHeight = 100;
        this.scrollTop = 0;
    }

    get textContent() { return this.text; }
    set textContent(text) { this.text = text; this.writes += 1; }
    get options() { return this.children; }
    get value() { return this.selected || (this.tagName === 'select' ? this.children[0]?.value || '' : ''); }
    set value(value) { this.selected = value; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    replaceChildren(...children) { this.children = children; this.textContent = ''; this.selected = ''; }
    append(child) { this.children.push(child); }
    before(child) { this.statusElement = child; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    dispatch(name) { this.listeners.get(name)?.({ key: 'Enter', preventDefault() {} }); }
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let count = 0; count < 20; count += 1) await Promise.resolve();
}

function harness(t, callMonitor, callDpu = async () => ({ items: [] })) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) };
    const elements = new Map();
    for (const source of ['router', 'policy', 'dpu']) {
        for (const role of ['log', 'log-files', 'log-search', 'log-search-button', 'log-clear', 'log-reload']) {
            elements.set(`${source}-${role}`, new Element(role === 'log-files' ? 'select' : 'pre'));
        }
        if (source !== 'dpu') elements.get(`${source}-log-files`).append(Object.assign(new Element('option'), { value: 'live' }));
    }
    const statuses = [];
    const logs = new WorkspaceMonitorLogs({
        querySelector: (selector) => elements.get(selector.match(/data-role="([^"]+)"/)?.[1]),
    }, { callMonitor, callDpu, setStatus: (status) => statuses.push(status) });
    logs.initialize();
    t.after(() => {
        logs.stop();
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    return {
        logs, statuses,
        output: (source = 'policy') => elements.get(`${source}-log`),
        selector: (source = 'policy') => elements.get(`${source}-log-files`),
        element: (role) => elements.get(role),
        async poll() { t.mock.timers.tick(2_000); await flush(); },
    };
}

test('Policy Audit successful empty read is an empty state, not an endless loading state', async (t) => {
    const view = harness(t, async (name) => name.endsWith('_list')
        ? { ok: true, active: false, items: [] }
        : { ok: true, item: { name: 'live', content: '' } });
    void view.logs.start('policy');
    await flush();
    assert.match(view.output().textContent, /No policy audit events/);
    assert.doesNotMatch(view.output().textContent, /Waiting|Loading/);
    assert.equal(view.output().dataset.state, 'empty');
    assert.equal(view.output().getAttribute('aria-busy'), 'false');
    assert.match(view.statuses.at(-1), /Checking.*2 seconds/);
    assert.doesNotMatch(view.statuses.at(-1), /Following active/);
});

test('loading is pending only, and active:false keeps a truthful, selectable live destination', async (t) => {
    const list = deferred();
    const get = deferred();
    const calls = [];
    const view = harness(t, (name, args) => {
        calls.push({ name, args });
        return name.endsWith('_list') ? list.promise : get.promise;
    });
    void view.logs.start('policy');
    assert.equal(view.output().dataset.state, 'loading');
    assert.equal(view.output().getAttribute('aria-busy'), 'true');
    assert.match(view.output().textContent, /Loading policy logs/);
    list.resolve({ active: false, items: [{ name: 'older.log' }] });
    await flush();
    assert.deepEqual(view.selector().options.map((option) => option.value), ['live', 'older.log']);
    assert.match(view.selector().options[0].textContent, /no active file/);
    assert.equal(view.selector().value, 'live');
    assert.equal(calls[1].args.name, 'live');
    assert.equal(view.output().getAttribute('aria-busy'), 'true');
    get.resolve({ item: { content: '' } });
    await flush();
    assert.equal(view.output().getAttribute('aria-busy'), 'false');
    assert.match(view.selector().options[0].textContent, /no active file/);
    const writes = view.output().writes;
    await view.poll();
    assert.equal(view.output().writes, writes, 'repeated empty polls must not replace the output');
});

test('new events recover from an absent live file, rotation becomes empty, and a new file resumes', async (t) => {
    const contents = ['', JSON.stringify({ timestamp: '2026-09-04T10:00:00Z', line: 'policy changed' }), '', 'new event'];
    const view = harness(t, async (name) => name.endsWith('_list')
        ? { active: false, items: [] }
        : { item: { content: contents.shift() } });
    void view.logs.start('policy');
    await flush();
    assert.equal(view.output().dataset.state, 'empty');
    await view.poll();
    assert.equal(view.output().dataset.state, 'populated');
    assert.match(view.output().textContent, /\] policy changed$/);
    assert.equal(view.selector().options[0].textContent, 'Live');
    assert.match(view.statuses.at(-1), /Following policy live records/);
    await view.poll();
    assert.equal(view.output().dataset.state, 'empty');
    assert.match(view.output().textContent, /current live log.*\n.*\n.*archives/);
    assert.equal(view.selector().options[0].textContent, 'Live (no records)');
    await view.poll();
    assert.equal(view.output().textContent, 'new event');
    assert.equal(view.output().dataset.state, 'populated');
});

test('refreshes retain records and scroll position, errors mark stale data, and success clears errors', async (t) => {
    let response = { item: { content: 'useful event' } };
    const view = harness(t, async (name) => {
        if (name.endsWith('_list')) return { active: true, items: [] };
        if (response instanceof Error) throw response;
        return response;
    });
    void view.logs.start('policy');
    await flush();
    view.output().scrollTop = 12;
    const writes = view.output().writes;
    const refresh = deferred();
    response = refresh.promise;
    await view.poll();
    assert.equal(view.output().textContent, 'useful event');
    assert.equal(view.output().dataset.state, 'refreshing');
    assert.equal(view.output().getAttribute('aria-busy'), 'true');
    refresh.resolve({ item: { content: 'useful event' } });
    await flush();
    assert.equal(view.output().writes, writes);
    assert.equal(view.output().scrollTop, 12);
    response = new Error('private credentials must not reach the UI');
    await view.poll();
    assert.equal(view.output().textContent, 'useful event');
    assert.equal(view.output().dataset.state, 'stale');
    assert.equal(view.output().getAttribute('aria-busy'), 'false');
    assert.match(view.statuses.at(-1), /may be stale.*Retrying in 2 seconds/);
    assert.doesNotMatch(view.statuses.at(-1), /private credentials/);
    assert.equal(view.output().statusElement.textContent, view.statuses.at(-1));
    response = { item: { content: 'recovered event' } };
    await view.poll();
    assert.equal(view.output().dataset.state, 'populated');
    assert.equal(view.output().textContent, 'recovered event');
    assert.doesNotMatch(view.statuses.at(-1), /failed|stale/);
});

test('first fetch error is visible and a later empty success is not confused with failure', async (t) => {
    let fail = true;
    const view = harness(t, async (name) => {
        if (name.endsWith('_list')) return { active: false, items: [] };
        if (fail) throw new Error('offline');
        return { item: { content: '' } };
    });
    void view.logs.start('policy');
    await flush();
    assert.equal(view.output().dataset.state, 'error');
    assert.match(view.output().textContent, /failed.*No current result.*Retrying/);
    assert.equal(view.output().getAttribute('aria-busy'), 'false');
    fail = false;
    await view.poll();
    assert.equal(view.output().dataset.state, 'empty');
    assert.doesNotMatch(view.output().textContent, /failed/);
});

test('list failure is actionable and malformed successful payloads are errors, not empty streams', async (t) => {
    let listing = true;
    const view = harness(t, async () => {
        if (listing) throw new Error('offline');
        return { ok: true };
    });
    await view.logs.start('policy');
    assert.equal(view.output().dataset.state, 'error');
    assert.match(view.output().textContent, /log list failed.*Reload/);
    listing = false;
    void view.logs.loadSelection('policy');
    await flush();
    assert.equal(view.output().dataset.state, 'error');
    assert.match(view.output().textContent, /live log refresh failed/);
});

test('Reload retains same-file records while listing or fetching, including a failed reload', async (t) => {
    let list = { active: true, items: [] };
    const view = harness(t, async (name) => {
        if (name.endsWith('_list')) return list;
        return { item: { content: 'existing event' } };
    });
    void view.logs.start('policy');
    await flush();
    const pending = deferred();
    list = pending.promise;
    const reload = view.logs.start('policy');
    assert.equal(view.output().textContent, 'existing event');
    assert.equal(view.output().getAttribute('aria-busy'), 'true');
    pending.reject(new Error('offline'));
    await reload;
    assert.equal(view.output().textContent, 'existing event');
    assert.equal(view.output().dataset.state, 'stale');
    assert.match(view.statuses.at(-1), /log list failed.*Reload/);
});

test('rapid archive switches ignore both obsolete successes and errors without live polling', async (t) => {
    const first = deferred();
    const second = deferred();
    const view = harness(t, (_name, args) => args.name === 'first.log' ? first.promise : second.promise);
    view.selector().value = 'first.log';
    const firstLoad = view.logs.loadSelection('policy');
    view.selector().value = 'second.log';
    const secondLoad = view.logs.loadSelection('policy');
    second.resolve({ item: { content: 'second archive' } });
    await secondLoad;
    const status = view.statuses.at(-1);
    first.reject(new Error('late failure'));
    await firstLoad;
    assert.equal(view.output().textContent, 'second archive');
    assert.equal(view.statuses.at(-1), status);
    assert.equal(view.logs.controllers.size, 0);
    assert.match(status, /live checking paused/);
    const old = deferred();
    view.logs.callMonitor = () => old.promise;
    view.selector().value = 'first.log';
    const oldLoad = view.logs.loadSelection('policy');
    view.selector().value = 'second.log';
    view.logs.callMonitor = async () => ({ item: { content: '' } });
    await view.logs.loadSelection('policy');
    old.resolve({ item: { content: 'obsolete archive' } });
    await oldLoad;
    assert.equal(view.output().textContent, 'No records in this log file.');
    assert.equal(view.output().dataset.state, 'empty');
});

test('archive selection supersedes an in-flight live read and a stale list', async (t) => {
    const live = deferred();
    const list = deferred();
    const calls = [];
    const view = harness(t, (name, args) => {
        calls.push({ name, args });
        if (name.endsWith('_list')) return list.promise;
        return args.name === 'live' ? live.promise : Promise.resolve({ item: { content: 'archive' } });
    });
    const following = view.logs.loadSelection('policy');
    view.selector().value = 'archive.log';
    await view.logs.loadSelection('policy');
    live.resolve({ item: { content: 'obsolete live data' } });
    await following;
    assert.equal(view.output().textContent, 'archive');
    const listing = view.logs.start('policy');
    view.selector().value = 'newer.log';
    await view.logs.loadSelection('policy');
    list.resolve({ active: false, items: [{ name: 'old.log' }] });
    await listing;
    assert.equal(view.selector().value, 'newer.log');
    const count = calls.length;
    await view.poll();
    assert.equal(calls.length, count);
});

test('search races and clear-search cannot replace the latest live selection', async (t) => {
    const first = deferred();
    const second = deferred();
    const view = harness(t, (name, args) => {
        if (name.endsWith('_search')) return args.query === 'first' ? first.promise : second.promise;
        return Promise.resolve({ item: { content: 'current live event' } });
    });
    view.element('policy-log-search').value = 'first';
    const firstSearch = view.logs.search('policy');
    view.element('policy-log-search').value = 'second';
    const secondSearch = view.logs.search('policy');
    second.resolve({ matches: [{ file: 'live', lineNumber: 1, line: 'second match' }] });
    await secondSearch;
    first.resolve({ matches: [{ file: 'live', lineNumber: 1, line: 'obsolete match' }] });
    await firstSearch;
    assert.match(view.output().textContent, /second match$/);
    assert.match(view.statuses.at(-1), /live checking paused/);
    const late = deferred();
    view.logs.callMonitor = (name) => name.endsWith('_search') ? late.promise : Promise.resolve({ item: { content: 'current live event' } });
    const pending = view.logs.search('policy');
    void view.logs.clearSearch('policy');
    await flush();
    late.reject(new Error('obsolete failure'));
    await pending;
    assert.equal(view.output().textContent, 'current live event');
    assert.equal(view.element('policy-log-search').value, '');
    assert.equal(view.output().dataset.state, 'populated');
});

test('source switches ignore old responses and unload cancels pending work and polling timers', async (t) => {
    const policy = deferred();
    const router = deferred();
    let calls = 0;
    const view = harness(t, (name, args) => {
        calls += 1;
        if (name.endsWith('_list')) return Promise.resolve({ active: false, items: [] });
        return args.source === 'policy' ? policy.promise : router.promise;
    });
    const policyStart = view.logs.start('policy');
    await flush();
    const routerStart = view.logs.start('router');
    await flush();
    const statusCount = view.statuses.length;
    policy.reject(new Error('late policy error'));
    await policyStart;
    assert.equal(view.statuses.length, statusCount);
    view.logs.stop();
    const writes = view.output('router').writes;
    router.resolve({ item: { content: 'after unload' } });
    await routerStart;
    assert.equal(view.output('router').writes, writes);
    assert.equal(view.output('router').getAttribute('aria-busy'), 'false');
    assert.equal(view.statuses.length, statusCount);
    const count = calls;
    await view.poll();
    assert.equal(calls, count);
    void view.logs.start('router');
    await flush();
    view.logs.stop();
    const stoppedCount = calls;
    await view.poll();
    assert.equal(calls, stoppedCount, 'stop must clear a scheduled poll');
});

test('DPU list, archive and search retain their tool contracts and never start live polling', async (t) => {
    const calls = [];
    const view = harness(t, () => assert.fail('DPU must not call Workspace Monitor'), async (name, args) => {
        calls.push({ name, args });
        if (name.endsWith('_list')) return { items: [{ name: 'audit.log' }] };
        if (name.endsWith('_search')) return { matches: [] };
        return { item: { content: 'DPU audit entry' } };
    });
    await view.logs.start('dpu');
    assert.equal(view.output('dpu').textContent, 'DPU audit entry');
    assert.equal(view.selector('dpu').options.length, 1);
    view.element('dpu-log-search').value = 'absent';
    await view.logs.search('dpu');
    assert.equal(view.output('dpu').textContent, 'No matching log lines.');
    assert.equal(view.output('dpu').dataset.state, 'empty');
    assert.deepEqual(calls.map((call) => call.name), ['dpu_audit_list', 'dpu_audit_get', 'dpu_audit_search']);
    assert.equal(calls[1].args.maxBytes, 2 * 1024 * 1024);
    assert.equal(view.logs.controllers.size, 0);
});
