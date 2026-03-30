import { buildOnlyOfficeEditorConfig, buildPublicOfficeUrl, resolveOnlyOfficeSettings, rewriteOnlyOfficeDownloadUrl } from './onlyoffice-config.mjs';
import { createOnlyOfficeDocumentStore } from './onlyoffice-document-store.mjs';
import { createOnlyOfficeSessionStore } from './onlyoffice-session-store.mjs';
import { parseAuthInfoHeader } from './auth-info.mjs';
import { readWorkspaceSecrets } from './workspace-secrets.mjs';

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function getTokenFromPath(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return '';
  }
  return decodeURIComponent(pathname.slice(prefix.length)).trim();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function createOnlyOfficeHttpHandler({
  fs,
  workspaceRoot,
  validatePath,
  invalidateCachesForPath,
  env = process.env
}) {
  const sessionStore = createOnlyOfficeSessionStore();
  const documentStore = createOnlyOfficeDocumentStore({
    fs,
    workspaceRoot,
    validatePath,
    invalidateCachesForPath
  });

  async function loadRuntimeSettings(req) {
    const secretsEnv = await readWorkspaceSecrets(fs, workspaceRoot);
    return resolveOnlyOfficeSettings({
      ...secretsEnv,
      ...env
    }, req.headers);
  }

  async function handleSessionRequest(req, res) {
    const authInfo = parseAuthInfoHeader(req.headers);
    if (!authInfo) {
      sendJson(res, 401, { ok: false, error: 'Authentication is required for OnlyOffice sessions.' });
      return true;
    }

    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      const requestedPath = String(requestUrl.searchParams.get('path') || '').trim();
      const settings = await loadRuntimeSettings(req);
      const sessionDescriptor = await documentStore.createSessionDescriptor({
        requestedPath,
        authInfo
      });
      const token = sessionStore.createSession({
        ...sessionDescriptor,
        authInfo
      });
      const documentUrl = buildPublicOfficeUrl(settings, `document/${encodeURIComponent(token)}`);
      const callbackUrl = buildPublicOfficeUrl(settings, `callback/${encodeURIComponent(token)}`);
      const config = buildOnlyOfficeEditorConfig({
        session: sessionDescriptor,
        settings,
        authInfo,
        documentUrl,
        callbackUrl
      });

      sendJson(res, 200, {
        ok: true,
        config,
        preview: {
          objectId: sessionDescriptor.objectId || null,
          canWrite: Boolean(sessionDescriptor.canWrite),
          canComment: Boolean(sessionDescriptor.canComment)
        }
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  async function handleDocumentRequest(req, res, token) {
    const session = sessionStore.getSession(token);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'OnlyOffice session not found or expired.' });
      return true;
    }
    try {
      const document = await documentStore.readSessionContent(session);
      const dispositionFileName = encodeURIComponent(document.fileName).replace(/%20/g, '+');
      res.writeHead(200, {
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Length': document.buffer.length,
        'Content-Disposition': `inline; filename*=UTF-8''${dispositionFileName}`,
        'Cache-Control': 'no-store'
      });
      res.end(document.buffer);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  async function handleCallbackRequest(req, res, token) {
    const session = sessionStore.getSession(token);
    if (!session) {
      sendJson(res, 404, { error: 1, message: 'OnlyOffice session not found or expired.' });
      return true;
    }

    try {
      const payload = await readJsonBody(req);
      const status = Number.parseInt(String(payload?.status ?? ''), 10);
      if (![2, 6].includes(status)) {
        sendJson(res, 200, { error: 0 });
        return true;
      }
      if (!session.canWrite) {
        sendJson(res, 200, { error: 1, message: 'Document is read-only.' });
        return true;
      }

      const settings = await loadRuntimeSettings(req);
      const downloadUrl = rewriteOnlyOfficeDownloadUrl(payload?.url, settings);
      if (!downloadUrl) {
        sendJson(res, 200, { error: 0 });
        return true;
      }

      const downloadResponse = await fetch(downloadUrl);
      if (!downloadResponse.ok) {
        throw new Error(`Could not download updated document from OnlyOffice (${downloadResponse.status}).`);
      }
      const buffer = Buffer.from(await downloadResponse.arrayBuffer());
      await documentStore.saveSessionContent(session, buffer);
      sendJson(res, 200, { error: 0 });
    } catch (error) {
      sendJson(res, 200, {
        error: 1,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  return async function handleOnlyOfficeHttpRequest(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    if (req.method === 'GET' && pathname === '/office/session') {
      return handleSessionRequest(req, res);
    }
    if (req.method === 'GET' && pathname.startsWith('/office/document/')) {
      return handleDocumentRequest(req, res, getTokenFromPath(pathname, '/office/document/'));
    }
    if (req.method === 'POST' && pathname.startsWith('/office/callback/')) {
      return handleCallbackRequest(req, res, getTokenFromPath(pathname, '/office/callback/'));
    }
    return false;
  };
}
