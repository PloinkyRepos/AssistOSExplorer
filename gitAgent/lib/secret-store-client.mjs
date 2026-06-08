import crypto from 'node:crypto';

/**
 * secret-store-client.mjs
 *
 * DPU-aware secret client used by gitAgent. It:
 *
 *   - routes every call through the router to the configured DPU route
 *   - signs each delegated DPU call with this agent's Ploinky agent assertion
 *   - calls the canonical DPU secret operations
 *
 * Env contract (set by AgentServer/ploinky start scripts):
 *
 *   PLOINKY_ROUTER_URL            - e.g. http://127.0.0.1:8080
 *   PLOINKY_AGENT_PRINCIPAL       - e.g. agent:<repo>/gitAgent
 *   PLOINKY_DPU_ROUTE             - optional explicit DPU MCP route name
 */

const DEFAULT_DPU_ROUTE = 'dpuAgent';
const AGENT_SECRET_TOOL_NAMES = {
  dpu_secret_get: 'dpu_agent_secret_get',
  dpu_secret_put: 'dpu_agent_secret_put',
  dpu_secret_delete: 'dpu_agent_secret_delete',
  dpu_secret_grant: 'dpu_agent_secret_grant',
  dpu_secret_revoke: 'dpu_agent_secret_revoke',
  dpu_secret_list: 'dpu_agent_secret_list'
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

async function loadAgentAssertionSigner() {
  const agentLibDir = String(process.env.PLOINKY_AGENT_LIB_DIR || '/Agent').replace(/\/+$/, '');
  const candidates = [
    `${agentLibDir}/lib/agentAssertion.mjs`,
    new URL('../../../ploinky/Agent/lib/agentAssertion.mjs', import.meta.url).href
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (typeof mod.signAgentAssertion === 'function') {
        return mod.signAgentAssertion;
      }
    } catch (_) {}
  }
  throw new Error('secret-store-client: unable to load Ploinky agent assertion signer.');
}

function extractInvocationToken(authInfo) {
  if (!authInfo || typeof authInfo !== 'object') return '';
  const token = authInfo.invocationToken || authInfo.rawToken || '';
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

export function createSecretStoreClient({ providerRouteName, authInfo = null, invocationToken = '' } = {}) {
  const routerBase = resolveRouterBaseUrl();
  const dpuRouteName = resolveDpuRouteName(providerRouteName);
  const baseUrl = `${routerBase}/${encodeURIComponent(dpuRouteName)}/mcp`;

  async function callContractOperation(operation, args = {}) {
    const routedOperation = AGENT_SECRET_TOOL_NAMES[operation] || operation;
    const forwardedInvocationToken = isNonEmptyString(invocationToken)
      ? invocationToken.trim()
      : extractInvocationToken(authInfo) || undefined;
    if (!forwardedInvocationToken) {
      throw new Error('secret-store-client: missing invocation token for delegated DPU call.');
    }
    const signAgentAssertion = await loadAgentAssertionSigner();
    const assertion = signAgentAssertion({
      method: 'POST',
      path: '/mcp',
      targetAgent: dpuRouteName,
      tool: routedOperation,
      argumentsObj: args
    });
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${assertion}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: {
          name: routedOperation,
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
      return callContractOperation('dpu_secret_get', { key });
    },
    put(key, value) {
      return callContractOperation('dpu_secret_put', { key, value });
    },
    delete(key) {
      return callContractOperation('dpu_secret_delete', { key });
    },
    grant(key, principal, role) {
      return callContractOperation('dpu_secret_grant', { key, principal, role });
    },
    revoke(key, principal) {
      return callContractOperation('dpu_secret_revoke', { key, principal });
    },
    list() {
      return callContractOperation('dpu_secret_list', {});
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

function normalizePrincipalPart(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function resolveGitAuthPrincipal(authInfo = null) {
  if (!authInfo || typeof authInfo !== 'object') {
    return '';
  }
  const user = authInfo.user && typeof authInfo.user === 'object' ? authInfo.user : {};
  const userId = normalizePrincipalPart(user.id);
  if (userId) {
    return `user:${userId}`;
  }
  const username = normalizePrincipalPart(user.username);
  if (username) {
    return `user:${username}`;
  }
  const email = normalizePrincipalPart(user.email).toLowerCase();
  if (email && email.includes('@')) {
    return email;
  }
  const subject = normalizePrincipalPart(authInfo.invocation?.subject);
  if (subject && !/^agent:/i.test(subject)) {
    return subject;
  }
  const agentPrincipal = normalizePrincipalPart(authInfo.agent?.principalId);
  return agentPrincipal || '';
}

export function resolveGitAuthScopeSuffix(authInfo = null) {
  const principal = resolveGitAuthPrincipal(authInfo);
  if (!principal) {
    return '';
  }
  return crypto
    .createHash('sha256')
    .update(principal)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
}

export function resolveGitTokenSecretKey({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  const normalizedKey = String(key || '').trim() || GIT_GITHUB_TOKEN_SECRET_KEY;
  if (normalizedKey !== GIT_GITHUB_TOKEN_SECRET_KEY) {
    return normalizedKey;
  }
  const suffix = resolveGitAuthScopeSuffix(authInfo);
  return suffix ? `${GIT_GITHUB_TOKEN_SECRET_KEY}_${suffix}` : GIT_GITHUB_TOKEN_SECRET_KEY;
}

function resolveGitTokenSecretKeyCandidates({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  const normalizedKey = String(key || '').trim() || GIT_GITHUB_TOKEN_SECRET_KEY;
  if (normalizedKey !== GIT_GITHUB_TOKEN_SECRET_KEY) {
    return [normalizedKey];
  }
  const resolvedKey = resolveGitTokenSecretKey({ key, authInfo });
  if (resolvedKey === GIT_GITHUB_TOKEN_SECRET_KEY) {
    return [resolvedKey];
  }
  return [resolvedKey, GIT_GITHUB_TOKEN_SECRET_KEY];
}

/**
 * GitHub-token helpers built on the direct Git -> DPU secret client.
 */
export async function getStoredGitToken({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  const client = createSecretStoreClient({ authInfo });
  for (const candidateKey of resolveGitTokenSecretKeyCandidates({ key, authInfo })) {
    try {
      const payload = await client.get(candidateKey);
      const value = String(payload?.secret?.value || payload?.value || '').trim();
      if (value) {
        return value;
      }
    } catch {
      // Try the next candidate. The legacy key may be missing or owned by
      // another workspace user in existing deployments.
    }
  }
  return '';
}

export async function putStoredGitToken({ token, key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Token is required.');
  const client = createSecretStoreClient({ authInfo });
  const resolvedKey = resolveGitTokenSecretKey({ key, authInfo });
  const payload = await client.put(resolvedKey, value);
  try {
    await client.grant(resolvedKey, resolveConsumerPrincipal(), 'read');
  } catch { /* grant is best-effort on write */ }
  return payload;
}

export async function deleteStoredGitToken({ key = GIT_GITHUB_TOKEN_SECRET_KEY, authInfo = null } = {}) {
  try {
    const client = createSecretStoreClient({ authInfo });
    return await client.delete(resolveGitTokenSecretKey({ key, authInfo }));
  } catch {
    return { ok: true };
  }
}

export async function grantStoredGitTokenAccess({ key = GIT_GITHUB_TOKEN_SECRET_KEY, principal, role = 'read', authInfo = null } = {}) {
  try {
    const client = createSecretStoreClient({ authInfo });
    const target = principal || resolveConsumerPrincipal();
    return await client.grant(resolveGitTokenSecretKey({ key, authInfo }), target, role);
  } catch {
    return { ok: false };
  }
}
