import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorProxy } from '../src/proxy/editor-proxy.mjs';

const EDITOR_ORIGIN = 'http://localhost:8080';
const EDITOR_PREFIX = '/base-agent-additional-server/onlyOffice/8080';
const ACTIVE_EDITOR_URL = `${EDITOR_ORIGIN}${EDITOR_PREFIX}`;
const ROUTER_INTERNAL_HOST = '127.0.0.1:8080';

function routerHeaders({ origin, extra = {} } = {}) {
  return {
    host: ROUTER_INTERNAL_HOST,
    'x-forwarded-host': 'localhost:8080',
    'x-forwarded-proto': 'http',
    'x-forwarded-prefix': EDITOR_PREFIX,
    ...(origin === undefined ? {} : { origin }),
    ...extra,
  };
}

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

test('default topology resolution accepts the exact localhost Router request tuple', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:80',
    async forwardHttp(plan) {
      forwarded.push(plan);
      return { statusCode: 200, body: 'window.DocsAPI = {};' };
    },
  });
  const res = createResponse();

  await proxy.handle({
    method: 'GET',
    url: '/web-apps/apps/api/documents/api.js',
    headers: routerHeaders({ origin: EDITOR_ORIGIN }),
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, 'window.DocsAPI = {};');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers['x-forwarded-host'], 'localhost:8080');
  assert.equal(forwarded[0].headers['x-forwarded-proto'], 'http');
  assert.equal(forwarded[0].headers['x-forwarded-prefix'], EDITOR_PREFIX);
});

test('exact Router tuples retain canonical public-domain and IPv6 browser authorities', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:80',
    async forwardHttp(plan) {
      forwarded.push(plan);
      return { statusCode: 200, body: 'ok' };
    },
  });
  const authorities = [
    { authority: 'office.example', protocol: 'https', origin: 'https://office.example' },
    { authority: '[::1]:8080', protocol: 'http', origin: 'http://[::1]:8080' },
  ];

  for (const { authority, protocol, origin } of authorities) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers: {
        host: ROUTER_INTERNAL_HOST,
        'x-forwarded-host': authority,
        'x-forwarded-proto': protocol,
        'x-forwarded-prefix': EDITOR_PREFIX,
        origin,
      },
    }, res);
    assert.equal(res.statusCode, 200, authority);
  }

  assert.equal(forwarded.length, authorities.length);
});

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
    await proxy.handle({ method: 'GET', url, headers: routerHeaders() }, res);
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
    { method: 'GET', url: '/coauthoring/CommandService.ashx', headers: routerHeaders() },
    { method: 'GET', url: '/ConvertService.ashx', headers: routerHeaders() },
    { method: 'GET', url: '/internal/health', headers: routerHeaders() },
    { method: 'GET', url: '/healthcheck', headers: routerHeaders() },
    { method: 'GET', url: '/cache/files/', headers: routerHeaders() },
    { method: 'POST', url: '/web-apps/apps/api/documents/api.js', headers: routerHeaders() },
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
      ...routerHeaders({ origin: EDITOR_ORIGIN }),
      authorization: 'Bearer browser',
      cookie: 'session=browser',
      'proxy-authorization': 'Basic browser',
      'x-ploinky-auth-info': 'identity',
      'x-ploinky-csrf-token': 'csrf',
      'Ploinky-Agent-Assertion': 'private-router-assertion',
      accept: '*/*',
    },
  }, res);

  assert.deepEqual(forwarded[0].headers, {
    origin: EDITOR_ORIGIN,
    accept: '*/*',
    'x-forwarded-host': 'localhost:8080',
    'x-forwarded-proto': 'http',
    'x-forwarded-prefix': EDITOR_PREFIX,
  });
});

test('editor transport requires the complete exact Router-installed request shape before dialing', async () => {
  let httpDials = 0;
  let websocketDials = 0;
  const proxy = createTestProxy({
    async forwardHttp() {
      httpDials += 1;
      return { statusCode: 200, body: 'unexpected' };
    },
    async forwardUpgrade() {
      websocketDials += 1;
    },
  });
  const completeHeaders = routerHeaders({ origin: EDITOR_ORIGIN });
  const without = (name) => Object.fromEntries(
    Object.entries(completeHeaders).filter(([headerName]) => headerName !== name),
  );
  const invalidShapes = [
    ['missing Host', without('host')],
    ['public Host presented directly', { ...completeHeaders, host: 'localhost:8080' }],
    ['wrong internal Host port', { ...completeHeaders, host: '127.0.0.1:8081' }],
    ['Host array', { ...completeHeaders, host: [ROUTER_INTERNAL_HOST] }],
    ['Host comma form', { ...completeHeaders, host: `${ROUTER_INTERNAL_HOST},localhost:8080` }],
    ['Host whitespace', { ...completeHeaders, host: ` ${ROUTER_INTERNAL_HOST}` }],
    ['missing forwarded host', without('x-forwarded-host')],
    ['wrong forwarded host', { ...completeHeaders, 'x-forwarded-host': '127.0.0.1:8080' }],
    ['wrong forwarded host port', { ...completeHeaders, 'x-forwarded-host': 'localhost:8081' }],
    ['forwarded host array', { ...completeHeaders, 'x-forwarded-host': ['localhost:8080'] }],
    ['forwarded host comma form', { ...completeHeaders, 'x-forwarded-host': 'localhost:8080,evil.example' }],
    ['forwarded host whitespace', { ...completeHeaders, 'x-forwarded-host': ' localhost:8080' }],
    ['overlong forwarded host label', {
      ...completeHeaders,
      'x-forwarded-host': `${'a'.repeat(64)}.example:8080`,
    }],
    ['duplicate forwarded host spelling', {
      ...completeHeaders,
      'X-Forwarded-Host': 'localhost:8080',
    }],
    ['missing forwarded protocol', without('x-forwarded-proto')],
    ['wrong forwarded protocol', { ...completeHeaders, 'x-forwarded-proto': 'https' }],
    ['forwarded protocol array', { ...completeHeaders, 'x-forwarded-proto': ['http'] }],
    ['forwarded protocol comma form', { ...completeHeaders, 'x-forwarded-proto': 'http,https' }],
    ['forwarded protocol whitespace', { ...completeHeaders, 'x-forwarded-proto': 'http ' }],
    ['missing forwarded prefix', without('x-forwarded-prefix')],
    ['wrong forwarded prefix', { ...completeHeaders, 'x-forwarded-prefix': `${EDITOR_PREFIX}/` }],
    ['wrong forwarded prefix port', {
      ...completeHeaders,
      'x-forwarded-prefix': '/base-agent-additional-server/onlyOffice/8081',
    }],
    ['forwarded prefix array', { ...completeHeaders, 'x-forwarded-prefix': [EDITOR_PREFIX] }],
    ['forwarded prefix comma form', {
      ...completeHeaders,
      'x-forwarded-prefix': `${EDITOR_PREFIX},/evil`,
    }],
    ['forwarded prefix whitespace', { ...completeHeaders, 'x-forwarded-prefix': ` ${EDITOR_PREFIX}` }],
    ['legacy Forwarded spoof', { ...completeHeaders, forwarded: 'for=203.0.113.8' }],
    ['extra forwarded spoof', { ...completeHeaders, 'x-forwarded-for': '203.0.113.8' }],
  ];

  for (const [label, headers] of invalidShapes) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers,
    }, res);
    assert.equal(res.statusCode, 404, `HTTP: ${label}`);

    const socket = { destroyed: false, destroy() { this.destroyed = true; } };
    await proxy.handleUpgrade({
      method: 'GET',
      url: '/doc/123/c',
      headers: {
        ...headers,
        connection: 'Upgrade',
        upgrade: 'websocket',
      },
    }, socket, Buffer.alloc(0));
    assert.equal(socket.destroyed, true, `WebSocket: ${label}`);
  }

  assert.equal(httpDials, 0);
  assert.equal(websocketDials, 0);
});

test('editor transport rejects ambiguous or unexpected active browser routes before dialing', async () => {
  const invalidBrowserUrls = [
    'not a URL',
    'ftp://office.example/base-agent-additional-server/onlyOffice/8080',
    'https://user@office.example/base-agent-additional-server/onlyOffice/8080',
    'https://office.example/base-agent-additional-server/onlyOffice/8080/',
    'https://office.example/base-agent-additional-server/onlyOffice/8080//',
    'https://office.example/base-agent-additional-server/onlyOffice/8080/extra',
    'https://office.example/ignored/../base-agent-additional-server/onlyOffice/8080',
    'https://office.example/base-agent-additional-server/onlyOffice/%38%30%38%30',
    'https://office.example/base-agent-additional-server/onlyOffice/80800',
    'https://office.example/base-agent-additional-server/onlyOffice/8080?prefix=other',
    'https://office.example/base-agent-additional-server/onlyOffice/8080#other',
    ' https://office.example/base-agent-additional-server/onlyOffice/8080',
  ];

  for (const activeBrowserUrl of invalidBrowserUrls) {
    let dialed = false;
    const proxy = createTestProxy({
      resolveEditorService: async () => ({ activeBrowserUrl }),
      async forwardHttp() { dialed = true; },
    });
    const res = createResponse();
    await assert.rejects(
      proxy.handle({
        method: 'GET',
        url: '/cache/files/data/document/Editor.bin/Editor.bin',
        headers: routerHeaders(),
      }, res),
      /browser URL|committed Router route/,
      activeBrowserUrl,
    );
    assert.equal(dialed, false, activeBrowserUrl);
  }
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
    [EDITOR_ORIGIN],
    `${EDITOR_ORIGIN},http://evil.example`,
  ]) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers: routerHeaders({ origin }),
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
      ...routerHeaders({ origin: EDITOR_ORIGIN }),
      connection: 'Upgrade',
      upgrade: 'websocket',
      'Ploinky-Agent-Assertion': 'private-router-assertion',
    },
  }, accepted, Buffer.alloc(0));
  assert.equal(accepted.destroyed, false);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].targetUrl, 'ws://127.0.0.1/doc/123/c');
  assert.equal(forwarded[0].headers['x-forwarded-proto'], 'http');
  assert.equal(
    forwarded[0].headers['x-forwarded-prefix'],
    EDITOR_PREFIX,
  );
  assert.equal(forwarded[0].headers['Ploinky-Agent-Assertion'], undefined);

  for (const headers of [
    { ...routerHeaders(), upgrade: 'websocket' },
    { ...routerHeaders({ origin: 'http://evil.example' }), upgrade: 'websocket' },
    { ...routerHeaders({ origin: `${EDITOR_ORIGIN}/` }), upgrade: 'websocket' },
    { ...routerHeaders({ origin: `${EDITOR_ORIGIN}/path` }), upgrade: 'websocket' },
    { ...routerHeaders({ origin: 'http://user:pass@localhost:8080' }), upgrade: 'websocket' },
    { ...routerHeaders({ origin: ` ${EDITOR_ORIGIN}` }), upgrade: 'websocket' },
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
    proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers: routerHeaders(),
    }, res),
    /generation inactive/,
  );
  assert.equal(dialed, false);
});

test('self-derived malformed Router authorities cannot reach the upstream', async () => {
  let dials = 0;
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:80',
    async forwardHttp() {
      dials += 1;
      return { statusCode: 200, body: 'unexpected' };
    },
  });
  const invalidAuthorities = [
    `${'a'.repeat(64)}.example:8080`,
    `${'a'.repeat(254)}:8080`,
  ];

  for (const authority of invalidAuthorities) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: '/web-apps/apps/api/documents/api.js',
      headers: {
        host: ROUTER_INTERNAL_HOST,
        'x-forwarded-host': authority,
        'x-forwarded-proto': 'http',
        'x-forwarded-prefix': EDITOR_PREFIX,
      },
    }, res);
    assert.equal(res.statusCode, 404, authority);
  }
  assert.equal(dials, 0);
});
