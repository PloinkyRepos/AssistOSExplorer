import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorProxy } from '../src/proxy/editor-proxy.mjs';

const ACTIVE_EDITOR_URL = 'https://office.example/base-agent-additional-server/onlyOffice/8080/';

function createResponse() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(String(chunk)));
      this.finished = true;
    },
    get bodyText() { return Buffer.concat(chunks).toString('utf8'); },
  };
}

function createTestProxy(options = {}) {
  return createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:80',
    resolveEditorService: async () => ({ activeBrowserUrl: ACTIVE_EDITOR_URL }),
    ...options,
  });
}

test('editor transport exposes only the pinned asset and cache allowlist', async () => {
  const forwarded = [];
  const proxy = createTestProxy({
    async forwardHttp(plan) {
      forwarded.push(plan);
      return { statusCode: 200, body: 'proxied' };
    },
  });

  const allowed = [
    '/web-apps/apps/api/documents/api.js',
    '/web-apps/apps/documenteditor/main/index.html',
    '/9.3.1-8d9a2cf/web-apps/apps/documenteditor/main/index.html',
    '/document_editor_service_worker.js',
    '/sdkjs/main.js',
    '/sdkjs-plugins/plugin.js',
    '/fonts/font.woff2',
    '/themes/theme.css',
    '/cache/files/report.docx',
  ];
  for (const url of allowed) {
    const res = createResponse();
    await proxy.handle({ method: 'GET', url, headers: { host: 'office.example' } }, res);
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.bodyText, 'proxied', url);
  }
  assert.equal(forwarded.length, allowed.length);
});

test('editor transport rejects control, malformed host, method, and bare cache paths before dialing', async () => {
  let dialed = false;
  const proxy = createTestProxy({
    async forwardHttp() { dialed = true; },
  });
  const requests = [
    { method: 'GET', url: '/coauthoring/CommandService.ashx', headers: { host: 'office.example' } },
    { method: 'GET', url: '/ConvertService.ashx', headers: { host: 'office.example' } },
    { method: 'GET', url: '/internal/health', headers: { host: 'office.example' } },
    { method: 'GET', url: '/healthcheck', headers: { host: 'office.example' } },
    { method: 'GET', url: '/cache/files/', headers: { host: 'office.example' } },
    { method: 'POST', url: '/web-apps/apps/api/documents/api.js', headers: { host: 'office.example' } },
    { method: 'GET', url: '/web-apps/apps/api/documents/api.js', headers: { host: 'office.example.evil' } },
  ];
  for (const req of requests) {
    const res = createResponse();
    await proxy.handle(req, res);
    assert.equal(res.statusCode, 404, `${req.method} ${req.url}`);
  }
  assert.equal(dialed, false);
});

test('editor transport strips browser credentials and installs canonical forwarding headers', async () => {
  const forwarded = [];
  const proxy = createTestProxy({
    async forwardHttp(plan) {
      forwarded.push(plan);
      return { statusCode: 200, body: 'ok' };
    },
  });
  const res = createResponse();
  await proxy.handle({
    method: 'GET',
    url: '/web-apps/apps/api/documents/api.js',
    headers: {
      host: 'office.example',
      authorization: 'Bearer browser',
      cookie: 'session=browser',
      forwarded: 'for=evil',
      'proxy-authorization': 'Basic browser',
      'x-forwarded-for': '203.0.113.8',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'http',
      'x-ploinky-auth-info': 'identity',
      'x-ploinky-csrf-token': 'csrf',
      'Ploinky-Agent-Assertion': 'private-router-assertion',
      accept: '*/*',
    },
  }, res);

  assert.deepEqual(forwarded[0].headers, {
    accept: '*/*',
    'x-forwarded-host': 'office.example',
    'x-forwarded-proto': 'https',
  });
});

test('editor transport rejects non-serialized exact Origin values before dialing', async () => {
  let dialed = false;
  const proxy = createTestProxy({
    async forwardHttp() { dialed = true; },
  });

  for (const origin of [
    'https://office.example/',
    'https://office.example/path',
    'https://user:pass@office.example',
    ' https://office.example',
    'https://office.example ',
    'https://office.example.evil',
  ]) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers: { host: 'office.example', origin },
    }, res);
    assert.equal(res.statusCode, 404, origin);
  }
  assert.equal(dialed, false);
});

test('editor websocket requires exact current host and Origin', async () => {
  const forwarded = [];
  const proxy = createTestProxy({
    async forwardUpgrade(plan) { forwarded.push(plan); },
  });
  const accepted = { destroyed: false, destroy() { this.destroyed = true; } };
  await proxy.handleUpgrade({
    method: 'GET',
    url: '/doc/123/c',
    headers: {
      host: 'office.example',
      origin: 'https://office.example',
      connection: 'Upgrade',
      upgrade: 'websocket',
      'Ploinky-Agent-Assertion': 'private-router-assertion',
    },
  }, accepted, Buffer.alloc(0));
  assert.equal(accepted.destroyed, false);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].targetUrl, 'ws://127.0.0.1/doc/123/c');
  assert.equal(forwarded[0].headers['x-forwarded-proto'], 'https');
  assert.equal(forwarded[0].headers['Ploinky-Agent-Assertion'], undefined);

  for (const headers of [
    { host: 'office.example', upgrade: 'websocket' },
    { host: 'office.example', origin: 'https://evil.example', upgrade: 'websocket' },
    { host: 'office.example', origin: 'https://office.example/', upgrade: 'websocket' },
    { host: 'office.example', origin: 'https://office.example/path', upgrade: 'websocket' },
    { host: 'office.example', origin: 'https://user:pass@office.example', upgrade: 'websocket' },
    { host: 'office.example', origin: ' https://office.example', upgrade: 'websocket' },
    { host: 'office.example.evil', origin: 'https://office.example', upgrade: 'websocket' },
  ]) {
    const rejected = { destroyed: false, destroy() { this.destroyed = true; } };
    await proxy.handleUpgrade({ method: 'GET', url: '/doc/123/c', headers }, rejected, Buffer.alloc(0));
    assert.equal(rejected.destroyed, true);
  }
  assert.equal(forwarded.length, 1);
});

test('invalid or stale topology prevents an upstream connection', async () => {
  let dialed = false;
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:80',
    resolveEditorService: async () => { throw new Error('generation inactive'); },
    async forwardHttp() { dialed = true; },
  });
  const res = createResponse();
  await assert.rejects(
    proxy.handle({ method: 'GET', url: '/web-apps/apps/api/documents/api.js', headers: { host: 'office.example' } }, res),
    /generation inactive/,
  );
  assert.equal(dialed, false);
});
