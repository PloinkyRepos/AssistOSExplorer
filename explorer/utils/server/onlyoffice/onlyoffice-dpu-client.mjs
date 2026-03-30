import fs from 'node:fs';
import path from 'node:path';
import { client as mcpClient, StreamableHTTPClientTransport } from 'mcp-sdk';

const { Client } = mcpClient;

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
  const requestHeaders = authInfo
    ? { 'x-ploinky-auth-info': Buffer.from(JSON.stringify(authInfo), 'utf8').toString('base64') }
    : undefined;

  let client = null;
  let transport = null;
  let activeBaseUrl = '';

  async function connect() {
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
    await connect();
    const result = await client.callTool({ name, arguments: args });
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const jsonBlock = blocks.find((block) => block?.type === 'json');
    if (jsonBlock?.json && typeof jsonBlock.json === 'object') {
      return jsonBlock.json;
    }
    const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
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
