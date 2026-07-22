import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createStorageRouteHandler as createStorageRouteHandlerRaw } from '../src/routes/storage.mjs';
import { buildDocumentKey } from '../src/onlyoffice-config.mjs';

const CALLBACK_SECRET = 'onlyoffice-callback-test-secret';
const DEFAULT_SESSION_IDENTITY = Object.freeze({
  storageKind: 'workspace',
  storageId: '/workspace/report.docx',
  versionKey: 'report-v1',
  fileName: 'report.docx',
  documentKey: 'a'.repeat(32),
});
const DEFAULT_DOCUMENT_KEY = buildDocumentKey(DEFAULT_SESSION_IDENTITY);

function signCallbackPayload(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    key: DEFAULT_DOCUMENT_KEY,
    ...payload,
    iat: nowSeconds,
    nbf: nowSeconds - 1,
    exp: nowSeconds + 60,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', CALLBACK_SECRET)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return JSON.stringify({ token: `${header}.${claims}.${signature}` });
}

function createStorageRouteHandler(options = {}) {
  return createStorageRouteHandlerRaw({
    ...options,
    config: {
      onlyofficeJwtSecret: CALLBACK_SECRET,
      ...options.config,
    },
    resolveEditorService: options.resolveEditorService || (async () => ({
      activeBrowserUrl: 'http://public-onlyoffice:8080/public-services/onlyoffice-editor/',
    })),
  });
}

function createMockRequest({
  method = 'GET',
  url = '/',
  headers = {},
  body = '',
  remoteAddress = '127.0.0.1'
} = {}) {
  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;
  request.socket = { remoteAddress };
  return request;
}

function createMockResponse() {
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
    writeHead(statusCode, nextHeaders = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(nextHeaders)) {
        this.setHeader(name, value);
      }
    },
    write(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      if (chunk) {
        this.write(chunk);
      }
      this.finished = true;
    },
    get bodyBuffer() {
      return Buffer.concat(chunks);
    },
    get bodyText() {
      return this.bodyBuffer.toString('utf8');
    }
  };
}

function createSessionStore(session) {
  const boundSession = {
    ...DEFAULT_SESSION_IDENTITY,
    ...session,
  };
  return {
    getForStorageRequest(token) {
      if (token !== 'token-1') {
        throw new Error('Unknown or expired OnlyOffice session token.');
      }
      return boundSession;
    }
  };
}

function createDownloadResponse(body = 'saved from callback', contentType = 'application/octet-stream') {
  return {
    ok: true,
    status: 200,
    redirected: false,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async arrayBuffer() {
      return Buffer.from(body);
    },
  };
}

test('document route streams bytes for a valid unexpired token', async () => {
  const writes = [];
  const handler = createStorageRouteHandler({
    config: {},
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain'
    }),
    storageRouter: {
      forSession(session) {
        return {
          async metadata() {
            return session;
          },
          async read() {
            return {
              buffer: Buffer.from('document body'),
              mimeType: 'text/plain',
              fileName: 'report.docx'
            };
          },
          async write(buffer) {
            writes.push(buffer);
          }
        };
      }
    }
  });

  const req = createMockRequest({
    method: 'GET',
    url: '/internal/document/token-1'
  });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'text/plain');
  assert.equal(res.bodyText, 'document body');
  assert.equal(writes.length, 0);
});

test('document route rejects expired and unknown tokens', async () => {
  const handler = createStorageRouteHandler({
    config: {},
    sessionStore: {
      getForStorageRequest() {
        throw new Error('Unknown or expired OnlyOffice session token.');
      }
    },
    storageRouter: {
      forSession() {
        throw new Error('should not be called');
      }
    }
  });

  const expiredReq = createMockRequest({
    method: 'GET',
    url: '/internal/document/token-1'
  });
  const expiredRes = createMockResponse();
  await handler(expiredReq, expiredRes);

  const unknownReq = createMockRequest({
    method: 'GET',
    url: '/internal/document/token-2'
  });
  const unknownRes = createMockResponse();
  await handler(unknownReq, unknownRes);

  assert.equal(expiredRes.statusCode, 404);
  assert.equal(unknownRes.statusCode, 404);
});

test('callback route persists only status 2 and status 6 save events', async () => {
  const fetchUrls = [];
  const savedBodies = [];
  const handler = createStorageRouteHandler({
    config: {
      publicEditorBaseUrl: 'http://public-onlyoffice:8080',
      internalDocumentServerBaseUrl: 'http://127.0.0.1:80'
    },
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain',
      canWrite: true
    }),
    storageRouter: {
      forSession() {
        return {
          async metadata() {
            return {};
          },
          async read() {
            return {
              buffer: Buffer.alloc(0)
            };
          },
          async write(buffer) {
            savedBodies.push(buffer.toString('utf8'));
          }
        };
      }
    },
    fetchImpl: async (url) => {
      fetchUrls.push(url);
      return createDownloadResponse();
    }
  });

  for (const status of [1, 2, 6]) {
    const req = createMockRequest({
      method: 'POST',
      url: '/internal/callback/token-1',
      headers: {
        'content-type': 'application/json'
      },
      body: signCallbackPayload({
        status,
        url: 'http://public-onlyoffice:8080/cache/files/report.docx'
      })
    });
    const res = createMockResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.bodyText, '{"error":0}');
  }

  assert.deepEqual(fetchUrls, [
    'http://127.0.0.1/cache/files/report.docx',
    'http://127.0.0.1/cache/files/report.docx'
  ]);
  assert.deepEqual(savedBodies, [
    'saved from callback',
    'saved from callback'
  ]);
});

test('callback route rewrites public download url to internal download url before fetching', async () => {
  const fetchUrls = [];
  const handler = createStorageRouteHandler({
    config: {
      publicEditorBaseUrl: 'http://public-onlyoffice:8080',
      internalDocumentServerBaseUrl: 'http://127.0.0.1:80'
    },
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain',
      canWrite: true
    }),
    storageRouter: {
      forSession() {
        return {
          async metadata() {
            return {};
          },
          async read() {
            return {
              buffer: Buffer.alloc(0)
            };
          },
          async write() {}
        };
      }
    },
    fetchImpl: async (url) => {
      fetchUrls.push(url);
      return createDownloadResponse();
    }
  });

  const req = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: {
      'content-type': 'application/json'
    },
    body: signCallbackPayload({
      status: 2,
      url: 'http://public-onlyoffice:8080/cache/files/report.docx?download=1'
    })
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(fetchUrls.length, 1);
  const rewrittenUrl = new URL(fetchUrls[0]);
  assert.equal(rewrittenUrl.origin, 'http://127.0.0.1');
  assert.equal(`${rewrittenUrl.pathname}${rewrittenUrl.search}`, '/cache/files/report.docx?download=1');
});

test('callback route rejects an outbox JWT from another session for the same document before fetch or write', async () => {
  let fetchCalled = false;
  let writeCalled = false;
  const targetSession = {
    ...DEFAULT_SESSION_IDENTITY,
    documentKey: 'b'.repeat(32),
    canWrite: true,
  };
  const handler = createStorageRouteHandler({
    config: { internalDocumentServerBaseUrl: 'http://127.0.0.1:80' },
    sessionStore: createSessionStore(targetSession),
    storageRouter: {
      forSession() {
        return {
          async write() {
            writeCalled = true;
          },
        };
      },
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return createDownloadResponse();
    },
  });
  const req = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: { 'content-type': 'application/json' },
    body: signCallbackPayload({
      key: DEFAULT_DOCUMENT_KEY,
      status: 2,
      url: 'http://public-onlyoffice:8080/cache/files/report.docx',
    }),
  });
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.bodyText, '{"error":1}');
  assert.equal(fetchCalled, false);
  assert.equal(writeCalled, false);
  assert.notEqual(DEFAULT_DOCUMENT_KEY, buildDocumentKey(targetSession));
  assert.equal(targetSession.storageId, DEFAULT_SESSION_IDENTITY.storageId);
  assert.equal(targetSession.versionKey, DEFAULT_SESSION_IDENTITY.versionKey);
  assert.equal(targetSession.fileName, DEFAULT_SESSION_IDENTITY.fileName);
});

test('callback route rejects read-only sessions before fetching save payload', async () => {
  let fetchCalled = false;
  const handler = createStorageRouteHandler({
    config: {
      publicEditorBaseUrl: 'http://public-onlyoffice:8080',
      internalDocumentServerBaseUrl: 'http://127.0.0.1:80'
    },
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain',
      canWrite: false
    }),
    storageRouter: {
      forSession() {
        return {
          async read() {
            return { buffer: Buffer.alloc(0) };
          },
          async write() {
            throw new Error('write should not be reached');
          }
        };
      }
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.from('saved from callback');
        }
      };
    }
  });

  const req = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: {
      'content-type': 'application/json'
    },
    body: signCallbackPayload({
      status: 2,
      url: 'http://public-onlyoffice:8080/cache/files/report.docx'
    })
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(fetchCalled, false);
});

test('callback route rejects save download urls from untrusted origins', async () => {
  let fetchCalled = false;
  const handler = createStorageRouteHandler({
    config: {
      publicEditorBaseUrl: 'http://public-onlyoffice:8080',
      internalDocumentServerBaseUrl: 'http://127.0.0.1:80'
    },
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain',
      canWrite: true
    }),
    storageRouter: {
      forSession() {
        return {
          async read() {
            return { buffer: Buffer.alloc(0) };
          },
          async write() {
            throw new Error('write should not be reached');
          }
        };
      }
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.from('saved from callback');
        }
      };
    }
  });

  const req = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: {
      'content-type': 'application/json'
    },
    body: signCallbackPayload({
      status: 2,
      url: 'http://evil.example/cache/files/report.docx'
    })
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(fetchCalled, false);
});

test('callback route rejects non-cache DocumentServer paths and unsafe response types', async () => {
  let fetchCalls = 0;
  let writes = 0;
  const handler = createStorageRouteHandler({
    config: {
      internalDocumentServerBaseUrl: 'http://127.0.0.1:80',
    },
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      canWrite: true,
    }),
    storageRouter: {
      forSession() {
        return {
          async write() {
            writes += 1;
          },
        };
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return createDownloadResponse('<html>not a document</html>', 'text/html');
    },
  });

  const disallowedPath = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: { 'content-type': 'application/json' },
    body: signCallbackPayload({
      status: 2,
      url: 'http://public-onlyoffice:8080/coauthoring/CommandService.ashx',
    }),
  });
  const disallowedPathResponse = createMockResponse();
  await handler(disallowedPath, disallowedPathResponse);
  assert.equal(disallowedPathResponse.statusCode, 400);
  assert.equal(fetchCalls, 0);

  const unsafeContent = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    headers: { 'content-type': 'application/json' },
    body: signCallbackPayload({
      status: 2,
      url: 'http://public-onlyoffice:8080/cache/files/report.docx',
    }),
  });
  const unsafeContentResponse = createMockResponse();
  await handler(unsafeContent, unsafeContentResponse);
  assert.equal(unsafeContentResponse.statusCode, 502);
  assert.equal(fetchCalls, 1);
  assert.equal(writes, 0);
});

test('document route bounds source bytes and source-read duration', async () => {
  const oversizedHandler = createStorageRouteHandler({
    config: { downloadMaxBytes: 4 },
    sessionStore: createSessionStore({ requestedPath: '/workspace/report.docx' }),
    storageRouter: {
      forSession() {
        return { async read() { return { buffer: Buffer.from('12345') }; } };
      },
    },
  });
  const oversizedResponse = createMockResponse();
  await oversizedHandler(createMockRequest({ url: '/internal/document/token-1' }), oversizedResponse);
  assert.equal(oversizedResponse.statusCode, 413);

  const slowHandler = createStorageRouteHandler({
    config: { ioTimeoutMs: 10 },
    sessionStore: createSessionStore({ requestedPath: '/workspace/report.docx' }),
    storageRouter: {
      forSession() {
        return { async read() { return new Promise(() => {}); } };
      },
    },
  });
  const slowResponse = createMockResponse();
  await slowHandler(createMockRequest({ url: '/internal/document/token-1' }), slowResponse);
  assert.equal(slowResponse.statusCode, 504);
});

test('callback route rejects non-loopback peers', async () => {
  const handler = createStorageRouteHandler({
    config: {},
    sessionStore: createSessionStore({
      requestedPath: '/workspace/report.docx',
      mimeType: 'text/plain'
    }),
    storageRouter: {
      forSession() {
        return {
          async metadata() {
            return {};
          },
          async read() {
            return {
              buffer: Buffer.from('document body')
            };
          },
          async write() {}
        };
      }
    }
  });

  const req = createMockRequest({
    method: 'GET',
    url: '/internal/document/token-1',
    remoteAddress: '10.20.30.40'
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
});

test('callback route never accepts x-ploinky-auth-info as storage authorization', async () => {
  let fetchCalled = false;
  let writeCalled = false;
  const handler = createStorageRouteHandler({
    config: {},
    sessionStore: {
      getForStorageRequest() {
        throw new Error('Unknown or expired OnlyOffice session token.');
      }
    },
    storageRouter: {
      forSession() {
        writeCalled = true;
        return {
          async metadata() {
            return {};
          },
          async read() {
            return {
              buffer: Buffer.alloc(0)
            };
          },
          async write() {
            writeCalled = true;
          }
        };
      }
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.alloc(0);
        }
      };
    }
  });

  const req = createMockRequest({
    method: 'POST',
    url: '/internal/callback/token-1',
    remoteAddress: '127.0.0.1',
    headers: {
      'content-type': 'application/json',
      'x-ploinky-auth-info': 'forged'
    },
    body: JSON.stringify({
      status: 2,
      url: 'http://public-onlyoffice:8080/cache/files/report.docx'
    })
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(fetchCalled, false);
  assert.equal(writeCalled, false);
});
