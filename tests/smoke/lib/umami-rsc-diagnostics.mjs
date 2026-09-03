import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// This observer never reads or clones a response. Its collections contain only
// scalar observations; the native streams and readers are weakly referenced.
export function observeUmamiConsumers({ key, limit = 2_000 }) {
  const apply = Reflect.apply;
  const records = [];
  const streams = new WeakMap();
  const readers = new WeakMap();
  const documentId = crypto.randomUUID();
  let errors = 0;
  let sequence = 0;
  let sealed = false;
  const observe = (callback) => {
    try { callback(); } catch { errors += 1; }
  };
  const suppliesSignal = (input, init) => {
    if (input instanceof Request) return true;
    for (let object = init; object != null; object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, 'signal');
      // Do not evaluate an accessor a second time after native fetch used it.
      if (descriptor) return !('value' in descriptor) || descriptor.value != null;
    }
    return false;
  };
  const wrap = (object, name, wrapper) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (typeof descriptor?.value !== 'function') throw new Error('missing native stream method');
    Object.defineProperty(object, name, { ...descriptor, value: wrapper(descriptor.value) });
  };
  wrap(window, 'fetch', (native) => function (...args) {
    if (sealed) return apply(native, this, args);
    let signalProvided = true;
    observe(() => { signalProvided = suppliesSignal(args[0], args[1]); });
    const promise = apply(native, this, args);
    observe(() => {
      if (records.length >= limit) { errors += 1; return; }
      const input = args[0];
      const url = typeof input === 'string' ? new URL(input, location.href).href
        : input instanceof Request ? input.url : input instanceof URL ? input.href : null;
      const record = { id: ++sequence, url, signalProvided,
        status: null, body: false, readers: 0,
        reads: 0, bytes: 0, eof: 0, pending: 0, fetchPending: 1, readErrors: 0, fetchErrors: 0, cancels: 0 };
      records.push(record);
      promise.then((response) => {
        record.fetchPending = 0;
        observe(() => {
          record.status = response.status;
          const body = response.body;
          record.body = Boolean(body);
          if (body) streams.set(body, record);
        });
      }, () => { record.fetchPending = 0; record.fetchErrors += 1; });
    });
    return promise;
  });
  wrap(ReadableStream.prototype, 'getReader', (native) => function (...args) {
    if (sealed) return apply(native, this, args);
    const reader = apply(native, this, args);
    observe(() => {
      const record = streams.get(this);
      if (record) { record.readers += 1; readers.set(reader, record); }
    });
    return reader;
  });
  const observeCancel = (prototype, owners) => wrap(prototype, 'cancel', (native) => function (...args) {
    if (sealed) return apply(native, this, args);
    observe(() => { const record = owners.get(this); if (record) record.cancels += 1; });
    return apply(native, this, args);
  });
  observeCancel(ReadableStream.prototype, streams);
  for (const prototype of [ReadableStreamDefaultReader.prototype, window.ReadableStreamBYOBReader?.prototype]) {
    if (!prototype) continue;
    observeCancel(prototype, readers);
    wrap(prototype, 'read', (native) => function (...args) {
      if (sealed) return apply(native, this, args);
      const promise = apply(native, this, args);
      observe(() => {
        const record = readers.get(this);
        if (!record) return;
        record.pending += 1;
        promise.then((result) => {
          observe(() => {
            record.pending -= 1;
            record.reads += 1;
            if (result.done) record.eof += 1;
            if (ArrayBuffer.isView(result.value)) record.bytes += result.value.byteLength;
            else if (result.value !== undefined) errors += 1;
          });
        }, () => { record.pending -= 1; record.readErrors += 1; });
      });
      return promise;
    });
  }
  Object.defineProperty(window, key, {
    value: (trySeal = false) => {
      const pending = records.reduce((count, record) => count + record.fetchPending + record.pending, 0);
      if (trySeal && pending === 0) sealed = true;
      return { documentId, sequence, errors, pending, sealed, records: records.map((record) => ({ ...record })) };
    },
  });
}

function published(url, origin, publicationPath) {
  return url.origin === origin && !url.username && !url.password && !url.hash
    && (url.pathname === publicationPath || url.pathname.startsWith(`${publicationPath}/`));
}

function safeUrl(raw) {
  const url = new URL(raw);
  return { origin: url.origin, pathname: url.pathname,
    querySha256: createHash('sha256').update(url.search).digest('hex') };
}

// Inputs are independent protocol/consumer observations, never diagnostic-ledger events.
export function proveUmamiRscCompletions({ requests, consumers, documentConsumers = consumers,
  origin, publicationPath, observerErrors = 0 }) {
  assert.equal(observerErrors, 0, 'Umami response observer failed');
  // Rejection observers mark native Promises handled. Require their failure
  // counts globally so instrumentation cannot conceal an unhandled rejection.
  assert.ok(documentConsumers.every((entry) => entry.fetchErrors === 0 && entry.readErrors === 0),
    'Umami document fetch or reader rejected');
  const expectedSignatures = [];
  const completed = [];
  for (const request of requests.filter((entry) => entry.failed)) {
    const fail = (condition, message) => assert.ok(condition, `unproven Umami response completion: ${message}`);
    const group = requests.filter((entry) => entry.url === request.url);
    const matches = consumers.filter((entry) => entry.url === request.url);
    fail(matches.length === group.length, 'equal protocol and original consumer counts required');
    fail(new Set(group.map((entry) => entry.id)).size === group.length
      && group.every((entry) => typeof entry.id === 'string' && entry.id.length > 0), 'unique protocol identities required');
    fail(new Set(matches.map((entry) => entry.id)).size === matches.length
      && matches.every((entry) => Number.isSafeInteger(entry.id) && entry.id > 0), 'unique consumer identities required');
    // Concurrent identical URLs cannot be paired by arrival order. Require every
    // possible pairing to prove completion, including normally finished siblings.
    // Heterogeneous byte counts remain ambiguous and fail closed.
    fail(Number.isSafeInteger(request.decodedBytes) && request.decodedBytes > 0, 'complete decoded byte count required');
    for (const member of group) {
      fail(member.method === 'GET' && member.type === 'Fetch' && member.rsc === true, 'GET RSC fetch required');
      fail(published(new URL(member.url), origin, publicationPath), 'publication boundary');
      fail(member.starts === 1 && member.responses === 1 && !member.redirected, 'redirect or repeated protocol identity');
      fail(member.status === 200 && member.mimeType === 'text/x-component'
        && /^text\/x-component(?:;|$)/i.test(member.contentType || ''), 'successful component response required');
      const canceled = member.failed === true && member.canceled === true && member.errorText === 'net::ERR_ABORTED'
        && !member.blockedReason && !member.corsError && member.finished === false;
      const finished = member.failed === false && member.finished === true && !member.canceled
        && !member.errorText && !member.blockedReason && !member.corsError;
      fail(canceled || finished, 'exact browser cancellation or clean protocol finish required');
      fail(member.decodedBytes === request.decodedBytes, 'uniform complete decoded byte count required');
    }
    for (const consumer of matches) {
      fail(consumer.signalProvided === false, 'supplied or unobservable abort signal');
      fail(consumer.status === 200 && consumer.body === true && consumer.readers === 1, 'one original body reader required');
      fail(consumer.eof === 1 && consumer.reads >= 2 && consumer.pending === 0
        && consumer.readErrors === 0 && consumer.fetchErrors === 0 && consumer.cancels === 0,
      'error-free application EOF without explicit cancellation required');
      fail(consumer.bytes === request.decodedBytes, 'complete decoded byte count required');
    }
    expectedSignatures.push({ kind: 'requestfailed', type: 'error', url: request.url,
      method: 'GET', failure: 'net::ERR_ABORTED' });
    completed.push({ requestId: request.id, ...safeUrl(request.url), status: request.status,
      mimeType: request.mimeType, canceled: true, failure: request.errorText,
      ...(matches.length === 1 ? { consumerId: matches[0].id, readers: 1, reads: matches[0].reads } : {
        equivalentRequests: group.map((entry) => ({ requestId: entry.id,
          terminal: entry.failed ? 'canceled' : 'finished', decodedBytes: entry.decodedBytes })),
        completeConsumerCandidates: matches.map((entry) => ({ consumerId: entry.id, readers: 1, reads: entry.reads })),
      }),
      eof: true, consumerBytes: request.decodedBytes, decodedBytes: request.decodedBytes, readErrors: 0 });
  }
  return { expectedSignatures, proof: { schema: 'umami-rsc-completion/v1',
    observedRequests: requests.length, observedConsumers: consumers.length, observerErrors, completed } };
}

export async function installUmamiRscDiagnostics(page, { origin, publicationPath }) {
  assert.equal(new URL(origin).origin, origin, 'exact Router origin required');
  assert.ok(publicationPath.startsWith('/') && !publicationPath.endsWith('/'), 'exact publication base required');
  const key = `__umamiConsumer_${randomUUID().replaceAll('-', '')}`;
  await page.addInitScript(observeUmamiConsumers, { key });
  const cdp = await page.context().newCDPSession(page);
  const requests = new Map();
  let sequence = 0;
  let lastActivity = performance.now();
  let phase;
  let sealed = false;
  let overflow = false;
  const touch = () => { lastActivity = performance.now(); };
  cdp.on('Network.requestWillBeSent', (event) => {
    if (sealed) return;
    touch();
    if (requests.size >= 2_000) { overflow = true; return; }
    const previous = requests.get(event.requestId);
    const headers = Object.fromEntries(Object.entries(event.request.headers).map(([name, value]) => [name.toLowerCase(), value]));
    requests.set(event.requestId, { id: event.requestId, sequence: previous?.sequence ?? ++sequence,
      url: event.request.url, method: event.request.method, type: event.type, rsc: headers.rsc === '1',
      starts: (previous?.starts || 0) + 1, responses: 0, redirected: Boolean(event.redirectResponse),
      decodedBytes: 0, finished: false, failed: false });
  });
  cdp.on('Network.responseReceived', (event) => {
    const record = requests.get(event.requestId); if (!record || sealed) return;
    touch();
    const headers = Object.fromEntries(Object.entries(event.response.headers).map(([name, value]) => [name.toLowerCase(), value]));
    Object.assign(record, { responses: record.responses + 1, status: event.response.status,
      mimeType: event.response.mimeType, contentType: headers['content-type'] || '' });
  });
  cdp.on('Network.dataReceived', (event) => {
    const record = requests.get(event.requestId); if (!record || sealed) return;
    touch(); record.decodedBytes += event.dataLength;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const record = requests.get(event.requestId); if (!record || sealed) return;
    touch(); record.finished = true;
  });
  cdp.on('Network.loadingFailed', (event) => {
    const record = requests.get(event.requestId); if (!record || sealed) return;
    touch(); Object.assign(record, { failed: true, canceled: event.canceled === true,
      errorText: event.errorText, blockedReason: event.blockedReason || '', corsError: Boolean(event.corsErrorStatus) });
  });
  await cdp.send('Network.enable');
  const snapshot = (trySeal = false) => page.evaluate(({ name, seal }) => window[name](seal), { name: key, seal: trySeal });
  return {
    async beginAuthenticatedPhase() {
      assert.ok(!phase && !sealed, 'Umami completion phase can only begin once');
      const state = await snapshot();
      assert.equal(state.errors, 0, 'Umami consumer observer must be installed without errors');
      phase = { documentId: state.documentId, fetchSequence: state.sequence, requestSequence: sequence };
    },
    async drainAndProve({ timeout = 10_000, quietMs = 500 } = {}) {
      assert.ok(phase && !sealed, 'Umami completion phase must be open');
      const deadline = performance.now() + timeout;
      try {
        let state;
        const drained = () => ![...requests.values()].some((entry) => entry.rsc && !entry.finished && !entry.failed)
          && performance.now() - lastActivity >= quietMs;
        while (performance.now() < deadline) {
          if (drained()) {
            state = await snapshot(true);
            if (state.sealed) {
              // New traffic after the atomic browser seal cannot borrow its proof.
              assert.ok(drained(), 'Umami traffic changed during observer seal');
              break;
            }
          }
          await page.waitForTimeout(25);
        }
        assert.ok(performance.now() < deadline, 'Umami RSC traffic did not drain');
        assert.equal(state.documentId, phase.documentId, 'Umami replaced the authenticated document');
        assert.equal(state.sealed, true, 'Umami consumer observer must be sealed');
        assert.equal(state.pending, 0, 'Umami observed promises must settle before sealing');
        assert.equal(overflow, false, 'Umami protocol observation overflow');
        sealed = true;
        const result = proveUmamiRscCompletions({
          requests: [...requests.values()].filter((entry) => entry.sequence > phase.requestSequence),
          consumers: state.records.filter((entry) => entry.id > phase.fetchSequence),
          documentConsumers: state.records,
          origin, publicationPath, observerErrors: state.errors,
        });
        result.proof.sameDocument = true;
        result.proof.drained = true;
        result.proof.observerSealed = true;
        result.proof.pendingObservedPromises = 0;
        return result;
      } finally {
        sealed = true;
        await cdp.detach();
      }
    },
  };
}
