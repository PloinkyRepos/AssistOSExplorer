import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { verifyCallerAssertion } from '../../../../ploinky/Agent/lib/wireVerify.mjs';

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

test('secret-store client sends a direct signed tools/call request without MCP session setup', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-store-client-'));
  const privateKeyPath = path.join(tempDir, 'agent.key');
  fs.writeFileSync(privateKeyPath, privatePem, 'utf8');

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

  const wireSignModule = fileURLToPath(new URL('../../../../ploinky/Agent/lib/wireSign.mjs', import.meta.url));
  await withEnv({
    PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
    PLOINKY_AGENT_PRIVATE_KEY_PATH: privateKeyPath,
    PLOINKY_WIRE_SIGN_MODULE: wireSignModule,
    PLOINKY_DPU_ROUTE: 'dpuAgent'
  }, async () => {
    const client = createSecretStoreClient({
      authInfo: {
        invocation: {
          userContextToken: 'user-context-token'
        }
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
  assert.equal(request.headers['x-ploinky-user-context'], 'user-context-token');

  const verified = verifyCallerAssertion(String(request.headers['x-ploinky-caller-assertion'] || ''), {
    resolveCallerPublicKey: () => ({ publicPem }),
    expectedAudience: 'agent:AchillesIDE/dpuAgent',
    bodyObject: { tool: 'secret_put', arguments: { key: 'API_TOKEN', value: 'secret-value' } }
  });
  assert.equal(verified.payload.iss, 'agent:AchillesIDE/gitAgent');
  assert.equal(verified.payload.user_context_token, 'user-context-token');
});

test('secret-store client requires canonical PLOINKY_AGENT_PRINCIPAL', async () => {
  await withEnv({
    PLOINKY_ROUTER_URL: 'http://127.0.0.1:1',
    PLOINKY_AGENT_PRINCIPAL: null,
    AGENT_NAME: 'gitAgent'
  }, async () => {
    assert.throws(
      () => createSecretStoreClient(),
      /PLOINKY_AGENT_PRINCIPAL is required/
    );
  });
});
