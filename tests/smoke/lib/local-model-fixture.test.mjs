import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_PROVIDER_ADAPTER,
  LOCAL_PROVIDER_KEY,
  LOCAL_PROVIDER_TEMPERATURE,
  PROVIDER_MANAGEMENT_PATH,
  configureLocalModelProvider,
  runLocalModelFixtureSetup,
  validateLocalModelFixtureConfig,
} from '../scripts/configure-local-model.mjs';

const target = Object.freeze({
  providerKey: LOCAL_PROVIDER_KEY,
  adapterKey: LOCAL_PROVIDER_ADAPTER,
  temperature: LOCAL_PROVIDER_TEMPERATURE,
  managementPath: PROVIDER_MANAGEMENT_PATH,
});

function localProvider(settings) {
  return {
    id: 'provider-local-1',
    provider_key: LOCAL_PROVIDER_KEY,
    adapter_key: LOCAL_PROVIDER_ADAPTER,
    settings,
  };
}

test('authenticated Explorer setup preserves provider settings and changes only temperature', async () => {
  const privateValues = ['fixture-private-header', 'fixture-private-key'];
  const initialSettings = {
    model: 'local-model',
    timeout: 90,
    headers: { 'x-private-key': privateValues[0] },
    api_key: privateValues[1],
    extra_body: { top_p: 0.75, seed: 42, temperature: 0.9 },
  };
  let currentSettings = structuredClone(initialSettings);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PATCH') {
      currentSettings = JSON.parse(options.body).settings;
      return { ok: true, status: 204 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'other', provider_key: 'other', adapter_key: 'other', settings: {} },
          localProvider(structuredClone(currentSettings)),
        ],
      }),
    };
  };

  const result = await configureLocalModelProvider(target, fetchImpl);
  assert.deepEqual(currentSettings, {
    ...initialSettings,
    extra_body: { ...initialSettings.extra_body, temperature: 0 },
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(({ url, options }) => [url, options.method]), [
    [`${PROVIDER_MANAGEMENT_PATH}/providers`, 'GET'],
    [`${PROVIDER_MANAGEMENT_PATH}/providers/provider-local-1`, 'PATCH'],
    [`${PROVIDER_MANAGEMENT_PATH}/providers`, 'GET'],
  ]);
  assert.deepEqual(result, {
    providerKey: LOCAL_PROVIDER_KEY,
    adapterKey: LOCAL_PROVIDER_ADAPTER,
    temperature: 0,
    status: 204,
  });
  for (const privateValue of privateValues) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateValue));
  }
});

test('setup uses the standard Explorer login destination before provider management', async () => {
  const calls = [];
  const page = {
    url: () => 'http://127.0.0.1:28080/explorer/',
    async evaluate(fn, input) {
      calls.push({ kind: 'evaluate', fn, input });
      return { providerKey: LOCAL_PROVIDER_KEY, adapterKey: LOCAL_PROVIDER_ADAPTER, temperature: 0, status: 204 };
    },
  };
  const context = {
    async newPage() { return page; },
    async close() { calls.push({ kind: 'context-close' }); },
  };
  const browser = {
    async newContext(options) {
      calls.push({ kind: 'new-context', options });
      return context;
    },
    async close() { calls.push({ kind: 'browser-close' }); },
  };
  const result = await runLocalModelFixtureSetup({
    config: {
      baseURL: 'http://127.0.0.1:28080',
      authAgent: 'explorer',
      primaryUser: { username: 'fixture-admin', password: 'fixture-password' },
    },
    chromiumImpl: { async launch(options) { calls.push({ kind: 'launch', options }); return browser; } },
    async signInImpl(receivedPage, account, returnTo, options) {
      assert.strictEqual(receivedPage, page);
      calls.push({ kind: 'sign-in', account, returnTo, options });
    },
  });
  assert.deepEqual(result, {
    providerKey: LOCAL_PROVIDER_KEY,
    adapterKey: LOCAL_PROVIDER_ADAPTER,
    temperature: 0,
    status: 204,
  });
  const signInCall = calls.find(({ kind }) => kind === 'sign-in');
  assert.equal(signInCall.returnTo, '/explorer/');
  assert.deepEqual(signInCall.options, { requireConfiguredPrincipal: true });
  assert.deepEqual(calls.find(({ kind }) => kind === 'new-context').options, {
    baseURL: 'http://127.0.0.1:28080',
  });
  assert.deepEqual(calls.slice(-2).map(({ kind }) => kind), ['context-close', 'browser-close']);
});

test('a login redirect outside the configured loopback origin cannot access provider management', async () => {
  let evaluations = 0;
  let closed = 0;
  const context = {
    async newPage() {
      return {
        url: () => 'http://127.0.0.1:38080/explorer/',
        async evaluate() { evaluations += 1; },
      };
    },
    async close() { closed += 1; },
  };
  await assert.rejects(runLocalModelFixtureSetup({
    config: {
      baseURL: 'http://127.0.0.1:28080',
      authAgent: 'explorer',
      primaryUser: { username: 'admin', password: 'admin' },
    },
    signInImpl: async () => {},
    chromiumImpl: { async launch() {
      return { newContext: async () => context, async close() { closed += 1; } };
    } },
  }), (error) => error.code === 'INVALID_LOOPBACK_ORIGIN');
  assert.equal(evaluations, 0);
  assert.equal(closed, 2);
});

test('local fixture setup rejects non-loopback origins and non-Explorer login agents', () => {
  const valid = {
    baseURL: 'http://127.0.0.1:8080',
    authAgent: 'explorer',
    primaryUser: { username: 'admin', password: 'admin' },
  };
  assert.deepEqual(validateLocalModelFixtureConfig(valid), { baseURL: 'http://127.0.0.1:8080' });
  for (const baseURL of [
    'https://127.0.0.1:8080',
    'http://localhost:8080',
    'http://0.0.0.0:8080',
    'http://127.0.0.1:8080/explorer',
    'http://user:password@127.0.0.1:8080',
  ]) {
    assert.throws(() => validateLocalModelFixtureConfig({ ...valid, baseURL }), /127\.0\.0\.1 Router origin/);
  }
  assert.throws(() => validateLocalModelFixtureConfig({
    ...valid,
    authAgent: 'soul-gateway',
  }), /Explorer login route/);
});

test('provider selection and post-update verification fail closed without a second mutation', async () => {
  let patchCount = 0;
  await assert.rejects(configureLocalModelProvider(target, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [
      { ...localProvider({}), adapter_key: 'openai' },
      { ...localProvider({}), provider_key: 'agent:other/model' },
    ] }),
  })), (error) => error.code === 'LOCAL_PROVIDER_MISMATCH');

  let reads = 0;
  await assert.rejects(configureLocalModelProvider(target, async (_url, options) => {
    if (options.method === 'PATCH') {
      patchCount += 1;
      return { ok: true, status: 200 };
    }
    reads += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [localProvider(reads === 1
        ? { api_key: 'preserved', extra_body: { top_p: 0.5 } }
        : { api_key: 'changed-by-server', extra_body: { top_p: 0.5, temperature: 0 } })] }),
    };
  }), (error) => error.code === 'PROVIDER_UPDATE_MISMATCH');
  assert.equal(patchCount, 1);
});

test('absent local provider registration is polled before exactly one update', async () => {
  let elapsed = 0;
  let reads = 0;
  let settings = { model: 'local-model', extra_body: { top_p: 0.5 } };
  const methods = [];
  const result = await configureLocalModelProvider(target, async (_url, options) => {
    methods.push(options.method);
    if (options.method === 'PATCH') {
      assert.ok(reads >= 7, 'provider must be registered before mutation');
      settings = JSON.parse(options.body).settings;
      return { ok: true, status: 200 };
    }
    reads += 1;
    if (reads === 1) throw new TypeError('temporary transport failure');
    if (reads <= 4) return { ok: false, status: 500 + reads };
    if (reads === 5) {
      return { ok: true, status: 200, json: async () => { throw new TypeError('body transport failure'); } };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: reads < 7 ? [] : [localProvider(settings)] }),
    };
  }, {
    now: () => elapsed,
    wait: async (ms) => { elapsed += ms; },
  });
  assert.ok(elapsed > 0 && elapsed < 90_000);
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET', 'GET', 'GET', 'GET', 'PATCH', 'GET']);
  assert.equal(result.temperature, 0);
  assert.equal(settings.extra_body.top_p, 0.5);
});

test('transient registration failures time out without mutation and duplicate rows fail without polling', async () => {
  let elapsed = 0;
  const methods = [];
  const timing = {
    now: () => elapsed,
    wait: async (ms) => { elapsed += ms; },
  };
  await assert.rejects(configureLocalModelProvider(target, async (_url, options) => {
    methods.push(options.method);
    return { ok: false, status: 503 };
  }, timing), (error) => error.code === 'LOCAL_PROVIDER_NOT_READY');
  assert.equal(elapsed, 90_000);
  assert.ok(methods.length > 1);
  assert.ok(methods.every((method) => method === 'GET'));

  elapsed = 0;
  methods.length = 0;
  await assert.rejects(configureLocalModelProvider(target, async (_url, options) => {
    methods.push(options.method);
    return { ok: true, status: 200, json: async () => ({ data: [
      localProvider({}),
      { ...localProvider({}), id: 'other-local', adapter_key: 'wrong-adapter' },
    ] }) };
  }, timing), (error) => error.code === 'LOCAL_PROVIDER_MISMATCH');
  assert.equal(elapsed, 0);
  assert.deepEqual(methods, ['GET']);
});

test('post-update readback retries only transient GET failures without repeating the PATCH', async () => {
  let elapsed = 0;
  let reads = 0;
  let patches = 0;
  let settings = { api_key: 'preserved', extra_body: { top_p: 0.5 } };
  const result = await configureLocalModelProvider(target, async (_url, options) => {
    if (options.method === 'PATCH') {
      patches += 1;
      settings = JSON.parse(options.body).settings;
      return { ok: true, status: 204 };
    }
    reads += 1;
    if (patches === 1 && reads === 2) return { ok: false, status: 502 };
    if (patches === 1 && reads === 3) throw new TypeError('temporary transport failure');
    return { ok: true, status: 200, json: async () => ({ data: [localProvider(settings)] }) };
  }, {
    now: () => elapsed,
    wait: async (ms) => { elapsed += ms; },
  });
  assert.equal(patches, 1);
  assert.equal(reads, 4);
  assert.equal(elapsed, 2_000);
  assert.equal(result.status, 204);
});

test('authorization, unsupported statuses, and malformed provider lists fail without waiting', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    let waits = 0;
    await assert.rejects(configureLocalModelProvider(target, async () => ({ ok: false, status }), {
      now: () => 0,
      wait: async () => { waits += 1; },
    }), (error) => error.code === 'PROVIDER_LIST_FAILED');
    assert.equal(waits, 0);
  }
  await assert.rejects(configureLocalModelProvider(target, async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('malformed JSON'); },
  }), {
    now: () => 0,
    wait: async () => { throw new Error('malformed responses must not retry'); },
  }), (error) => error.code === 'INVALID_PROVIDER_LIST');
});
