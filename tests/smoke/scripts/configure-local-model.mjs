#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signIn } from '../lib/auth.mjs';
import { smokeConfig } from '../lib/config.mjs';

export const LOCAL_PROVIDER_KEY = 'agent:proxies/default-local-llm';
export const LOCAL_PROVIDER_ADAPTER = 'ploinky-agent-openai';
export const LOCAL_PROVIDER_TEMPERATURE = 0;
export const PROVIDER_MANAGEMENT_PATH = '/base-agent-additional-server/soul-gateway/7000/management';

function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateLocalModelFixtureConfig(config = {}) {
  let url;
  try {
    url = new URL(String(config.baseURL || ''));
  } catch (_) {
    throw configurationError('INVALID_LOOPBACK_ORIGIN', 'Local model fixture origin is invalid.');
  }
  if (url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    throw configurationError(
      'INVALID_LOOPBACK_ORIGIN',
      'Local model fixture setup requires an HTTP 127.0.0.1 Router origin.',
    );
  }
  if (String(config.authAgent || '') !== 'explorer') {
    throw configurationError(
      'INVALID_AUTH_AGENT',
      'Local model fixture setup requires the Explorer login route.',
    );
  }
  if (!config.primaryUser?.username || !config.primaryUser?.password) {
    throw configurationError('MISSING_ACCOUNT', 'Local model fixture account is unavailable.');
  }
  return Object.freeze({ baseURL: url.origin });
}

// This function is self-contained because Playwright serializes it into the
// authenticated Explorer page. It returns only public provider identity and
// update status; settings and response bodies stay inside the browser context.
export async function configureLocalModelProvider(input, fetchImpl = globalThis.fetch, timing = {}) {
  const expectedProviderKey = 'agent:proxies/default-local-llm';
  const expectedAdapterKey = 'ploinky-agent-openai';
  const managementPath = '/base-agent-additional-server/soul-gateway/7000/management';
  const now = timing.now || Date.now;
  const wait = timing.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  const exactObject = (value, code, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(code, `${label} is invalid.`);
    }
    return value;
  };
  const canonicalJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`
      )).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const readProvider = async (allowMissing = false, timeoutMs = 90_000) => {
    const response = await fetchImpl(`${managementPath}/providers`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) fail('PROVIDER_LIST_FAILED', `Provider list failed with HTTP ${Number(response?.status || 0) || 'unknown'}.`);
    const payload = await response.json().catch(() => null);
    const providers = exactObject(payload, 'INVALID_PROVIDER_LIST', 'Provider list').data;
    if (!Array.isArray(providers)) fail('INVALID_PROVIDER_LIST', 'Provider list data is invalid.');
    const matches = providers.filter((provider) => provider?.provider_key === expectedProviderKey);
    if (allowMissing && matches.length === 0) return null;
    if (matches.length !== 1 || matches[0].adapter_key !== expectedAdapterKey) {
      fail('LOCAL_PROVIDER_MISMATCH', `Expected exactly one supported local provider; found ${matches.length}.`);
    }
    const provider = exactObject(matches[0], 'INVALID_LOCAL_PROVIDER', 'Local provider');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(String(provider.id || ''))) {
      fail('INVALID_LOCAL_PROVIDER', 'Local provider identity is invalid.');
    }
    const settings = provider.settings === undefined || provider.settings === null
      ? {}
      : exactObject(provider.settings, 'INVALID_LOCAL_PROVIDER', 'Local provider settings');
    const extraBody = settings.extra_body === undefined || settings.extra_body === null
      ? {}
      : exactObject(settings.extra_body, 'INVALID_LOCAL_PROVIDER', 'Local provider extra_body settings');
    return { provider, settings, extraBody };
  };

  if (input?.providerKey !== expectedProviderKey || input?.adapterKey !== expectedAdapterKey
    || input?.temperature !== 0 || input?.managementPath !== managementPath) {
    fail('INVALID_CONFIGURATION_TARGET', 'Local model fixture target is invalid.');
  }
  const deadline = now() + 90_000;
  let before;
  while (!before) {
    const remaining = deadline - now();
    if (remaining <= 0) fail('LOCAL_PROVIDER_NOT_READY', 'Local provider registration did not become ready within 90 seconds.');
    before = await readProvider(true, remaining);
    if (now() >= deadline) fail('LOCAL_PROVIDER_NOT_READY', 'Local provider registration did not become ready within 90 seconds.');
    if (!before) await wait(Math.min(1_000, Math.max(0, deadline - now())));
  }
  const expectedSettings = {
    ...before.settings,
    extra_body: { ...before.extraBody, temperature: 0 },
  };
  const response = await fetchImpl(
    `${managementPath}/providers/${encodeURIComponent(before.provider.id)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: expectedSettings }),
    },
  );
  if (!response?.ok) fail('PROVIDER_UPDATE_FAILED', `Provider update failed with HTTP ${Number(response?.status || 0) || 'unknown'}.`);
  const after = await readProvider();
  if (after.provider.id !== before.provider.id
    || canonicalJson(after.settings) !== canonicalJson(expectedSettings)) {
    fail('PROVIDER_UPDATE_MISMATCH', 'Local provider settings changed outside the requested temperature update.');
  }
  return Object.freeze({
    providerKey: expectedProviderKey,
    adapterKey: expectedAdapterKey,
    temperature: 0,
    status: Number(response.status),
  });
}

export async function runLocalModelFixtureSetup({
  config = smokeConfig,
  signInImpl = signIn,
  chromiumImpl,
} = {}) {
  const validated = validateLocalModelFixtureConfig(config);
  const chromium = chromiumImpl || (await import('@playwright/test')).chromium;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: validated.baseURL });
    try {
      const page = await context.newPage();
      await signInImpl(page, config.primaryUser, '/explorer/', {
        requireConfiguredPrincipal: true,
      });
      if (new URL(page.url()).origin !== validated.baseURL) {
        throw configurationError('INVALID_LOOPBACK_ORIGIN', 'Explorer login left the configured loopback origin.');
      }
      return await page.evaluate(configureLocalModelProvider, {
        providerKey: LOCAL_PROVIDER_KEY,
        adapterKey: LOCAL_PROVIDER_ADAPTER,
        temperature: LOCAL_PROVIDER_TEMPERATURE,
        managementPath: PROVIDER_MANAGEMENT_PATH,
      });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const result = await runLocalModelFixtureSetup();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    const allowedCodes = new Set([
      'INVALID_LOOPBACK_ORIGIN',
      'INVALID_AUTH_AGENT',
      'MISSING_ACCOUNT',
      'INVALID_CONFIGURATION_TARGET',
      'PROVIDER_LIST_FAILED',
      'INVALID_PROVIDER_LIST',
      'LOCAL_PROVIDER_MISMATCH',
      'LOCAL_PROVIDER_NOT_READY',
      'INVALID_LOCAL_PROVIDER',
      'PROVIDER_UPDATE_FAILED',
      'PROVIDER_UPDATE_MISMATCH',
    ]);
    const code = allowedCodes.has(error?.code) ? error.code : 'LOCAL_MODEL_SETUP_FAILED';
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
