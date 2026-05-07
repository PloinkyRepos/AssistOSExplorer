import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CALLER_JWT_HEADER = 'x-ploinky-caller-jwt';
const DEFAULT_DPU_ROUTE = 'dpuAgent';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function loadRouting(workspaceRoot) {
  const routingPath = path.join(workspaceRoot, '.ploinky', 'routing.json');
  return JSON.parse(fs.readFileSync(routingPath, 'utf8'));
}

function resolveDpuRouteName(env = process.env) {
  const configured = String(env.PLOINKY_DPU_ROUTE || env.ONLYOFFICE_DPU_ROUTE || '').trim();
  return configured || DEFAULT_DPU_ROUTE;
}

export function resolveOnlyOfficeRouterBaseUrl({ routing = {}, env = process.env } = {}) {
  const configured = normalizeBaseUrl(env.PLOINKY_ROUTER_URL);
  if (configured) {
    return configured;
  }
  const host = String(env.PLOINKY_ROUTER_HOST || '127.0.0.1').trim();
  const port = String(env.PLOINKY_ROUTER_PORT || routing?.port || '8080').trim();
  return `http://${host}:${port}`;
}

export function getDpuRouterMcpUrl({ routing = {}, env = process.env } = {}) {
  const routeName = resolveDpuRouteName(env);
  return `${resolveOnlyOfficeRouterBaseUrl({ routing, env })}/mcps/${encodeURIComponent(routeName)}/mcp`;
}

function extractInvocationToken(authInfo = null, env = process.env) {
  const direct = authInfo && typeof authInfo === 'object'
    ? String(authInfo.invocationToken || authInfo.rawToken || '').trim()
    : '';
  if (direct) {
    return direct;
  }
  return '';
}

function unwrapToolPayload(name, result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const jsonBlock = blocks.find((block) => block?.type === 'json');
  if (jsonBlock?.json && typeof jsonBlock.json === 'object') {
    return jsonBlock.json;
  }
  const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
  if (textBlock?.text) {
    const parsed = safeParseJson(textBlock.text);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    throw new Error(textBlock.text);
  }
  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  throw new Error(`Invalid DPU response for ${name}.`);
}

export function createOnlyOfficeDpuClient({ workspaceRoot, authInfo, env = process.env }) {
  const routing = loadRouting(workspaceRoot);
  const baseUrl = getDpuRouterMcpUrl({ routing, env });
  const invocationToken = extractInvocationToken(authInfo, env);

  async function callTool(name, args = {}) {
    if (!invocationToken) {
      throw new Error('OnlyOffice DPU calls require a router-issued invocation token.');
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [CALLER_JWT_HEADER]: invocationToken
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: {
          name,
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
      throw new Error(String(parsed.error.message || parsed.error.detail || parsed.error.code || `${name} failed.`));
    }
    return unwrapToolPayload(name, parsed?.result || parsed);
  }

  return {
    callTool,
    close: async () => {},
    getBaseUrl: () => baseUrl
  };
}
