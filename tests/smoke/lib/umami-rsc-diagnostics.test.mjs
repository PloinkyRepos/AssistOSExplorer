import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';

import { acknowledgeExactPageDiagnostics, attachPageDiagnostics, checkpointPageDiagnostics } from './fixtures.mjs';
import { createDiagnosticLedger } from './diagnostic-ledger.mjs';
import { installUmamiRscDiagnostics, observeUmamiConsumers, proveUmamiRscCompletions } from './umami-rsc-diagnostics.mjs';

const publicationPath = '/base-agent-additional-server/umamiAgent/3000';
const origin = 'http://127.0.0.1:8080';
const url = `${origin}${publicationPath}/dashboard?_rsc=private-query-sentinel`;
const valid = () => ({ origin, publicationPath, requests: [{ id: 'cdp-1', url, method: 'GET', type: 'Fetch',
  rsc: true, starts: 1, responses: 1, redirected: false, status: 200, mimeType: 'text/x-component',
  contentType: 'text/x-component; charset=utf-8', failed: true, canceled: true, errorText: 'net::ERR_ABORTED',
  blockedReason: '', corsError: false, finished: false, decodedBytes: 12 }], consumers: [{ id: 1, url,
  status: 200, body: true, signalProvided: false, readers: 1, reads: 2, bytes: 12, eof: 1, pending: 0,
  readErrors: 0, fetchErrors: 0, cancels: 0 }] });

test('only independent exact EOF evidence derives a failure signature; proof never exposes the query', () => {
  const result = proveUmamiRscCompletions(valid());
  assert.deepEqual(result.expectedSignatures, [{ kind: 'requestfailed', type: 'error', url,
    method: 'GET', failure: 'net::ERR_ABORTED' }]);
  assert.equal(result.proof.completed[0].consumerBytes, 12);
  assert.equal(JSON.stringify(result.proof).includes('private-query-sentinel'), false);
  const input = valid();
  input.requests[0].failed = false;
  input.requests[0].decodedBytes = 0;
  input.consumers = [];
  assert.deepEqual(proveUmamiRscCompletions(input).expectedSignatures, []);
});

test('ambiguous, partial, unread, redirected, foreign, HTML and noncancel failures are rejected', () => {
  const changes = [
    (x) => { x.observerErrors = 1; },
    (x) => { x.requests.push({ ...x.requests[0], id: 'another', failed: false }); },
    (x) => { x.consumers.push({ ...x.consumers[0], id: 2 }); },
    (x) => { x.consumers = []; },
    (x) => { x.consumers[0].signalProvided = true; },
    (x) => { delete x.consumers[0].signalProvided; },
    ...['method', 'type', 'rsc', 'starts', 'responses', 'redirected', 'status', 'mimeType',
      'contentType', 'canceled', 'errorText', 'blockedReason', 'corsError', 'finished', 'decodedBytes'].map((field) => (x) => {
      const bad = { method: 'POST', type: 'XHR', rsc: false, starts: 2, responses: 0, redirected: true,
        status: 500, mimeType: 'text/html', contentType: 'text/html', canceled: false,
        errorText: 'net::ERR_CONTENT_LENGTH_MISMATCH', blockedReason: 'other', corsError: true, finished: true, decodedBytes: 13 };
      x.requests[0][field] = bad[field];
    }),
    ...['status', 'body', 'readers', 'reads', 'bytes', 'eof', 'pending', 'readErrors', 'fetchErrors', 'cancels'].map((field) => (x) => {
      const bad = { status: 401, body: false, readers: 0, reads: 1, bytes: 0, eof: 0,
        pending: 1, readErrors: 1, fetchErrors: 1, cancels: 1 };
      x.consumers[0][field] = bad[field];
    }),
    ...['http://foreign.invalid/base', `${origin}${publicationPath}evil/dashboard`,
      `${origin}${publicationPath}0/dashboard`, `${origin}/dashboard`].map((value) => (x) => {
      x.requests[0].url = value; x.consumers[0].url = value;
    }),
  ];
  for (const change of changes) { const input = valid(); change(input); assert.throws(() => proveUmamiRscCompletions(input)); }
});

function concurrentComplete() {
  const input = valid();
  // Captured concurrent navigation responses both contained 3,349 decoded bytes;
  // Chromium finished one and canceled the other after both original readers' EOF.
  input.requests[0].decodedBytes = 3349;
  input.consumers[0].bytes = 3349;
  input.requests.push({ ...input.requests[0], id: 'cdp-finished', failed: false, finished: true,
    canceled: false, errorText: '' });
  input.consumers.push({ ...input.consumers[0], id: 2, reads: 3 });
  return input;
}

test('concurrent identical URLs prove every possible pairing without assigning a consumer by order', () => {
  for (const reverseRequests of [false, true]) {
    for (const reverseConsumers of [false, true]) {
      const input = concurrentComplete();
      if (reverseRequests) input.requests.reverse();
      if (reverseConsumers) input.consumers.reverse();
      const result = proveUmamiRscCompletions(input);
      assert.equal(result.expectedSignatures.length, 1);
      assert.equal(result.proof.completed.length, 1);
      const proof = result.proof.completed[0];
      assert.equal(proof.requestId, 'cdp-1');
      assert.equal('consumerId' in proof, false);
      assert.equal('reads' in proof, false);
      assert.equal(proof.consumerBytes, 3349);
      assert.deepEqual(proof.completeConsumerCandidates.map((entry) => entry.consumerId).sort(), [1, 2]);
      assert.deepEqual(proof.equivalentRequests.map((entry) => entry.terminal).sort(), ['canceled', 'finished']);
      assert.equal(JSON.stringify(proof).includes('private-query-sentinel'), false);
    }
  }
});

test('one complete duplicate cannot conceal an invalid protocol or original consumer sibling', () => {
  const changes = [
    (x) => { x.requests.pop(); },
    (x) => { x.consumers.pop(); },
    (x) => { x.requests[1].id = x.requests[0].id; },
    (x) => { x.consumers[1].id = x.consumers[0].id; },
    (x) => { delete x.requests[1].id; },
    (x) => { delete x.consumers[1].id; },
    ...Object.entries({ method: 'POST', type: 'XHR', rsc: false, starts: 2, responses: 2,
      redirected: true, status: 401, mimeType: 'text/html', contentType: 'text/html',
      finished: false, failed: true, canceled: true, errorText: 'net::ERR_ABORTED',
      blockedReason: 'other', corsError: true, decodedBytes: 0 }).map(([field, value]) => (x) => {
      x.requests[1][field] = value;
    }),
    ...Object.entries({ signalProvided: true, status: 401, body: false, readers: 2, reads: 1,
      eof: 0, pending: 1, readErrors: 1, fetchErrors: 1, cancels: 1, bytes: 0 }).map(([field, value]) => (x) => {
      x.consumers[1][field] = value;
    }),
    (x) => { delete x.consumers[1].signalProvided; },
    // Equal byte multisets still permit an incorrect pairing, so reject them.
    (x) => { x.requests[1].decodedBytes = 3350; x.consumers[1].bytes = 3350; },
  ];
  for (const change of changes) {
    const input = concurrentComplete(); change(input);
    assert.throws(() => proveUmamiRscCompletions(input));
  }
});

test('all canceled duplicates retain exact failure multiplicity and reject an extra ledger error', () => {
  const input = concurrentComplete();
  input.requests[1] = { ...input.requests[0], id: 'cdp-2' };
  const result = proveUmamiRscCompletions(input);
  assert.equal(result.expectedSignatures.length, 2);
  assert.equal(result.proof.completed.length, 2);
  const events = [];
  const ledger = createDiagnosticLedger(events);
  const checkpoint = ledger.checkpoint();
  events.push(...result.expectedSignatures);
  ledger.acknowledgeExact(checkpoint, result.expectedSignatures);
  assert.equal(events.length, 2);
  assert.deepEqual(ledger.actionableEvents(), []);
  events.push({ ...result.expectedSignatures[0] });
  assert.equal(ledger.actionableEvents().length, 1);
});

test('the exact ledger multiset retains raw failures and rejects unrelated or later errors', () => {
  const result = proveUmamiRscCompletions(valid());
  const event = { ...result.expectedSignatures[0] };
  for (const extra of [
    { kind: 'console', type: 'error', text: 'unexpected', location: { url: origin } },
    { kind: 'response', type: 'error', status: 401, url, method: 'POST' },
    { kind: 'pageerror', type: 'error', text: 'unexpected' },
    { ...event, url: `${url}-extra` },
  ]) {
    const events = [];
    const ledger = createDiagnosticLedger(events);
    const checkpoint = ledger.checkpoint();
    events.push(event, extra);
    assert.throws(() => ledger.acknowledgeExact(checkpoint, result.expectedSignatures), /unexpected diagnostic event multiset/);
    assert.equal(ledger.actionableEvents().length, 2);
  }
  const events = [];
  const ledger = createDiagnosticLedger(events);
  const checkpoint = ledger.checkpoint();
  events.push(event);
  ledger.acknowledgeExact(checkpoint, result.expectedSignatures);
  assert.deepEqual(events, [event]);
  assert.deepEqual(ledger.actionableEvents(), []);
  events.push({ ...event });
  assert.equal(ledger.actionableEvents().length, 1);
});

test('observed rejection is fatal even for a protocol-finished request or a noncandidate consumer', () => {
  for (const field of ['fetchErrors', 'readErrors']) {
    const input = valid();
    input.requests[0].failed = false;
    input.requests[0].finished = true;
    input.consumers[0][field] = 1;
    assert.throws(() => proveUmamiRscCompletions(input), /fetch or reader rejected/);
    input.requests = [];
    assert.throws(() => proveUmamiRscCompletions(input), /fetch or reader rejected/);
  }
});

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function withBrowser(run) {
  const server = http.createServer((request, response) => {
    const parsed = new URL(request.url, 'http://fixture');
    if (parsed.pathname === `${publicationPath}/abort`) { response.destroy(); return; }
    if (parsed.pathname === `${publicationPath}/pending`) {
      setTimeout(() => response.writeHead(200, { 'Content-Type': 'text/x-component' }).end('hello world!'), 100);
      return;
    }
    if (parsed.pathname === `${publicationPath}/rsc`) {
      const mode = parsed.searchParams.get('mode');
      response.writeHead(200, { 'Content-Type': mode === 'html' ? 'text/html' : 'text/x-component',
        'Content-Length': ['partial', 'cancel', 'unread'].includes(mode) ? '10000' : '12' });
      if (mode === 'delayed') {
        response.write('hello ');
        setTimeout(() => response.end('world!'), 100);
        return;
      }
      response.write('hello world!');
      if (mode === 'partial') setTimeout(() => response.destroy(), 100);
      else if (!['cancel', 'unread'].includes(mode)) response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Consumer fixture</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  try { await run({ page, fixtureOrigin, server }); } finally {
    await context.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('real Chromium native promises, original reader bytes, and EOF remain unchanged', async () => {
  await withBrowser(async ({ page, fixtureOrigin }) => {
    // The test records native Promise identity weakly before installing the observer.
    await page.addInitScript({ content: `
      window.nativeFetchPromises = new WeakSet(); window.nativeReadPromises = new WeakSet();
      const fetchNative = window.fetch;
      window.fetch = function(...args) { const p = Reflect.apply(fetchNative,this,args); nativeFetchPromises.add(p); return p; };
      const readNative = ReadableStreamDefaultReader.prototype.read;
      ReadableStreamDefaultReader.prototype.read = function(...args) { const p = Reflect.apply(readNative,this,args); nativeReadPromises.add(p); return p; };
      (${observeUmamiConsumers.toString()})({key:'consumerSnapshot'});
    ` });
    await page.goto(`${fixtureOrigin}${publicationPath}/login`);
    const actual = await page.evaluate(async (path) => {
      const promise = fetch(path, { headers: { RSC: '1' } });
      const fetchIdentity = nativeFetchPromises.has(promise);
      const response = await promise;
      const reader = response.body.getReader();
      let bytes = 0; let readIdentity = true;
      for (;;) {
        const pending = reader.read(); readIdentity &&= nativeReadPromises.has(pending);
        const result = await pending;
        if (result.done) break;
        bytes += result.value.byteLength;
      }
      return { fetchIdentity, readIdentity, bytes, state: window.consumerSnapshot() };
    }, `${publicationPath}/rsc?mode=complete`);
    assert.equal(actual.fetchIdentity, true); assert.equal(actual.readIdentity, true);
    assert.equal(actual.bytes, 12); assert.equal(actual.state.errors, 0);
    assert.equal(actual.state.records[0].eof, 1);
    assert.equal(actual.state.records[0].bytes, 12);
    assert.equal(actual.state.records[0].pending, 0);
  });
});

test('real truncated, explicitly canceled and unread streams cannot prove completion', async () => {
  for (const mode of ['partial', 'cancel', 'unread']) {
    await withBrowser(async ({ page, fixtureOrigin }) => {
      const observer = await installUmamiRscDiagnostics(page, { origin: fixtureOrigin, publicationPath });
      const diagnostics = attachPageDiagnostics(page, {}, 'completion-fixture');
      await page.goto(`${fixtureOrigin}${publicationPath}/login`);
      await observer.beginAuthenticatedPhase();
      const checkpoint = checkpointPageDiagnostics(page, 'partial RSC');
      await page.evaluate(async ({ path, mode }) => {
        const response = await fetch(path, { headers: { RSC: '1' } });
        if (mode === 'unread') { await response.body.cancel(); return; }
        const reader = response.body.getReader();
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            if (mode === 'cancel') { await reader.cancel(); await reader.read(); break; }
          }
        } catch (_) { /* The fixture consumes its read rejection; the ledger still must fail. */ }
      }, { path: `${publicationPath}/rsc?mode=${mode}`, mode });
      await assert.rejects(() => observer.drainAndProve({ timeout: 2_000, quietMs: 100 }),
        /unproven Umami response completion|fetch or reader rejected/);
      assert.ok(diagnostics.actionableEvents().some((event) => event.kind === 'requestfailed'));
      assert.throws(() => acknowledgeExactPageDiagnostics(page, checkpoint, []), /unexpected diagnostic event multiset/);
    });
  }
});

test('real string, URL and Request fetches record abort-signal provenance without invoking getters again', async () => {
  await withBrowser(async ({ page, fixtureOrigin }) => {
    await page.addInitScript(observeUmamiConsumers, { key: 'consumerSnapshot' });
    await page.goto(`${fixtureOrigin}${publicationPath}/login`);
    const state = await page.evaluate(async (path) => {
      const controller = new AbortController();
      let getterCalls = 0;
      const accessor = { get signal() { getterCalls += 1; delete this.signal; return controller.signal; } };
      const cases = [
        [path], [new URL(path, location.href)], [path, { signal: undefined }], [path, { signal: null }],
        [path, { signal: controller.signal }], [new Request(path)], [path, accessor],
        [path, Object.create({ signal: controller.signal })],
      ];
      for (const args of cases) {
        const reader = (await fetch(...args)).body.getReader();
        while (!(await reader.read()).done) { /* Actual consumer EOF. */ }
      }
      controller.abort();
      return { ...window.consumerSnapshot(), getterCalls, aborted: controller.signal.aborted };
    }, `${publicationPath}/rsc?mode=complete`);
    assert.equal(state.errors, 0);
    assert.equal(state.getterCalls, 1);
    assert.equal(state.aborted, true);
    assert.deepEqual(state.records.map((record) => record.signalProvided), [false, false, false, false, true, true, true, true]);
    assert.ok(state.records.every((record) => record.eof === 1 && record.bytes === 12));
    for (const record of state.records.filter((entry) => entry.signalProvided)) {
      const input = valid(); input.consumers = [{ ...record, url }];
      assert.throws(() => proveUmamiRscCompletions(input), /abort signal/);
    }
  });
});

test('real fetch and reader rejections stay fatal when the passive observer handles their promises', async () => {
  for (const mode of ['fetch', 'reader']) {
    await withBrowser(async ({ page, fixtureOrigin }) => {
      const observer = await installUmamiRscDiagnostics(page, { origin: fixtureOrigin, publicationPath });
      await page.goto(`${fixtureOrigin}${publicationPath}/login`);
      await observer.beginAuthenticatedPhase();
      await page.evaluate(async ({ path, mode }) => {
        try {
          const response = await fetch(path, { headers: { RSC: '1' } });
          const reader = response.body.getReader();
          reader.releaseLock();
          await reader.read();
        } catch (_) { /* Both observed and application-handled rejections remain fatal. */ }
      }, { path: `${publicationPath}/${mode === 'fetch' ? 'abort' : 'rsc?mode=complete'}`, mode });
      await assert.rejects(() => observer.drainAndProve({ timeout: 2_000, quietMs: 100 }), /fetch or reader rejected/);
    });
  }
});

test('real successful streams need no exception and later errors remain actionable', async () => {
  await withBrowser(async ({ page, fixtureOrigin }) => {
    const observer = await installUmamiRscDiagnostics(page, { origin: fixtureOrigin, publicationPath });
    const diagnostics = attachPageDiagnostics(page, {}, 'completion-fixture');
    await page.goto(`${fixtureOrigin}${publicationPath}/login`);
    await observer.beginAuthenticatedPhase();
    const checkpoint = checkpointPageDiagnostics(page, 'successful RSC');
    await page.evaluate(async (path) => {
      const reader = (await fetch(path, { headers: { RSC: '1' } })).body.getReader();
      while (!(await reader.read()).done) { /* Actual application consumption. */ }
    }, `${publicationPath}/rsc?mode=complete`);
    const result = await observer.drainAndProve({ timeout: 2_000, quietMs: 100 });
    assert.deepEqual(result.expectedSignatures, []);
    assert.equal(result.proof.sameDocument, true);
    assert.equal(result.proof.drained, true);
    acknowledgeExactPageDiagnostics(page, checkpoint, []);
    await page.evaluate(() => console.error('unrelated fixture error'));
    assert.ok(diagnostics.actionableEvents().some((event) => event.kind === 'console'));
  });
});

test('a pre-phase reader rejection remains fatal across the whole observed document', async () => {
  await withBrowser(async ({ page, fixtureOrigin }) => {
    const observer = await installUmamiRscDiagnostics(page, { origin: fixtureOrigin, publicationPath });
    await page.goto(`${fixtureOrigin}${publicationPath}/login`);
    await page.evaluate(async (path) => {
      window.prePhaseReader = (await fetch(path)).body.getReader();
      window.prePhaseReader.releaseLock();
    }, `${publicationPath}/rsc?mode=complete`);
    await observer.beginAuthenticatedPhase();
    await page.evaluate(() => { void window.prePhaseReader.read(); });
    await assert.rejects(() => observer.drainAndProve({ timeout: 2_000, quietMs: 100 }), /fetch or reader rejected/);
  });
});

test('post-seal native fetch and reader unhandled rejections still reach the page-error ledger', async () => {
  await withBrowser(async ({ page, fixtureOrigin }) => {
    const observer = await installUmamiRscDiagnostics(page, { origin: fixtureOrigin, publicationPath });
    const diagnostics = attachPageDiagnostics(page, {}, 'sealed-completion-fixture');
    await page.goto(`${fixtureOrigin}${publicationPath}/login`);
    await page.evaluate(async (path) => {
      window.preSealReader = (await fetch(path)).body.getReader();
      window.preSealReader.releaseLock();
    }, `${publicationPath}/rsc?mode=complete`);
    await observer.beginAuthenticatedPhase();
    const result = await observer.drainAndProve({ timeout: 2_000, quietMs: 100 });
    assert.equal(result.proof.observerSealed, true);
    assert.equal(result.proof.pendingObservedPromises, 0);
    const oldReaderError = page.waitForEvent('pageerror', { timeout: 1_000 });
    await page.evaluate(() => { void window.preSealReader.read(); });
    assert.match((await oldReaderError).message, /released/i);
    const newReaderError = page.waitForEvent('pageerror', { timeout: 1_000 });
    await page.evaluate(async (path) => {
      const reader = (await fetch(path)).body.getReader();
      reader.releaseLock();
      void reader.read();
    }, `${publicationPath}/rsc?mode=complete`);
    assert.match((await newReaderError).message, /released/i);
    const fetchError = page.waitForEvent('pageerror', { timeout: 1_000 });
    await page.evaluate((path) => { void fetch(path); }, `${publicationPath}/abort`);
    assert.match((await fetchError).message, /fetch/i);
    assert.equal(diagnostics.actionableEvents().filter((event) => event.kind === 'pageerror').length, 3);
  });
});

test('atomic browser seal waits for both observed fetch and read promises to settle', async () => {
  for (const mode of ['fetch', 'read']) {
    await withBrowser(async ({ page, fixtureOrigin }) => {
      await page.addInitScript(observeUmamiConsumers, { key: 'consumerSnapshot' });
      await page.goto(`${fixtureOrigin}${publicationPath}/login`);
      const states = await page.evaluate(async ({ path, mode }) => {
        let pending;
        let reader;
        if (mode === 'fetch') pending = fetch(path);
        else {
          reader = (await fetch(path)).body.getReader();
          await reader.read();
          pending = reader.read();
        }
        const before = window.consumerSnapshot(true);
        const resolved = await pending;
        if (mode === 'fetch') reader = resolved.body.getReader();
        while (!(await reader.read()).done) { /* Actual consumer drains before seal. */ }
        const after = window.consumerSnapshot(true);
        await fetch(`${path}&later=1`);
        return { before, after, final: window.consumerSnapshot() };
      }, { path: `${publicationPath}/${mode === 'fetch' ? 'pending?' : 'rsc?mode=delayed'}`, mode });
      assert.equal(states.before.sealed, false);
      assert.equal(states.before.pending, 1);
      assert.equal(states.after.sealed, true);
      assert.equal(states.after.pending, 0);
      assert.equal(states.after.errors, 0);
      assert.deepEqual(states.final, states.after);
    });
  }
});
