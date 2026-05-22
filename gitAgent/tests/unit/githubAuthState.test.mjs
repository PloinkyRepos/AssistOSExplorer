import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const moduleUrl = new URL('../../lib/github-auth.mjs', import.meta.url);
const moduleSuffix = `?test=${Date.now()}`;
const {
  getGithubAuthStateFilePath,
  storeManualGitAuthToken
} = await import(`${moduleUrl.href}${moduleSuffix}`);

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

function createDpuStubServer(requests) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      requests.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body?.id || null,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true })
            }
          ]
        }
      }));
    });
  });
}

test('manual GitHub token state is isolated by routed workspace user', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'git-auth-state-'));
  const requests = [];
  const server = createDpuStubServer(requests);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const adminAuth = {
    invocationToken: 'admin-invocation',
    user: { id: 'local:admin', username: 'admin' }
  };
  const nicoletaAuth = {
    invocationToken: 'nicoleta-invocation',
    user: { id: 'local:nicoleta', username: 'nicoleta' }
  };
  const adminStatePath = getGithubAuthStateFilePath(workspaceRoot, adminAuth);
  const nicoletaStatePath = getGithubAuthStateFilePath(workspaceRoot, nicoletaAuth);

  await withEnv({
    PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
    PLOINKY_DPU_ROUTE: 'dpuAgent'
  }, async () => {
    await storeManualGitAuthToken({ workspaceRoot, authInfo: adminAuth, token: 'ghp_admin' });
    await storeManualGitAuthToken({ workspaceRoot, authInfo: nicoletaAuth, token: 'ghp_nicoleta' });
  });

  server.close();

  assert.notEqual(adminStatePath, nicoletaStatePath);
  const adminState = JSON.parse(await fs.readFile(adminStatePath, 'utf8'));
  const nicoletaState = JSON.parse(await fs.readFile(nicoletaStatePath, 'utf8'));
  assert.equal(adminState.connection.source, 'token');
  assert.equal(nicoletaState.connection.source, 'token');
  assert.equal(adminState.connection.accessToken, '');
  assert.equal(nicoletaState.connection.accessToken, '');
  assert.equal(requests.filter((body) => body?.params?.name === 'dpu_secret_put').length, 2);
});
