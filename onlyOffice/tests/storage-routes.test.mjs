import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createStorageRouteHandler } from '../src/routes/storage.mjs';

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
  return {
    getForStorageRequest(token) {
      if (token !== 'token-1') {
        throw new Error('Unknown or expired OnlyOffice session token.');
      }
      return session;
    }
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
      internalDocumentServerBaseUrl: 'http://public-onlyoffice:8080'
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
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.from('saved from callback');
        }
      };
    }
  });

  for (const status of [1, 2, 6]) {
    const req = createMockRequest({
      method: 'POST',
      url: '/internal/callback/token-1',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
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
    'http://public-onlyoffice:8080/cache/files/report.docx',
    'http://public-onlyoffice:8080/cache/files/report.docx'
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
    body: JSON.stringify({
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
    body: JSON.stringify({
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
    body: JSON.stringify({
      status: 2,
      url: 'http://evil.example/cache/files/report.docx'
    })
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(fetchCalled, false);
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
