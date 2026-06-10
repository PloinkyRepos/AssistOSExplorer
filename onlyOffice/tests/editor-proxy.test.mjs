import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorProxy } from '../src/proxy/editor-proxy.mjs';

function createResponse() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.finished = true;
    },
    get bodyText() {
      return Buffer.concat(chunks).toString('utf8');
    }
  };
}

test('editor proxy allows api js and editor asset prefixes', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp(plan) {
      forwarded.push(plan);
      return {
        statusCode: 200,
        body: 'proxied'
      };
    }
  });

  for (const pathname of [
    '/web-apps/apps/api/documents/api.js',
    '/web-apps/apps/documenteditor/main/index.html',
    '/9.3.1-432bda2685f348ede7efa2a35cafe793/web-apps/apps/documenteditor/main/index.html',
    '/sdkjs/main.js',
    '/sdkjs-plugins/plugin.js',
    '/fonts/font.woff2',
    '/themes/theme.css',
    '/cache/files/report.docx'
  ]) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: pathname,
      headers: {
        host: 'office.example'
      }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.bodyText, 'proxied');
  }

  assert.deepEqual(
    forwarded.map((entry) => entry.targetUrl),
    [
      'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
      'http://127.0.0.1:8080/web-apps/apps/documenteditor/main/index.html',
      'http://127.0.0.1:8080/9.3.1-432bda2685f348ede7efa2a35cafe793/web-apps/apps/documenteditor/main/index.html',
      'http://127.0.0.1:8080/sdkjs/main.js',
      'http://127.0.0.1:8080/sdkjs-plugins/plugin.js',
      'http://127.0.0.1:8080/fonts/font.woff2',
      'http://127.0.0.1:8080/themes/theme.css',
      'http://127.0.0.1:8080/cache/files/report.docx'
    ]
  );
});

test('editor proxy forwards websocket upgrades under /doc/', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardUpgrade(plan) {
      forwarded.push(plan);
    }
  });
  const socket = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    }
  };

  await proxy.handleUpgrade({
    method: 'GET',
    url: '/doc/123/c',
    headers: {
      upgrade: 'websocket',
      connection: 'Upgrade',
      host: 'office.example'
    }
  }, socket, Buffer.alloc(0));

  assert.equal(socket.destroyed, false);
  assert.deepEqual(forwarded, [
    {
      kind: 'ws',
      targetUrl: 'ws://127.0.0.1:8080/doc/123/c',
      headers: {
        connection: 'Upgrade',
        host: 'office.example',
        upgrade: 'websocket'
      }
    }
  ]);
});

test('editor proxy blocks command service from the internet', async () => {
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp() {
      throw new Error('blocked request should not be forwarded');
    }
  });
  const res = createResponse();

  await proxy.handle({
    method: 'GET',
    url: '/coauthoring/CommandService.ashx',
    headers: {}
  }, res);

  assert.equal(res.statusCode, 404);
});

test('editor proxy blocks convert service from the internet', async () => {
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp() {
      throw new Error('blocked request should not be forwarded');
    }
  });

  for (const pathname of ['/ConvertService.ashx', '/converter']) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: pathname,
      headers: {}
    }, res);
    assert.equal(res.statusCode, 404);
  }
});

test('editor proxy blocks example welcome info internal and healthcheck endpoints', async () => {
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp() {
      throw new Error('blocked request should not be forwarded');
    }
  });

  for (const pathname of [
    '/example/index.html',
    '/welcome/index.html',
    '/info/info.json',
    '/internal/health',
    '/9.3.1-432bda2685f348ede7efa2a35cafe793/internal/health',
    '/healthcheck'
  ]) {
    const res = createResponse();
    await proxy.handle({
      method: 'GET',
      url: pathname,
      headers: {}
    }, res);
    assert.equal(res.statusCode, 404);
  }
});

test('editor proxy serves a cache file but blocks a bare cache directory request', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp(plan) { forwarded.push(plan); return { statusCode: 200, body: 'ok' }; },
  });

  const okRes = createResponse();
  await proxy.handle({ method: 'GET', url: '/cache/files/doc123/output.png', headers: { host: 'o' } }, okRes);
  assert.equal(okRes.statusCode, 200);

  for (const url of ['/cache/files/', '/cache/files']) {
    const res = createResponse();
    await proxy.handle({ method: 'GET', url, headers: { host: 'o' } }, res);
    assert.equal(res.statusCode, 404);
  }
});

test('editor proxy does not forward cookies authorization or ploinky identity headers', async () => {
  const forwarded = [];
  const proxy = createEditorProxy({
    targetBaseUrl: 'http://127.0.0.1:8080',
    async forwardHttp(plan) {
      forwarded.push(plan);
      return {
        statusCode: 200,
        body: 'proxied'
      };
    }
  });
  const res = createResponse();

  await proxy.handle({
    method: 'GET',
    url: '/web-apps/apps/api/documents/api.js',
      headers: {
        host: 'office.example',
        'x-ploinky-auth-info': 'forged',
        'x-ploinky-user-delegation': 'forged-grant',
        'x-ploinky-random': 'drop-me',
        cookie: 'editor=1',
        authorization: 'Bearer browser-token'
      }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(forwarded, [
    {
      kind: 'http',
      targetUrl: 'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
      headers: {
        host: 'office.example'
      }
    }
  ]);
});
