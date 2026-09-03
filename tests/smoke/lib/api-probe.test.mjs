import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { request } from '@playwright/test';

import { getWithoutKeepAlive } from './api-probe.mjs';
import { hasAuthenticatedSession } from './auth.mjs';

const documentPath = '/Confidential/My Space/probe-\u00e9.docx';
const sessionUrl = `/base-agent-additional-server/onlyOffice/7000/control/office/session?path=${encodeURIComponent(documentPath)}`;

async function withProbeServer(run) {
  const sockets = new Map();
  const requests = [];
  const server = http.createServer((incoming, response) => {
    const socket = sockets.get(incoming.socket);
    const entry = {
      socketId: socket.id,
      url: incoming.url,
      method: incoming.method,
      connection: incoming.headers.connection,
      cookie: incoming.headers.cookie,
      closed: socket.closed,
    };
    requests.push(entry);
    // Close at the first bytes of a reused connection. This makes the stale
    // pooled-socket failure deterministic without racing an idle timer.
    if (socket.used || incoming.url === '/fail') {
      incoming.socket.destroy();
      return;
    }
    socket.used = true;
    response.setHeader('content-type', 'application/json');
    if (incoming.url === '/auth/token') {
      response.setHeader('set-cookie', 'probe-session=fixture; Path=/; HttpOnly');
    }
    response.end(JSON.stringify({ ok: true, requestedPath: documentPath }));
  });
  server.on('connection', (socket) => {
    let closed;
    const entry = {
      id: sockets.size + 1,
      used: false,
      closed: new Promise((resolve) => { closed = resolve; }),
    };
    sockets.set(socket, entry);
    socket.once('close', closed);
  });
  // The fixture expires a socket on reuse above, rather than through timing.
  server.keepAliveTimeout = 60_000;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = await request.newContext({
    baseURL: `http://127.0.0.1:${server.address().port}`,
    timeout: 2_000,
  });
  try {
    await run({ api, requests });
  } finally {
    await api.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('closing only the later probe still reuses the warm auth socket and fails', { timeout: 10_000 }, async () => {
  await withProbeServer(async ({ api, requests }) => {
    assert.equal((await api.get('/auth/token', { maxRetries: 0 })).status(), 200);
    await assert.rejects(getWithoutKeepAlive(api, sessionUrl), /socket hang up|ECONNRESET/);
    assert.equal(requests.length, 2, 'the failed call must not be retried');
    assert.equal(requests[0].connection, 'keep-alive');
    assert.equal(requests[1].connection, 'close');
    assert.equal(requests[0].socketId, requests[1].socketId);
    assert.deepEqual(requests.map(({ url }) => url), ['/auth/token', sessionUrl]);
  });
});

test('auth and both OnlyOffice probes close distinct real API sockets and retain session cookies', { timeout: 10_000 }, async () => {
  await withProbeServer(async ({ api, requests }) => {
    assert.equal(await hasAuthenticatedSession(api), true);
    await requests[0].closed;
    for (let index = 0; index < 2; index += 1) {
      const response = await getWithoutKeepAlive(api, sessionUrl);
      assert.equal(response.status(), 200);
      assert.deepEqual(await response.json(), { ok: true, requestedPath: documentPath });
      await requests.at(-1).closed;
    }
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map(({ socketId }) => socketId)).size, 3);
    assert.deepEqual(requests.map(({ url }) => url), ['/auth/token', sessionUrl, sessionUrl]);
    assert.deepEqual(requests.map(({ connection }) => connection), ['close', 'close', 'close']);
    assert.deepEqual(requests.map(({ method }) => method), ['GET', 'GET', 'GET']);
    assert.deepEqual(requests.slice(1).map(({ cookie }) => cookie), ['probe-session=fixture', 'probe-session=fixture']);

    await assert.rejects(getWithoutKeepAlive(api, '/fail'), /socket hang up|ECONNRESET/);
    assert.equal(requests.filter(({ url }) => url === '/fail').length, 1);
    assert.equal(new Set(requests.map(({ socketId }) => socketId)).size, 4);
  });
});
