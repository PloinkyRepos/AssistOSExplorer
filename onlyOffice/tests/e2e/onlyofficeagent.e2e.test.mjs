import assert from 'node:assert/strict';
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

function serviceUrl(path) {
  const routerBaseUrl = requiredEnv('ONLYOFFICE_E2E_ROUTER_BASE_URL');
  const servicePrefix = String(process.env.ONLYOFFICE_E2E_SERVICE_PREFIX || '/base-agent-additional-server/onlyOffice/7000/control').replace(/\/+$/, '');
  return new URL(`${servicePrefix}/office/session?path=${encodeURIComponent(path)}`, routerBaseUrl).toString();
}

function authHeaders() {
  const cookie = String(process.env.ONLYOFFICE_E2E_AUTH_COOKIE || '').trim();
  const bearer = String(process.env.ONLYOFFICE_E2E_AUTH_BEARER || '').trim();
  if (!cookie && !bearer) {
    throw new Error('ONLYOFFICE_E2E_AUTH_COOKIE or ONLYOFFICE_E2E_AUTH_BEARER is required when ONLYOFFICE_E2E=1.');
  }
  return {
    ...(cookie ? { cookie } : {}),
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  return { response, text, json };
}

async function openSession(path) {
  return fetchJson(serviceUrl(path), {
    headers: authHeaders(),
  });
}

function assertOfficeConfig(payload, expectedStorageKind) {
  assert.equal(payload?.ok, true);
  assert.equal(typeof payload?.sessionId, 'string');
  assert.equal(payload?.preview?.storageKind, expectedStorageKind);
  assert.equal(typeof payload?.config?.document?.url, 'string');
  assert.equal(typeof payload?.config?.editorConfig?.callbackUrl, 'string');
  assert.equal(typeof payload?.config?.token, 'string');
  assert.equal(JSON.stringify(payload).includes('delegation-token'), false);
}

runtimeTest('authenticated user receives workspace Office session through OnlyOfficeAgent', async () => {
  const documentPath = requiredEnv('ONLYOFFICE_E2E_WORKSPACE_DOC_PATH');
  const { response, text, json } = await openSession(documentPath);

  assert.equal(response.status, 200, text);
  assertOfficeConfig(json, 'workspace');
  assert.equal(json.preview.requestedPath, documentPath);
});

runtimeTest('authenticated user receives Confidential Office session through delegated dpuAgent', async () => {
  const documentPath = requiredEnv('ONLYOFFICE_E2E_CONFIDENTIAL_DOC_PATH');
  const { response, text, json } = await openSession(documentPath);

  assert.equal(response.status, 200, text);
  assertOfficeConfig(json, 'dpu');
  assert.equal(json.preview.requestedPath, documentPath);
  assert.equal(json.config.document.permissions.edit, Boolean(json.preview.canWrite));
  assert.equal(json.config.document.permissions.comment, Boolean(json.preview.canComment));
});

runtimeTest('user without Confidential acl cannot receive another user document session', async () => {
  const documentPath = requiredEnv('ONLYOFFICE_E2E_FORBIDDEN_CONFIDENTIAL_DOC_PATH');
  const { response, text } = await openSession(documentPath);

  assert.ok([403, 404].includes(response.status), `expected 403 or 404, got ${response.status}: ${text}`);
});
