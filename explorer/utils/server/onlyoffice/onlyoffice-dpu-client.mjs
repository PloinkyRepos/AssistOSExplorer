import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { client as mcpClient, StreamableHTTPClientTransport } from 'mcp-sdk';

const { Client } = mcpClient;
const INVOCATION_TTL_SECONDS = 60;
const INVOCATION_IAT_BACKDATE_SECONDS = 30;
const DEFAULT_INVOCATION_SCOPES = Object.freeze([
  'secret:read',
  'secret:write',
  'secret:access',
  'secret:grant',
  'secret:revoke'
]);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function bodyHashForRequest(bodyObject) {
  return crypto.createHash('sha256').update(canonicalJson(bodyObject ?? {}), 'utf8').digest('base64url');
}

function signHmacJwt({ payload, secret }) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function normalizeAuthUser(authInfo) {
  const user = authInfo && typeof authInfo === 'object' ? authInfo.user : null;
  if (!user || typeof user !== 'object') return null;
  return {
    sub: String(user.id || ''),
    id: String(user.id || ''),
    email: String(user.email || ''),
    username: String(user.username || user.name || user.email || ''),
    roles: Array.isArray(user.roles) ? [...user.roles] : []
  };
}

function buildDpuInvocationHeaders(route, toolName, args, authInfo, env = process.env) {
  const wireSecret = String(env.PLOINKY_WIRE_SECRET || '').trim();
  if (!wireSecret) return {};

  const now = Math.floor(Date.now() / 1000);
  const iat = now - INVOCATION_IAT_BACKDATE_SECONDS;
  const exp = now + INVOCATION_TTL_SECONDS;
  const providerPrincipal = `agent:${String(route?.repo || '').trim()}/${String(route?.agent || '').trim()}`;
  const callerPrincipal = String(env.PLOINKY_AGENT_PRINCIPAL || env.AGENT_NAME || 'agent:explorer').trim();
  const user = normalizeAuthUser(authInfo);
  const bodyObject = { tool: toolName, arguments: args || {} };
  const token = signHmacJwt({
    payload: {
      typ: 'invocation',
      iss: 'ploinky-router',
      aud: providerPrincipal,
      sub: String(user?.id || user?.sub || ''),
      caller: callerPrincipal,
      tool: String(toolName),
      scope: DEFAULT_INVOCATION_SCOPES,
      bh: bodyHashForRequest(bodyObject),
      usr: user,
      jti: crypto.randomBytes(16).toString('base64url'),
      iat,
      exp
    },
    secret: Buffer.from(wireSecret, 'hex')
  });
  return { authorization: `Bearer ${token}` };
}

function loadDpuRoute(workspaceRoot) {
  const routingPath = path.join(workspaceRoot, '.ploinky', 'routing.json');
  const parsed = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
  const route = parsed?.routes?.dpuAgent || null;
  const port = Number(route?.hostPort);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('DPU route is not configured in .ploinky/routing.json.');
  }
  return route;
}

export function getDpuBaseUrlCandidates(route, env = process.env) {
  const port = Number(route?.hostPort);
  const configuredHost = String(env.ONLYOFFICE_DPU_HOST || '').trim();
  const hosts = [
    configuredHost,
    '127.0.0.1',
    'host.containers.internal'
  ].filter(Boolean);

  return [...new Set(hosts)].map((host) => `http://${host}:${port}/mcp`);
}

export function createOnlyOfficeDpuClient({ workspaceRoot, authInfo }) {
  const route = loadDpuRoute(workspaceRoot);
  const baseUrlCandidates = getDpuBaseUrlCandidates(route);
  let client = null;
  let transport = null;
  let activeBaseUrl = '';

  async function connect(requestHeaders = undefined) {
    if (client && transport) {
      return;
    }
    let lastError = null;
    for (const baseUrl of baseUrlCandidates) {
      const nextTransport = new StreamableHTTPClientTransport(
        new URL(baseUrl),
        requestHeaders ? { requestInit: { headers: requestHeaders } } : undefined
      );
      const nextClient = new Client({ name: 'explorer-onlyoffice', version: '1.0.0' });
      try {
        await nextClient.connect(nextTransport);
        transport = nextTransport;
        client = nextClient;
        activeBaseUrl = baseUrl;
        return;
      } catch (error) {
        lastError = error;
        try {
          await nextClient.close();
        } catch {
          // ignore close errors
        }
        try {
          await nextTransport.close?.();
        } catch {
          // ignore close errors
        }
      }
    }
    throw lastError || new Error(`Could not connect to DPU MCP route via ${baseUrlCandidates.join(', ')}.`);
  }

  async function callTool(name, args = {}) {
    await close();
    const requestHeaders = buildDpuInvocationHeaders(route, name, args, authInfo);
    await connect(requestHeaders);
    const result = await client.callTool({ name, arguments: args });
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
    if (result?.isError) {
      throw new Error(textBlock?.text || `DPU call failed: ${name}`);
    }
    const jsonBlock = blocks.find((block) => block?.type === 'json');
    if (jsonBlock?.json && typeof jsonBlock.json === 'object') {
      return jsonBlock.json;
    }
    if (textBlock?.text) {
      return JSON.parse(textBlock.text);
    }
    if (result?.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent;
    }
    throw new Error(`Invalid DPU response for ${name}.`);
  }

  async function close() {
    try {
      if (client) {
        await client.close();
      }
    } catch {
      // ignore close errors
    }
    try {
      await transport?.close?.();
    } catch {
      // ignore close errors
    }
    client = null;
    transport = null;
    activeBaseUrl = '';
  }

  return {
    callTool,
    close,
    getBaseUrl: () => activeBaseUrl
  };
}
