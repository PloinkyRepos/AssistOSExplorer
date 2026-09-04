import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import { chromium, expect } from '@playwright/test';
import { assertPageDiagnosticsClean, attachPageDiagnostics } from './fixtures.mjs';

const pluginSource = await fs.readFile(new URL('../../../explorer/web-components/pages/file-exp/file-exp-application-plugins.js', import.meta.url), 'utf8');
const renderStart = pluginSource.indexOf('export async function renderApplicationPluginSlots(');
const renderEnd = pluginSource.indexOf('export function attachApplicationPluginHost(', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const renderLifecycle = pluginSource.slice(renderStart, renderEnd).replace('export ', '');
const specSource = await fs.readFile(new URL('../specs/01-webtty-core.spec.mjs', import.meta.url), 'utf8');
const helperStart = specSource.indexOf('const explorerFiniteRequests =');
const helperEnd = specSource.indexOf('function escapeRegExp(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const { observeExplorerPluginReadiness, waitForExplorerPluginRender } = vm.runInNewContext(`
    ${specSource.slice(helperStart, helperEnd)}
    ({ observeExplorerPluginReadiness, waitForExplorerPluginRender })
`, { expect });
const assetPaths = [
    '/workspace-files/.ploinky/repos/AchillesIDE/dpuAgent/IDE-plugins/dpu-runtime-support/dpu-runtime-support.css',
    '/workspace-files/.ploinky/repos/AchillesIDE/dpuAgent/IDE-plugins/dpu-runtime-support/components/dpu-permissions-modal/dpu-permissions-modal.html',
    '/workspace-files/.ploinky/repos/AchillesIDE/dpuAgent/IDE-plugins/dpu-runtime-support/components/dpu-permissions-modal/dpu-permissions-modal.css'
];

async function createDeferredPluginPage(t, observe) {
    const pendingAssets = new Map();
    const assetEvents = new EventEmitter();
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
        if (pathname === '/favicon.ico') {
            response.writeHead(204).end();
            return;
        }
        if (pathname === '/events') {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(': connected\n\n');
            return;
        }
        if (pathname !== '/') {
            pendingAssets.set(pathname, response);
            assetEvents.emit('requested');
            return;
        }
        response.setHeader('content-type', 'text/html');
        response.end(`<file-exp>Explorer shell is usable before deferred plugins</file-exp>
            <script>
                const fileExp = document.querySelector('file-exp');
                const presenter = { element: fileExp };
                fileExp.webSkelPresenter = presenter;
                const renderQueue = [];
                async function performRenderApplicationPluginSlots() {
                    const paths = renderQueue.shift();
                    await Promise.all(paths.map(async path => {
                        const response = await fetch(path);
                        if (!response.ok) throw new Error('plugin asset failed: ' + response.status);
                        await response.text();
                    }));
                }
                ${renderLifecycle}
                window.queuePluginRender = paths => {
                    renderQueue.push(paths);
                    void renderApplicationPluginSlots(presenter).catch(error => console.error(error.message));
                };
                window.addEventListener('assistos:runtime-plugins-updated', event => {
                    if (event.detail?.phase === 'ready') window.queuePluginRender(${JSON.stringify(assetPaths)});
                });
            </script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    t.after(async () => {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    browser = await chromium.launch();
    const page = await browser.newPage();
    const diagnostics = attachPageDiagnostics(page, {}, 'deferred Explorer fixture');
    if (observe) await observe(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return {
        page,
        diagnostics,
        async begin() {
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('assistos:runtime-plugins-updated', {
                detail: { phase: 'ready' }
            })));
            await this.requested(assetPaths);
        },
        async requested(paths) {
            while (!paths.every(path => pendingAssets.has(path))) await once(assetEvents, 'requested');
        },
        finish(paths = assetPaths, status = 200) {
            for (const path of paths) {
                const response = pendingAssets.get(path);
                if (!response.headersSent) response.writeHead(status, path.endsWith('.svg')
                    ? { 'content-type': 'image/svg+xml' }
                    : {});
                response.end(path.endsWith('.svg')
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
                    : 'fixture plugin asset');
            }
        },
        startBody(path, { status = 200, contentType = 'text/plain' } = {}) {
            pendingAssets.get(path).writeHead(status, { 'content-type': contentType });
            pendingAssets.get(path).write('partial body');
        },
        fail(path) {
            pendingAssets.get(path).destroy();
        }
    };
}

test('original shell-only readiness aborts all three deferred plugin assets on quiescence', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t);
    await fixture.begin();
    assertPageDiagnosticsClean(fixture.page);
    const failures = assetPaths.map(path => fixture.page.waitForEvent('requestfailed', {
        predicate: request => new URL(request.url()).pathname === path
    }));
    await fixture.page.goto('about:blank');
    const requests = await Promise.all(failures);
    assert.deepEqual(requests.map(request => request.failure()?.errorText), Array(3).fill('net::ERR_ABORTED'));
    assert.throws(() => assertPageDiagnosticsClean(fixture.page), /browser console, page, or network errors/);
    assert.equal(fixture.diagnostics.actionableEvents().filter(event => event.kind === 'requestfailed').length, 3);
});

test('quiescence waits for ready and actual plugin bodies before leaving the page', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    await fixture.begin();
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish(assetPaths.slice(0, 2));
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish(assetPaths.slice(2));
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assertPageDiagnosticsClean(fixture.page);
    await fixture.page.goto('about:blank');
    assertPageDiagnosticsClean(fixture.page);
    assert.equal(fixture.diagnostics.events.length, 0);
});

test('quiescence follows queued render promises and does not reuse readiness after reload', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    const laterAsset = '/workspace-files/fixture/IDE-plugins/later-plugin.css';
    await fixture.page.evaluate(path => window.queuePluginRender([path]), laterAsset);
    fixture.finish();
    await fixture.requested([laterAsset]);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish([laterAsset]);
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assertPageDiagnosticsClean(fixture.page);
    await fixture.page.reload();
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    assertPageDiagnosticsClean(fixture.page);
});

test('a plugin asset failure remains fatal and its diagnostic evidence is not cleared', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    const errorLogged = fixture.page.waitForEvent('console', {
        predicate: message => message.type() === 'error' && message.text().includes('plugin asset failed: 500')
    });
    fixture.finish(assetPaths, 500);
    await errorLogged;
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assert.throws(() => assertPageDiagnosticsClean(fixture.page), /browser console, page, or network errors/);
    const recorded = fixture.diagnostics.events.length;
    assert.ok(recorded > 0);
    assert.throws(() => assertPageDiagnosticsClean(fixture.page), /browser console, page, or network errors/);
    assert.equal(fixture.diagnostics.events.length, recorded);
});

test('quiescence includes finite authorization and image bodies outside the render promise', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    await waitForExplorerPluginRender(fixture.page, 2_000);
    const token = '/auth/token';
    const icon = '/workspace-files/workspaceMonitorAgent/IDE-plugins/workspace-monitor/icon.svg';
    await fixture.page.evaluate(({ token, icon }) => {
        void fetch(token).then(response => response.text());
        const image = document.createElement('img');
        image.src = icon;
        document.body.append(image);
    }, { token, icon });
    await fixture.requested([token, icon]);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.startBody(token);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish([token]);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish([icon]);
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assertPageDiagnosticsClean(fixture.page);
    await fixture.page.goto('about:blank');
    assertPageDiagnosticsClean(fixture.page);
});

test('quiescence does not await the body of a confirmed live event stream', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    const response = fixture.page.waitForResponse(response => new URL(response.url()).pathname === '/events');
    await fixture.page.evaluate(() => { window.fixtureEvents = new EventSource('/events'); });
    await response;
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assert.equal(await fixture.page.evaluate(() => window.fixtureEvents.readyState), 1);
    assertPageDiagnosticsClean(fixture.page);
});

test('quiescence follows finite requests launched while an earlier response body completes', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    const token = '/auth/token';
    const followup = '/authorized-plugin-data';
    await fixture.page.evaluate(({ token, followup }) => {
        void fetch(token).then(response => response.text())
            .then(() => fetch(followup)).then(response => response.text());
    }, { token, followup });
    await fixture.requested([token]);
    const waiting = assert.rejects(waitForExplorerPluginRender(fixture.page, 500), /Timeout/);
    fixture.finish([token]);
    await fixture.requested([followup]);
    await waiting;
    fixture.finish([followup]);
    await waitForExplorerPluginRender(fixture.page, 2_000);
    await fixture.page.goto('about:blank');
    assertPageDiagnosticsClean(fixture.page);
});

test('an unfinished event-source request needs a confirmed SSE response before exclusion', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    const stream = '/pending-events';
    await fixture.page.evaluate(path => { window.fixtureEvents = new EventSource(path); }, stream);
    await fixture.requested([stream]);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.startBody(stream, { contentType: 'text/event-stream; charset=utf-8' });
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assertPageDiagnosticsClean(fixture.page);
});

test('an unsuccessful fetch response cannot become an excluded live stream', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    const stream = '/failed-events';
    await fixture.page.evaluate(path => { void fetch(path).then(response => response.text()); }, stream);
    await fixture.requested([stream]);
    fixture.startBody(stream, { status: 503, contentType: 'text/event-stream' });
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    fixture.finish([stream]);
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assert.throws(() => assertPageDiagnosticsClean(fixture.page), /browser console, page, or network errors/);
    assert.ok(fixture.diagnostics.actionableEvents().some(event => event.kind === 'response' && event.status === 503));
});

test('a failed finite authorization request drains observation but remains a strict diagnostic failure', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    const token = '/auth/token';
    await fixture.page.evaluate(path => { void fetch(path).then(response => response.text()).catch(() => {}); }, token);
    await fixture.requested([token]);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /Timeout/);
    const failure = fixture.page.waitForEvent('requestfailed', {
        predicate: request => new URL(request.url()).pathname === token
    });
    const headers = fixture.page.waitForResponse(response => new URL(response.url()).pathname === token);
    fixture.startBody(token);
    await headers;
    fixture.fail(token);
    await failure;
    await waitForExplorerPluginRender(fixture.page, 2_000);
    assert.throws(() => assertPageDiagnosticsClean(fixture.page), /browser console, page, or network errors/);
    assert.ok(fixture.diagnostics.actionableEvents().some(event => event.kind === 'requestfailed'));
});

test('quiescence fails closed when requests were not observed from initial navigation', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t);
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 100), /observation must start before navigation/);
});

test('quiescence times out when the page stops delivering animation frames', { timeout: 15_000 }, async t => {
    const fixture = await createDeferredPluginPage(t, observeExplorerPluginReadiness);
    await fixture.begin();
    fixture.finish();
    await waitForExplorerPluginRender(fixture.page, 2_000);
    await fixture.page.evaluate(() => {
        window.stalledFrameRequests = 0;
        window.requestAnimationFrame = () => ++window.stalledFrameRequests;
    });
    const started = Date.now();
    await assert.rejects(waitForExplorerPluginRender(fixture.page, 250), /Timeout 250ms exceeded/);
    assert.ok(Date.now() - started < 2_000, 'the polling deadline must bound an unfinished page evaluation');
    assert.equal(await fixture.page.evaluate(() => window.stalledFrameRequests), 1);
    assertPageDiagnosticsClean(fixture.page);
});

test('the lifecycle wait stays spec-local and retains strict checks around navigation', () => {
    const scenarioStart = specSource.indexOf("test('local administrator controls");
    const observerIndex = specSource.indexOf('await observeExplorerPluginReadiness(page);', scenarioStart);
    const firstOpenIndex = specSource.indexOf('await openExplorer(page,', scenarioStart);
    const waitIndex = specSource.indexOf('await waitForExplorerPluginRender(page);', scenarioStart);
    const preCheckIndex = specSource.indexOf("assertPageDiagnosticsClean(page, 'Explorer must be error-free before Router fault injection');", scenarioStart);
    const navigateIndex = specSource.indexOf("await page.goto('about:blank'", scenarioStart);
    const postCheckIndex = specSource.indexOf("assertPageDiagnosticsClean(page, 'quiescing Explorer must not hide browser failures');", scenarioStart);
    assert.ok(scenarioStart > 0 && observerIndex > scenarioStart && observerIndex < firstOpenIndex);
    assert.ok(waitIndex > firstOpenIndex && waitIndex < preCheckIndex && preCheckIndex < navigateIndex && navigateIndex < postCheckIndex);
    assert.doesNotMatch(specSource.slice(helperStart, helperEnd), /networkidle|setTimeout|waitForTimeout|acknowledge|pause/);
});
