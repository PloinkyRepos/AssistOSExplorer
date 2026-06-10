const SAVE_STATUSES = new Set([2, 6]);

function isLoopbackAddress(address) {
  const normalized = String(address || '').trim();
  return normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1';
}

function send(res, statusCode, body, headers = {}) {
  res.statusCode = statusCode;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), {
    'content-type': 'application/json'
  });
}

function getTokenFromPath(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return '';
  }
  const token = pathname.slice(prefix.length).split('/')[0];
  return decodeURIComponent(token || '');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function resolveTrustedDownloadUrl(rawUrl, {
  publicEditorBaseUrl,
  internalDocumentServerBaseUrl
} = {}) {
  if (!rawUrl) {
    throw new Error('OnlyOffice callback did not include a download URL.');
  }
  if (!publicEditorBaseUrl || !internalDocumentServerBaseUrl) {
    throw new Error('OnlyOffice callback URL configuration is required.');
  }

  const downloadUrl = new URL(rawUrl);
  const publicBase = new URL(publicEditorBaseUrl);
  const internalBase = new URL(internalDocumentServerBaseUrl);
  if (downloadUrl.origin !== publicBase.origin && downloadUrl.origin !== internalBase.origin) {
    throw new Error('OnlyOffice callback download URL origin is not trusted.');
  }
  if (downloadUrl.origin === internalBase.origin || publicBase.origin === internalBase.origin) {
    return downloadUrl.toString();
  }

  downloadUrl.protocol = internalBase.protocol;
  downloadUrl.username = internalBase.username;
  downloadUrl.password = internalBase.password;
  downloadUrl.hostname = internalBase.hostname;
  downloadUrl.port = internalBase.port;
  return downloadUrl.toString();
}

function resolveSessionFromToken(sessionStore, token) {
  return sessionStore.getForStorageRequest(token);
}

export function createStorageRouteHandler({
  config = {},
  sessionStore,
  storageRouter,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sessionStore || !storageRouter) {
    throw new Error('Storage routes require sessionStore and storageRouter.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Storage routes require fetchImpl.');
  }

  return async function handleStorageRoute(req, res) {
    if (!isLoopbackAddress(req?.socket?.remoteAddress)) {
      send(res, 403, 'Loopback access only.');
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const documentToken = getTokenFromPath(url.pathname, '/internal/document/');
    const callbackToken = getTokenFromPath(url.pathname, '/internal/callback/');
    const isDocumentRoute = req.method === 'GET' && Boolean(documentToken);
    const isCallbackRoute = req.method === 'POST' && Boolean(callbackToken);

    if (!isDocumentRoute && !isCallbackRoute) {
      send(res, 404, 'Not found.');
      return;
    }

    let session;
    try {
      session = resolveSessionFromToken(sessionStore, documentToken || callbackToken);
    } catch (error) {
      if (String(error?.message || '').includes('Unknown or expired OnlyOffice session token.')) {
        send(res, 404, 'OnlyOffice session not found.');
        return;
      }
      throw error;
    }

    const backend = storageRouter.forSession(session);

    if (isDocumentRoute) {
      const document = await backend.read();
      send(res, 200, document.buffer, {
        'content-type': document.mimeType || 'application/octet-stream'
      });
      return;
    }

    const payloadText = await readBody(req);
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!SAVE_STATUSES.has(Number(payload?.status))) {
      sendJson(res, 200, { error: 0 });
      return;
    }

    if (!session.canWrite) {
      sendJson(res, 403, { error: 1 });
      return;
    }

    let downloadUrl;
    try {
      downloadUrl = resolveTrustedDownloadUrl(payload?.url, config);
    } catch (_) {
      sendJson(res, 400, { error: 1 });
      return;
    }

    const downloadResponse = await fetchImpl(downloadUrl);
    if (!downloadResponse?.ok) {
      sendJson(res, 502, { error: 1 });
      return;
    }

    const bytes = Buffer.from(await downloadResponse.arrayBuffer());
    await backend.write(bytes);
    sendJson(res, 200, { error: 0 });
  };
}
