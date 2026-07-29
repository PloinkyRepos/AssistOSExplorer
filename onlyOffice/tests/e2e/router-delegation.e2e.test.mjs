import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import test from 'node:test';

const e2eEnabled = process.env.ONLYOFFICE_E2E === '1';
const skipMessage = 'Requires ONLYOFFICE_E2E=1 with a live Ploinky runtime profile (router + explorer + onlyOffice + dpuAgent + OnlyOffice Document Server).';

function runtimeTest(name, fn) {
  if (!e2eEnabled) {
    test.skip(name, skipMessage);
    return;
  }
  test(name, fn);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required when ONLYOFFICE_E2E=1.`);
  }
  return value;
}

function editorUrl(path) {
  const baseUrl = new URL(requiredEnv('ONLYOFFICE_E2E_EDITOR_BASE_URL'));
  const prefix = baseUrl.pathname.replace(/\/+$/, '');
  const suffix = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  baseUrl.pathname = `${prefix}${suffix}`;
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl.toString();
}

function routerServiceUrl(path) {
  const routerBaseUrl = requiredEnv('ONLYOFFICE_E2E_ROUTER_BASE_URL');
  const servicePrefix = String(process.env.ONLYOFFICE_E2E_SERVICE_PREFIX || '/base-agent-additional-server/onlyOffice/7000/control').replace(/\/+$/, '');
  return new URL(`${servicePrefix}${path}`, routerBaseUrl).toString();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

function openSocket(url) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (url.protocol === 'https:') {
    return tls.connect({ host: url.hostname, port, servername: url.hostname });
  }
  return net.connect({ host: url.hostname, port });
}

async function probeUpgrade(baseUrl, path) {
  const url = new URL(editorUrl(path));
  const origin = new URL(baseUrl).origin;
  return new Promise((resolve, reject) => {
    const socket = openSocket(url);
    let data = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out waiting for upgrade response from ${url}`));
    }, 5000);

    socket.on('connect', () => {
      socket.write([
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${url.host}`,
        `Origin: ${origin}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.includes('\r\n')) {
        clearTimeout(timeout);
        socket.destroy();
        const status = Number(data.match(/^HTTP\/1\.[01]\s+(\d+)/)?.[1] || 0);
        resolve(status);
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on('close', () => clearTimeout(timeout));
  });
}

runtimeTest('internet cannot reach internal document route through office host', async () => {
  const { response, text } = await fetchText(editorUrl('/internal/document/not-a-real-token'));

  assert.ok([403, 404].includes(response.status), `expected internal route to be blocked, got ${response.status}: ${text}`);
});

runtimeTest('router service prefix does not re-expose internal document route', async () => {
  const { response, text } = await fetchText(routerServiceUrl('/internal/document/not-a-real-token'));

  assert.ok([401, 403, 404].includes(response.status), `expected internal route to be blocked, got ${response.status}: ${text}`);
});

runtimeTest('public editor host serves api js and websocket path while blocking admin endpoints', async () => {
  const api = await fetchText(editorUrl('/web-apps/apps/api/documents/api.js'));
  assert.equal(api.response.status, 200, api.text);
  assert.match(api.text, /DocsAPI|Asc/i);

  for (const path of ['/coauthoring/CommandService.ashx', '/ConvertService.ashx', '/converter', '/internal/document/not-a-real-token']) {
    const blocked = await fetchText(editorUrl(path));
    assert.ok([403, 404].includes(blocked.response.status), `${path} returned ${blocked.response.status}: ${blocked.text}`);
  }

  const websocketPath = String(process.env.ONLYOFFICE_E2E_WEBSOCKET_PATH || '/doc/e2e/c/?shardkey=e2e');
  const upgradeStatus = await probeUpgrade(requiredEnv('ONLYOFFICE_E2E_EDITOR_BASE_URL'), websocketPath);
  assert.equal(upgradeStatus, 101, `websocket path did not complete a real upgrade: ${upgradeStatus}`);
});

runtimeTest('localhost Router authority serves the OnlyOffice API asset', async () => {
  const editorBaseUrl = new URL(requiredEnv('ONLYOFFICE_E2E_EDITOR_BASE_URL'));
  assert.equal(
    editorBaseUrl.hostname,
    'localhost',
    `localhost regression gate requires a localhost editor URL, got ${editorBaseUrl.origin}`,
  );

  const api = await fetchText(editorUrl('/web-apps/apps/api/documents/api.js'), {
    headers: { origin: editorBaseUrl.origin },
  });
  assert.equal(api.response.status, 200, api.text);
  assert.match(api.text, /DocsAPI|Asc/i);
});
