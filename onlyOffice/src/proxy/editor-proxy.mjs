import { resolveOnlyOfficeEditorService } from '../edge-topology.mjs';
import { resolveCanonicalEditorBrowserUrl } from '../public-editor-url.mjs';

const BLOCKED_EXACT_PATHS = new Set([
  '/coauthoring/CommandService.ashx',
  '/ConvertService.ashx',
  '/converter',
  '/healthcheck'
]);

const BLOCKED_PREFIXES = [
  '/example/',
  '/welcome/',
  '/info/',
  '/internal/'
];

const ALLOWED_HTTP_PREFIXES = [
  '/web-apps/',
  '/sdkjs/',
  '/sdkjs-plugins/',
  '/fonts/',
  '/themes/',
  '/cache/files/'
];

const ALLOWED_HTTP_EXACT_PATHS = new Set([
  '/document_editor_service_worker.js',
  '/plugins.json',
  '/themes.json'
]);

function stripOnlyOfficeVersionPrefix(pathname) {
  const match = String(pathname || '').match(/^\/\d+(?:\.\d+){1,3}-[A-Za-z0-9._-]+(?=\/)/);
  if (!match) {
    return pathname;
  }
  return pathname.slice(match[0].length) || '/';
}

function sanitizeHeaders(headers = {}) {
  const blocked = new Set([
    'authorization',
    'cookie',
    'forwarded',
    'host',
    'ploinky-agent-assertion',
    'proxy-authorization',
  ]);
  const sanitized = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = String(name).toLowerCase();
    if (
      normalizedName.startsWith('x-ploinky-')
      || normalizedName.startsWith('x-forwarded-')
      || blocked.has(normalizedName)
    ) {
      continue;
    }
    sanitized[name] = value;
  }
  return sanitized;
}

function withCanonicalForwardingHeaders(headers, publicBrowserUrl) {
  const { browserUrl, prefix } = resolveCanonicalEditorBrowserUrl(publicBrowserUrl);
  return {
    ...headers,
    'x-forwarded-host': browserUrl.host,
    'x-forwarded-proto': browserUrl.protocol.replace(/:$/, ''),
    'x-forwarded-prefix': prefix,
  };
}

function requestMatchesCommittedOrigin(req, publicBrowserUrl, { requireOrigin = false } = {}) {
  const { browserUrl: expected } = resolveCanonicalEditorBrowserUrl(publicBrowserUrl);
  const host = String(req?.headers?.host || '').trim().toLowerCase();
  if (host !== expected.host.toLowerCase()) {
    return false;
  }
  const origin = String(req?.headers?.origin || '');
  if (!origin) {
    return !requireOrigin;
  }
  try {
    // Origin is a serialized origin, not an arbitrary URL whose computed
    // origin happens to match. Reject credentials, paths, trailing slashes,
    // and surrounding whitespace before any upstream connection is opened.
    return origin === expected.origin && new URL(origin).origin === expected.origin;
  } catch (_) {
    return false;
  }
}

function isBlockedPath(pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  return BLOCKED_EXACT_PATHS.has(normalizedPathname) || BLOCKED_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix));
}

function isDocumentCollaborationPath(pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  return /^\/doc\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}\/c\/?$/.test(normalizedPathname);
}

function isAllowedHttpPath(pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  if (normalizedPathname === '/web-apps/apps/api/documents/api.js'
      || ALLOWED_HTTP_EXACT_PATHS.has(normalizedPathname)
      || isDocumentCollaborationPath(normalizedPathname)) {
    return true;
  }
  if (/^\/cache\/files\/.+/.test(normalizedPathname)) {
    return true;
  }
  const nonCachePrefixes = ALLOWED_HTTP_PREFIXES.filter((prefix) => prefix !== '/cache/files/');
  return nonCachePrefixes.some((prefix) => normalizedPathname.startsWith(prefix));
}

function isAllowedUpgradeRequest(req, pathname) {
  return req?.method === 'GET' &&
    isDocumentCollaborationPath(pathname) &&
    String(req?.headers?.upgrade || '').toLowerCase() === 'websocket';
}

function rewriteRequestUrlForDocumentServer(requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const normalizedPathname = stripOnlyOfficeVersionPrefix(url.pathname);
  if (normalizedPathname === '/document_editor_service_worker.js') {
    url.pathname = normalizedPathname;
  }
  return `${url.pathname}${url.search}`;
}

function buildTargetUrl(targetBaseUrl, requestUrl, kind) {
  const targetUrl = new URL(requestUrl, targetBaseUrl);
  if (kind !== 'ws') {
    return targetUrl.toString();
  }
  if (targetUrl.protocol === 'https:') {
    targetUrl.protocol = 'wss:';
  } else if (targetUrl.protocol === 'http:') {
    targetUrl.protocol = 'ws:';
  }
  return targetUrl.toString();
}

function sendNotFound(res) {
  res.statusCode = 404;
  res.end('Not found.');
}

export function createEditorProxy({
  targetBaseUrl,
  forwardHttp,
  forwardUpgrade,
  resolveEditorService = resolveOnlyOfficeEditorService,
} = {}) {
  if (!targetBaseUrl) {
    throw new Error('Editor proxy requires targetBaseUrl.');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || isBlockedPath(url.pathname) || !isAllowedHttpPath(url.pathname)) {
      sendNotFound(res);
      return;
    }
    const editorService = await resolveEditorService({ req });
    if (!requestMatchesCommittedOrigin(req, editorService.activeBrowserUrl)) {
      sendNotFound(res);
      return;
    }

    const plan = {
      kind: 'http',
      targetUrl: buildTargetUrl(targetBaseUrl, rewriteRequestUrlForDocumentServer(req.url), 'http'),
      headers: withCanonicalForwardingHeaders(sanitizeHeaders(req.headers), editorService.activeBrowserUrl)
    };

    if (typeof forwardHttp !== 'function') {
      res.statusCode = 502;
      res.end('Proxy forwarder is not configured.');
      return;
    }

    const result = await forwardHttp(plan, req, res);
    if (!res.finished && result) {
      res.statusCode = result.statusCode || 200;
      if (result.headers) {
        for (const [name, value] of Object.entries(result.headers)) {
          res.setHeader(name, value);
        }
      }
      res.end(result.body || '');
    }
  }

  async function handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (isBlockedPath(url.pathname) || !isAllowedUpgradeRequest(req, url.pathname) || typeof forwardUpgrade !== 'function') {
      socket.destroy();
      return;
    }
    const editorService = await resolveEditorService({ req });
    if (!requestMatchesCommittedOrigin(req, editorService.activeBrowserUrl, { requireOrigin: true })) {
      socket.destroy();
      return;
    }

    const plan = {
      kind: 'ws',
      targetUrl: buildTargetUrl(targetBaseUrl, req.url, 'ws'),
      headers: withCanonicalForwardingHeaders(sanitizeHeaders(req.headers), editorService.activeBrowserUrl)
    };
    await forwardUpgrade(plan, req, socket, head);
  }

  return {
    handle,
    handleUpgrade
  };
}
