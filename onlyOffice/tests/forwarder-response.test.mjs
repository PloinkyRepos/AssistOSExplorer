import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createHttpForwarder, sanitizeUpgradeHandshake } from '../src/index.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
  });
}

test('HTTP forwarder exposes only pinned asset headers and rejects internal redirects', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, {
        location: 'http://127.0.0.1:80/internal/admin',
        'set-cookie': 'documentserver=secret; HttpOnly',
      });
      res.end('internal redirect body');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/javascript',
      'cache-control': 'public, max-age=60',
      etag: '"safe-etag"',
      'set-cookie': 'documentserver=secret; HttpOnly',
      'www-authenticate': 'Basic realm="internal"',
      forwarded: 'for=127.0.0.1',
      'x-forwarded-host': '127.0.0.1:80',
      via: 'internal-proxy',
      connection: 'x-internal-hop',
      'x-internal-hop': 'private-value',
    });
    res.end('asset');
  });
  const upstreamPort = await listen(upstream);
  const forward = createHttpForwarder();
  const publicServer = http.createServer((req, res) => {
    forward({ targetUrl: `http://127.0.0.1:${upstreamPort}${req.url}`, headers: {} }, req, res)
      .catch(() => {
        if (!res.headersSent) res.writeHead(502, { 'cache-control': 'no-store' });
        if (!res.writableEnded) res.end('upstream failure');
      });
  });
  const publicPort = await listen(publicServer);
  try {
    const asset = await request(publicPort, '/asset');
    assert.equal(asset.status, 200);
    assert.equal(asset.body, 'asset');
    assert.equal(asset.headers['content-type'], 'application/javascript');
    assert.equal(asset.headers['cache-control'], 'public, max-age=60');
    assert.equal(asset.headers.etag, '"safe-etag"');
    for (const blocked of [
      'set-cookie', 'www-authenticate', 'forwarded', 'x-forwarded-host',
      'via', 'x-internal-hop', 'location',
    ]) {
      assert.equal(asset.headers[blocked], undefined, blocked);
    }

    const redirect = await request(publicPort, '/redirect');
    assert.equal(redirect.status, 502);
    assert.equal(redirect.headers.location, undefined);
    assert.equal(redirect.headers['set-cookie'], undefined);
    assert.equal(redirect.headers['cache-control'], 'no-store');
    assert.equal(redirect.body, 'DocumentServer redirect rejected.');
  } finally {
    await close(publicServer);
    await close(upstream);
  }
});

test('WebSocket handshake sanitizer drops cookies, redirects, forwarding, and hop-by-hop metadata', () => {
  const input = Buffer.from([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade, x-internal-hop',
    'Sec-WebSocket-Accept: exact-accept',
    'Sec-WebSocket-Protocol: binary',
    'Set-Cookie: documentserver=secret',
    'Location: http://127.0.0.1:80/internal',
    'Forwarded: for=127.0.0.1',
    'X-Forwarded-Host: internal',
    'Via: internal',
    'X-Internal-Hop: private',
    '',
    '',
  ].join('\r\n') + 'first-frame', 'latin1');
  const result = sanitizeUpgradeHandshake(input);
  const handshake = result.handshake.toString('latin1').toLowerCase();
  assert.match(handshake, /^http\/1\.1 101 switching protocols/);
  assert.match(handshake, /sec-websocket-accept: exact-accept/);
  assert.match(handshake, /sec-websocket-protocol: binary/);
  for (const blocked of ['set-cookie', 'location', 'forwarded:', 'x-forwarded', 'via:', 'x-internal-hop']) {
    assert.equal(handshake.includes(blocked), false, blocked);
  }
  assert.equal(result.remainder.toString('latin1'), 'first-frame');
});

test('WebSocket handshake sanitizer fails closed on non-upgrade and ambiguous accept headers', () => {
  assert.throws(
    () => sanitizeUpgradeHandshake(Buffer.from('HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\n\r\n')),
    /did not return 101/i,
  );
  assert.throws(
    () => sanitizeUpgradeHandshake(Buffer.from([
      'HTTP/1.1 101 Switching Protocols',
      'Sec-WebSocket-Accept: one',
      'Sec-WebSocket-Accept: two',
      '',
      '',
    ].join('\r\n'))),
    /repeats sec-websocket-accept/i,
  );
});
