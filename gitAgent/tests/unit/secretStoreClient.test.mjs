import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { withGitAgentRuntime as withEnv } from '../helpers/generatedRouterRuntime.mjs';

const agentLibDir = path.resolve(new URL('../../../../ploinky/Agent', import.meta.url).pathname);

const moduleUrl = new URL('../../lib/secret-store-client.mjs', import.meta.url);
const moduleSuffix = `?test=${Date.now()}`;
const {
  GIT_GITHUB_TOKEN_SECRET_KEY,
  createSecretStoreClient,
  putStoredGitToken,
  getStoredGitToken,
  deleteStoredGitToken,
  grantStoredGitTokenAccess,
  resolveGitAuthPrincipal,
  resolveGitTokenSecretKey
} = await import(`${moduleUrl.href}${moduleSuffix}`);
const { authInfoFromInvocation } = await import(new URL('../../../../ploinky/Agent/lib/invocation-auth.mjs', import.meta.url).href);

test('secret-store client calls DPU with an agent assertion and internal secret tool', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
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
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  await withEnv({
    PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLOINKY_ROUTER_AUTHORITY: '127.0.0.1:19090',
    PLOINKY_AGENT_ID: 'agent:AchillesIDE/gitAgent',
    PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
    PLOINKY_AGENT_SECRET: 'a'.repeat(64),
    PLOINKY_AGENT_LIB_DIR: agentLibDir,
    PLOINKY_DPU_ROUTE: 'dpuAgent'
  }, async () => {
    const client = createSecretStoreClient({
      authInfo: {
        invocationToken: 'router-issued-invocation-jwt'
      }
    });

    const result = await client.put('API_TOKEN', 'secret-value');
    assert.deepEqual(result, { ok: true, stored: true });
  });

  server.close();

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/dpuAgent/mcp');
  assert.equal(request.headers.host, '127.0.0.1:19090');
  assert.equal(request.body.method, 'tools/call');
  assert.equal(request.body.params?.name, 'dpu_secret_put');
  assert.deepEqual(request.body.params?.arguments, { key: 'API_TOKEN', value: 'secret-value' });
  assert.equal(typeof request.headers['mcp-session-id'], 'undefined');
  assert.match(String(request.headers.authorization || ''), /^Bearer\s+\S+\.\S+\.\S+$/);
  assert.equal(typeof request.headers['x-ploinky-caller-jwt'], 'undefined');
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

test('GitHub token keys are scoped by routed workspace user identity', () => {
  const adminAuth = {
    user: {
      id: 'local:admin',
      username: 'admin',
      email: 'admin@example.com'
    }
  };
  const otherAuth = {
    user: {
      id: 'local:nicoleta',
      username: 'nicoleta',
      email: 'nicoleta@example.com'
    }
  };

  assert.equal(resolveGitAuthPrincipal(adminAuth), 'user:local:admin');
  const adminKey = resolveGitTokenSecretKey({ authInfo: adminAuth });
  const otherKey = resolveGitTokenSecretKey({ authInfo: otherAuth });

  assert.match(adminKey, /^GIT_GITHUB_TOKEN_[A-F0-9]{16}$/);
  assert.notEqual(adminKey, GIT_GITHUB_TOKEN_SECRET_KEY);
  assert.notEqual(adminKey, otherKey);
});

test('GitHub token keys stay scoped when router grants only carry sub and actor', () => {
  const authInfo = authInfoFromInvocation({
    sub: 'user:local:admin',
    actor: {
      kind: 'user',
      id: 'user:local:admin',
      roles: ['admin']
    },
    scope: ['git_auth_status'],
    tool: 'git_auth_status',
    workspace_id: 'testExplorerFresh'
  }, {
    invocationToken: 'router-issued-invocation-jwt'
  });

  assert.equal(resolveGitAuthPrincipal(authInfo), 'user:local:admin');
  assert.match(resolveGitTokenSecretKey({ authInfo }), /^GIT_GITHUB_TOKEN_[A-F0-9]{16}$/);
});

test('putStoredGitToken writes and grants the user-scoped GitHub token key', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      });
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const invocationToken = 'router-issued-invocation-jwt';
  const authInfo = {
    invocationToken,
    user: {
      id: 'local:admin',
      username: 'admin'
    },
    delegations: {
      dpuGitSecrets: {
        token: 'user-delegation-jwt',
        targetAgentId: 'agent:AchillesIDE/dpuAgent',
        tools: ['dpu_secret_put', 'dpu_secret_grant'],
        scope: ['secret:write', 'secret:grant']
      }
    }
  };
  const expectedKey = resolveGitTokenSecretKey({ authInfo });

  await withEnv({
    PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLOINKY_AGENT_ID: 'agent:AchillesIDE/gitAgent',
    PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
    PLOINKY_AGENT_SECRET: 'a'.repeat(64),
    PLOINKY_AGENT_LIB_DIR: agentLibDir,
    PLOINKY_DPU_ROUTE: 'dpuAgent'
  }, async () => {
    await putStoredGitToken({ authInfo, token: 'ghp_test' });
  });

  server.close();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/dpuAgent/mcp');
  assert.equal(requests[1].url, '/dpuAgent/mcp');
  assert.equal(requests[0].body.params?.name, 'dpu_secret_put');
  assert.equal(requests[0].headers['x-ploinky-user-delegation'], 'user-delegation-jwt');
  assert.deepEqual(requests[0].body.params?.arguments, { key: expectedKey, value: 'ghp_test' });
  assert.equal(requests[1].body.params?.name, 'dpu_secret_grant');
  assert.equal(requests[1].headers['x-ploinky-user-delegation'], 'user-delegation-jwt');
  assert.deepEqual(requests[1].body.params?.arguments, {
    key: expectedKey,
    principal: 'agent:AchillesIDE/gitAgent',
    role: 'read'
  });
});

const DELEGATED_AUTH = Object.freeze({
  invocationToken: 'router-issued-invocation-jwt',
  user: { id: 'local:admin', username: 'admin' },
  delegations: {
    dpuGitSecrets: {
      token: 'user-delegation-jwt',
      targetAgentId: 'agent:AchillesIDE/dpuAgent',
      tools: ['dpu_secret_get', 'dpu_secret_put', 'dpu_secret_delete', 'dpu_secret_grant'],
      scope: ['secret:read', 'secret:write', 'secret:grant']
    }
  }
});

const UNDELEGATED_USER_AUTH = Object.freeze({
  invocationToken: 'router-issued-invocation-jwt',
  user: { id: 'local:admin', username: 'admin' }
});

const GUEST_AUTH = Object.freeze({
  invocationToken: 'router-issued-invocation-jwt',
  user: { id: 'guest-7', username: 'guest', roles: ['guest'] }
});

const GIT_AGENT_ENV = Object.freeze({
  PLOINKY_AGENT_ID: 'agent:AchillesIDE/gitAgent',
  PLOINKY_AGENT_PRINCIPAL: 'agent:AchillesIDE/gitAgent',
  PLOINKY_AGENT_SECRET: 'a'.repeat(64),
  PLOINKY_AGENT_LIB_DIR: agentLibDir,
  PLOINKY_DPU_ROUTE: 'dpuAgent'
});

test('GitHub token helpers fail closed for user callers without a DPU delegation', async () => {
  await withEnv({ ...GIT_AGENT_ENV, PLOINKY_ROUTER_URL: 'http://127.0.0.1:1' }, async () => {
    await assert.rejects(() => putStoredGitToken({ authInfo: UNDELEGATED_USER_AUTH, token: 'ghp_test' }), /missing DPU user delegation/);
    await assert.rejects(() => getStoredGitToken({ authInfo: UNDELEGATED_USER_AUTH }), /missing DPU user delegation/);
    await assert.rejects(() => deleteStoredGitToken({ authInfo: UNDELEGATED_USER_AUTH }), /missing DPU user delegation/);
    await assert.rejects(() => grantStoredGitTokenAccess({ authInfo: UNDELEGATED_USER_AUTH }), /missing DPU user delegation/);
  });
});

test('guest callers degrade gracefully on read and fail explicitly on writes', async () => {
  await withEnv({ ...GIT_AGENT_ENV, PLOINKY_ROUTER_URL: 'http://127.0.0.1:1' }, async () => {
    assert.equal(await getStoredGitToken({ authInfo: GUEST_AUTH }), '');
    await assert.rejects(() => putStoredGitToken({ authInfo: GUEST_AUTH, token: 'ghp_test' }), /signed-in workspace user/);
    await assert.rejects(() => deleteStoredGitToken({ authInfo: GUEST_AUTH }), /signed-in workspace user/);
    await assert.rejects(() => grantStoredGitTokenAccess({ authInfo: GUEST_AUTH }), /signed-in workspace user/);
  });
});

test('putStoredGitToken does not use a legacy repair path after access is denied', async () => {
  const requests = [];
  let putAttempts = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      requests.push({ headers: req.headers, body });
      const tool = body?.params?.name || '';
      let payloadText = JSON.stringify({ ok: true });
      if (tool === 'dpu_secret_put') {
        putAttempts += 1;
        if (putAttempts === 1) {
          payloadText = JSON.stringify({ ok: false, error: 'Access denied: missing write on secret GIT_GITHUB_TOKEN_TEST' });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body?.id || null,
        result: { content: [{ type: 'text', text: payloadText }] }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  await withEnv({ ...GIT_AGENT_ENV, PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}` }, async () => {
    await assert.rejects(() => putStoredGitToken({ authInfo: DELEGATED_AUTH, token: 'ghp_test' }), /Access denied/);
  });
  server.close();

  assert.deepEqual(
    requests.map((entry) => entry.body.params?.name),
    ['dpu_secret_put']
  );
  assert.equal(requests[0].headers['x-ploinky-user-delegation'], 'user-delegation-jwt');
});

test('deleteStoredGitToken treats missing secrets as success and rejects inaccessible records', async () => {
  const scripts = [
    {
      firstError: 'Secret not found: GIT_GITHUB_TOKEN_TEST',
      expectTools: ['dpu_secret_delete'],
      expectResult: { ok: true, deleted: false }
    },
    {
      firstError: 'Access denied: missing write on secret GIT_GITHUB_TOKEN_TEST',
      expectTools: ['dpu_secret_delete'],
      expectError: /Access denied/
    }
  ];
  for (const script of scripts) {
    const requests = [];
    let calls = 0;
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        requests.push({ body });
        calls += 1;
        const payloadText = calls === 1
          ? JSON.stringify({ ok: false, error: script.firstError })
          : JSON.stringify({ ok: true, deleted: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id || null, result: { content: [{ type: 'text', text: payloadText }] } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    let result;
    await withEnv({ ...GIT_AGENT_ENV, PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}` }, async () => {
      if (script.expectError) await assert.rejects(() => deleteStoredGitToken({ authInfo: DELEGATED_AUTH }), script.expectError);
      else result = await deleteStoredGitToken({ authInfo: DELEGATED_AUTH });
    });
    server.close();
    assert.deepEqual(requests.map((entry) => entry.body.params?.name), script.expectTools);
    if (!script.expectError) assert.deepEqual(result, script.expectResult);
  }
});
