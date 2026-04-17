import fs from 'node:fs';
import path from 'node:path';
import { client as mcpClient, StreamableHTTPClientTransport } from 'mcp-sdk';

const { Client } = mcpClient;

export const GIT_GITHUB_TOKEN_SECRET_KEY = 'GIT_GITHUB_TOKEN';
let cachedAgentIdentity = null;

function readConfiguredAgentIdentity() {
  if (cachedAgentIdentity) {
    return cachedAgentIdentity;
  }
  const manifestUrl = new URL('../manifest.json', import.meta.url);
  const raw = fs.readFileSync(manifestUrl, 'utf8');
  const manifest = JSON.parse(raw);
  const identity = manifest?.identity && typeof manifest.identity === 'object' ? manifest.identity : null;
  const principalId = String(identity?.principalId || '').trim();
  const agentName = String(identity?.agentName || '').trim();
  if (!principalId || !agentName) {
    throw new Error('gitAgent manifest.json must declare identity.principalId and identity.agentName.');
  }
  if (!/^agent:/i.test(principalId)) {
    throw new Error('gitAgent manifest.json identity.principalId must use the agent: principal namespace.');
  }
  cachedAgentIdentity = { principalId, agentName };
  return cachedAgentIdentity;
}

function buildGitAgentAuthInfo(authInfo = null) {
  if (!authInfo || typeof authInfo !== 'object') {
    return authInfo;
  }
  const configuredIdentity = readConfiguredAgentIdentity();
  const agent = authInfo.agent && typeof authInfo.agent === 'object'
    ? { ...authInfo.agent }
    : {};
  if (!String(agent.name || '').trim()) {
    agent.name = configuredIdentity.agentName;
  }
  if (!String(agent.principalId || '').trim()) {
    agent.principalId = configuredIdentity.principalId;
  }
  return {
    ...authInfo,
    agent
  };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeToolErrorMessage(text, fallback = 'DPU request failed.') {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  const match = raw.match(/^MCP error(?:\s+-?\d+)?:\s*(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return raw;
}

function unwrapToolPayload(name, result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const jsonBlock = blocks.find((block) => block?.type === 'json');
  if (jsonBlock?.json && typeof jsonBlock.json === 'object') {
    const payload = jsonBlock.json;
    if (payload?.ok === false) {
      throw new Error(String(payload?.message || payload?.error || `DPU request failed for ${name}.`));
    }
    return payload;
  }

  const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
  if (textBlock?.text) {
    const parsed = safeParseJson(textBlock.text);
    if (parsed && typeof parsed === 'object') {
      if (parsed?.ok === false) {
        throw new Error(String(parsed?.message || parsed?.error || `DPU request failed for ${name}.`));
      }
      return parsed;
    }
    throw new Error(normalizeToolErrorMessage(textBlock.text, `DPU request failed for ${name}.`));
  }

  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    const payload = result.structuredContent;
    if (payload?.ok === false) {
      throw new Error(String(payload?.message || payload?.error || `DPU request failed for ${name}.`));
    }
    return payload;
  }

  throw new Error(`Invalid DPU response for ${name}.`);
}

function loadRoute(workspaceRoot, agentName) {
  const routingPath = path.join(workspaceRoot, '.ploinky', 'routing.json');
  const parsed = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
  const route = parsed?.routes?.[agentName] || null;
  const port = Number(route?.hostPort);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`${agentName} route is not configured in .ploinky/routing.json.`);
  }
  return route;
}

function getBaseUrlCandidates(route, env = process.env) {
  const port = Number(route?.hostPort);
  const configuredHost = String(env.GIT_AGENT_DPU_HOST || '').trim();
  const hosts = [
    configuredHost,
    '127.0.0.1',
    'host.containers.internal'
  ].filter(Boolean);
  return [...new Set(hosts)].map((host) => `http://${host}:${port}/mcp`);
}

export function createGitDpuClient({ workspaceRoot, authInfo }) {
  const route = loadRoute(workspaceRoot, 'dpuAgent');
  const baseUrlCandidates = getBaseUrlCandidates(route);
  const effectiveAuthInfo = buildGitAgentAuthInfo(authInfo);
  const requestHeaders = effectiveAuthInfo
    ? { 'x-ploinky-auth-info': Buffer.from(JSON.stringify(effectiveAuthInfo), 'utf8').toString('base64') }
    : undefined;

  let client = null;
  let transport = null;

  async function connect() {
    if (client && transport) return;
    let lastError = null;
    for (const baseUrl of baseUrlCandidates) {
      const nextTransport = new StreamableHTTPClientTransport(
        new URL(baseUrl),
        requestHeaders ? { requestInit: { headers: requestHeaders } } : undefined
      );
      const nextClient = new Client({ name: 'git-agent-dpu', version: '1.0.0' });
      try {
        await nextClient.connect(nextTransport);
        client = nextClient;
        transport = nextTransport;
        return;
      } catch (error) {
        lastError = error;
        try { await nextClient.close(); } catch {}
        try { await nextTransport.close?.(); } catch {}
      }
    }
    throw lastError || new Error(`Could not connect to DPU via ${baseUrlCandidates.join(', ')}.`);
  }

  async function callTool(name, args = {}) {
    await connect();
    const result = await client.callTool({ name, arguments: args });
    return unwrapToolPayload(name, result);
  }

  async function close() {
    try { if (client) await client.close(); } catch {}
    try { await transport?.close?.(); } catch {}
    client = null;
    transport = null;
  }

  return { callTool, close };
}

export async function withGitDpuClient({ workspaceRoot, authInfo }, fn) {
  const client = createGitDpuClient({ workspaceRoot, authInfo });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function grantStoredGitTokenAccess({
  workspaceRoot,
  authInfo,
  key = GIT_GITHUB_TOKEN_SECRET_KEY,
  principal,
  role = 'read'
} = {}) {
  if (!authInfo || typeof authInfo !== 'object') return { ok: false };
  const configuredIdentity = readConfiguredAgentIdentity();
  return withGitDpuClient({ workspaceRoot, authInfo }, (client) =>
    client.callTool('dpu_secret_grant', {
      key,
      principal: String(principal || configuredIdentity.principalId).trim(),
      role
    })
  );
}

export async function getStoredGitToken({ workspaceRoot, authInfo, key = GIT_GITHUB_TOKEN_SECRET_KEY } = {}) {
  if (!authInfo || typeof authInfo !== 'object') return '';
  try {
    await grantStoredGitTokenAccess({ workspaceRoot, authInfo, key }).catch(() => ({ ok: false }));
    const payload = await withGitDpuClient({ workspaceRoot, authInfo }, (client) =>
      client.callTool('dpu_secret_get', { key })
    );
    return String(payload?.secret?.value || payload?.value || '').trim();
  } catch {
    return '';
  }
}

export async function putStoredGitToken({ workspaceRoot, authInfo, token, key = GIT_GITHUB_TOKEN_SECRET_KEY } = {}) {
  if (!authInfo || typeof authInfo !== 'object') {
    throw new Error('Authenticated DPU context is required to store the Git token.');
  }
  const value = String(token || '').trim();
  if (!value) throw new Error('Token is required.');
  const payload = await withGitDpuClient({ workspaceRoot, authInfo }, (client) =>
    client.callTool('dpu_secret_put', { key, value })
  );
  await grantStoredGitTokenAccess({ workspaceRoot, authInfo, key });
  return payload;
}

export async function deleteStoredGitToken({ workspaceRoot, authInfo, key = GIT_GITHUB_TOKEN_SECRET_KEY } = {}) {
  if (!authInfo || typeof authInfo !== 'object') return { ok: true };
  try {
    return await withGitDpuClient({ workspaceRoot, authInfo }, (client) =>
      client.callTool('dpu_secret_delete', { key })
    );
  } catch {
    return { ok: true };
  }
}
