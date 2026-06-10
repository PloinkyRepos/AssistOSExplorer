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

function stripOnlyOfficeVersionPrefix(pathname) {
  const match = String(pathname || '').match(/^\/\d+(?:\.\d+){1,3}-[A-Za-z0-9._-]+(?=\/)/);
  if (!match) {
    return pathname;
  }
  return pathname.slice(match[0].length) || '/';
}

function sanitizeHeaders(headers = {}) {
  const blocked = new Set(['authorization', 'cookie', 'proxy-authorization']);
  const sanitized = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = String(name).toLowerCase();
    if (normalizedName.startsWith('x-ploinky-') || blocked.has(normalizedName)) {
      continue;
    }
    sanitized[name] = value;
  }
  return sanitized;
}

function isBlockedPath(pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  return BLOCKED_EXACT_PATHS.has(normalizedPathname) || BLOCKED_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix));
}

function isAllowedHttpPath(pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  if (normalizedPathname === '/web-apps/apps/api/documents/api.js') {
    return true;
  }
  if (/^\/cache\/files\/.+/.test(normalizedPathname)) {
    return true;
  }
  const nonCachePrefixes = ALLOWED_HTTP_PREFIXES.filter((prefix) => prefix !== '/cache/files/');
  return nonCachePrefixes.some((prefix) => normalizedPathname.startsWith(prefix));
}

function isAllowedUpgradeRequest(req, pathname) {
  const normalizedPathname = stripOnlyOfficeVersionPrefix(pathname);
  return req?.method === 'GET' &&
    normalizedPathname.startsWith('/doc/') &&
    String(req?.headers?.upgrade || '').toLowerCase() === 'websocket';
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
  forwardUpgrade
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

    const plan = {
      kind: 'http',
      targetUrl: buildTargetUrl(targetBaseUrl, req.url, 'http'),
      headers: sanitizeHeaders(req.headers)
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

    const plan = {
      kind: 'ws',
      targetUrl: buildTargetUrl(targetBaseUrl, req.url, 'ws'),
      headers: sanitizeHeaders(req.headers)
    };
    await forwardUpgrade(plan, req, socket, head);
  }

  return {
    handle,
    handleUpgrade
  };
}
