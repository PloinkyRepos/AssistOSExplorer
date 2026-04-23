import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const moduleUrl = new URL('../../lib/secret-store-client.mjs', import.meta.url);
const moduleSuffix = `?test=${Date.now()}`;
const { createSecretStoreClient } = await import(`${moduleUrl.href}${moduleSuffix}`);

function withEnv(env, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('secret-store client forwards the invocation JWT as caller JWT without MCP session setup', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: requests.at(-1)?.body?.id || null,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, stored: true })
            }
          ]
        }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const invocationToken = 'router-issued-invocation-jwt';
  await withEnv({
    PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
    PLOINKY_DPU_ROUTE: 'dpuAgent'
  }, async () => {
    const client = createSecretStoreClient({
      authInfo: {
        invocationToken
      }
    });

    const result = await client.put('API_TOKEN', 'secret-value');
    assert.deepEqual(result, { ok: true, stored: true });
  });

  server.close();

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.body.method, 'tools/call');
  assert.equal(request.body.params?.name, 'secret_put');
  assert.deepEqual(request.body.params?.arguments, { key: 'API_TOKEN', value: 'secret-value' });
  assert.equal(typeof request.headers['mcp-session-id'], 'undefined');
  assert.equal(request.headers['x-ploinky-caller-jwt'], invocationToken);
  assert.equal(typeof request.headers['x-ploinky-user-context'], 'undefined');
  assert.equal(typeof request.headers['x-ploinky-caller-assertion'], 'undefined');
});

test('secret-store client requires an invocation token for delegated calls', async () => {
  await withEnv({
    PLOINKY_ROUTER_URL: 'http://127.0.0.1:1',
    PLOINKY_AGENT_PRINCIPAL: null,
    AGENT_NAME: 'gitAgent'
  }, async () => {
    const client = createSecretStoreClient();
    await assert.rejects(
      () => client.get('API_TOKEN'),
      /missing invocation token/
    );
  });
});
