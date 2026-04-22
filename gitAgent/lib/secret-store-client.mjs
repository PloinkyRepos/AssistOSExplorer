import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let cachedWireSign = null;
async function loadWireSign() {
  if (cachedWireSign) return cachedWireSign;
  const candidates = [
    process.env.PLOINKY_WIRE_SIGN_MODULE,
    '/Agent/lib/wireSign.mjs',
    path.resolve(process.cwd(), 'Agent/lib/wireSign.mjs')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      cachedWireSign = await import(candidate);
      return cachedWireSign;
    } catch (_) {}
  }
  return null;
}

/**
 * secret-store-client.mjs
 *
 * DPU-aware secret client used by gitAgent. It:
 *
 *   - routes every call through the router to the configured DPU route
 *   - signs a per-request caller assertion with gitAgent's private key
 *   - forwards the router-issued delegated user token unchanged
 *   - does not depend on capability bindings for Git -> DPU traffic
 *
 * Env contract (set by AgentServer/ploinky start scripts):
 *
 *   PLOINKY_ROUTER_URL            - e.g. http://127.0.0.1:8080
 *   PLOINKY_AGENT_PRINCIPAL       - e.g. agent:AssistOSExplorer/gitAgent
 *   PLOINKY_AGENT_PRIVATE_KEY_PEM - the agent's Ed25519 private key (PEM)
 *   PLOINKY_AGENT_PRIVATE_KEY_PATH - alternative file-based source
 *   PLOINKY_DPU_ROUTE             - optional explicit DPU MCP route name
 *   PLOINKY_DPU_PRINCIPAL         - optional explicit DPU principal id
 */

const CALLER_ASSERTION_HEADER = 'x-ploinky-caller-assertion';
const USER_CONTEXT_HEADER = 'x-ploinky-user-context';
const DEFAULT_DPU_ROUTE = 'dpuAgent';
const DEFAULT_DPU_PRINCIPAL = 'agent:AssistOSExplorer/dpuAgent';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readPrivateKeyPem() {
  const inline = process.env.PLOINKY_AGENT_PRIVATE_KEY_PEM;
  if (isNonEmptyString(inline)) return inline.trim();
  const filePath = process.env.PLOINKY_AGENT_PRIVATE_KEY_PATH;
  if (isNonEmptyString(filePath) && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  const workspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT;
  if (isNonEmptyString(workspaceRoot)) {
    const principal = String(process.env.PLOINKY_AGENT_PRINCIPAL || '').replace(/[^a-zA-Z0-9:_\-]/g, '_');
    const candidate = path.join(workspaceRoot, '.ploinky', 'keys', 'agents', `${principal}.key`);
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

function resolveRouterBaseUrl() {
  const explicit = String(process.env.PLOINKY_ROUTER_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = String(process.env.PLOINKY_ROUTER_HOST || '127.0.0.1').trim();
  const port = String(process.env.PLOINKY_ROUTER_PORT || '8080').trim();
  return `http://${host}:${port}`;
}

function resolveDpuRouteName(explicitRouteName = '') {
  const explicit = String(explicitRouteName || process.env.PLOINKY_DPU_ROUTE || '').trim();
  return explicit || DEFAULT_DPU_ROUTE;
}

function resolveConsumerPrincipal() {
  const principal = String(process.env.PLOINKY_AGENT_PRINCIPAL || '').trim();
  if (principal) return principal;
  throw new Error('PLOINKY_AGENT_PRINCIPAL is required and must use canonical agent:<repo>/<agent> form.');
}

function resolveDpuPrincipal(explicitPrincipal = '') {
  const value = String(explicitPrincipal || process.env.PLOINKY_DPU_PRINCIPAL || '').trim();
  return value || DEFAULT_DPU_PRINCIPAL;
}

function extractUserContextTokenFromAuthInfo(authInfo) {
  const invocation = authInfo && typeof authInfo === 'object' ? authInfo.invocation : null;
  const token = invocation && typeof invocation === 'object' ? invocation.userContextToken : null;
  return isNonEmptyString(token) ? token.trim() : '';
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function unwrapToolPayload(name, result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const jsonBlock = blocks.find((b) => b?.type === 'json');
  if (jsonBlock?.json && typeof jsonBlock.json === 'object') {
    const payload = jsonBlock.json;
    if (payload?.ok === false) throw new Error(String(payload?.message || payload?.error || `${name} failed.`));
    return payload;
  }
  const textBlock = blocks.find((b) => b?.type === 'text' && typeof b.text === 'string');
  if (textBlock?.text) {
    const parsed = safeParseJson(textBlock.text);
    if (parsed && typeof parsed === 'object') {
      if (parsed?.ok === false) throw new Error(String(parsed?.message || parsed?.error || `${name} failed.`));
      return parsed;
    }
    throw new Error(String(textBlock.text));
  }
  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    if (result.structuredContent.ok === false) {
      throw new Error(String(result.structuredContent?.message || result.structuredContent?.error || `${name} failed.`));
    }
    return result.structuredContent;
  }
  throw new Error(`Invalid response for ${name}.`);
}

function scopesForOperation(operation) {
  switch (operation) {
    case 'secret_get':
    case 'secret_list':
      return ['secret:read'];
    case 'secret_put':
    case 'secret_delete':
      return ['secret:write'];
    case 'secret_grant':
      return ['secret:grant'];
    case 'secret_revoke':
      return ['secret:revoke'];
    default:
      return [];
  }
}

export function createSecretStoreClient({ providerRouteName, providerPrincipal, authInfo = null, userContextToken = '' } = {}) {
  const routerBase = resolveRouterBaseUrl();
  const callerPrincipal = resolveConsumerPrincipal();
  const dpuRouteName = resolveDpuRouteName(providerRouteName);
  const dpuPrincipal = resolveDpuPrincipal(providerPrincipal);
  const baseUrl = `${routerBase}/mcps/${encodeURIComponent(dpuRouteName)}/mcp`;

  async function callContractOperation(operation, args = {}) {
    const bodyObject = { tool: operation, arguments: args };
    const privatePem = readPrivateKeyPem();
    if (!privatePem || !callerPrincipal) {
      throw new Error('secret-store-client: missing agent signing identity.');
    }
    const headers = {};
    const forwardedUserContextToken = isNonEmptyString(userContextToken)
      ? userContextToken.trim()
      : extractUserContextTokenFromAuthInfo(authInfo) || process.env.PLOINKY_USER_CONTEXT_TOKEN || undefined;
    if (!forwardedUserContextToken) {
      throw new Error('secret-store-client: missing delegated user context token.');
    }
    const wire = await loadWireSign();
    if (!wire?.signCallerAssertion) {
      throw new Error('secret-store-client: wireSign module unavailable.');
    }
    const { token } = wire.signCallerAssertion({
      callerPrincipal,
      tool: operation,
      scope: scopesForOperation(operation),
      bodyObject,
      privatePem,
      audience: dpuPrincipal,
      userContextToken: forwardedUserContextToken
    });
    headers[CALLER_ASSERTION_HEADER] = token;
    headers[USER_CONTEXT_HEADER] = forwardedUserContextToken;
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: {
          name: operation,
          arguments: args
        }
      })
    });
    const responseText = await response.text();
    const parsed = safeParseJson(responseText);
    if (!response.ok) {
      const detail = parsed?.error?.message || parsed?.error || responseText || `HTTP ${response.status}`;
      throw new Error(String(detail));
    }
    if (parsed?.error && typeof parsed.error === 'object') {
      throw new Error(String(parsed.error.message || parsed.error.detail || parsed.error.code || `${operation} failed.`));
    }
    return unwrapToolPayload(operation, parsed?.result || parsed);
  }

  return {
    get(key) {
      return callContractOperation('secret_get', { key });
    },
    put(key, value) {
      return callContractOperation('secret_put', { key, value });
    },
    delete(key) {
      return callContractOperation('secret_delete', { key });
    },
    grant(key, principal, role) {
      return callContractOperation('secret_grant', { key, principal, role });
    },
    revoke(key, principal) {
      return callContractOperation('secret_revoke', { key, principal });
    },
    list() {
      return callContractOperation('secret_list', {});
    }
  };
}

/**
 * Minimal per-call helper used by github-auth.mjs. Always creates a fresh
 * client; callers do not manage lifecycle.
 */
export async function withSecretStoreClient(fn, options = {}) {
  const client = createSecretStoreClient(options);
  return fn(client);
}

export const GIT_GITHUB_TOKEN_SECRET_KEY = 'GIT_GITHUB_TOKEN';

/**
 * GitHub-token helpers built on the direct Git -> DPU secret client.
 */
export async function getStoredGitToken({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  try {
    const client = createSecretStoreClient({ authInfo });
    const payload = await client.get(key);
    return String(payload?.secret?.value || payload?.value || '').trim();
  } catch {
    return '';
  }
}

export async function putStoredGitToken({ token, key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Token is required.');
  const client = createSecretStoreClient({ authInfo });
  const payload = await client.put(key, value);
  try {
    await client.grant(key, resolveConsumerPrincipal(), 'read');
  } catch { /* grant is best-effort on write */ }
  return payload;
}

export async function deleteStoredGitToken({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  try {
    const client = createSecretStoreClient({ authInfo });
    return await client.delete(key);
  } catch {
    return { ok: true };
  }
}

export async function grantStoredGitTokenAccess({ key = GIT_GITHUB_TOKEN_SECRET_KEY, principal, role = 'read', authInfo = null } = {}) {
  try {
    const client = createSecretStoreClient({ authInfo });
    const target = principal || resolveConsumerPrincipal();
    return await client.grant(key, target, role);
  } catch {
    return { ok: false };
  }
}
