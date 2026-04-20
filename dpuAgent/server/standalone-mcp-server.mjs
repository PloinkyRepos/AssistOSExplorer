#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const INVOCATION_TOKEN_HEADER = 'x-ploinky-invocation';
const CALLER_ASSERTION_HEADER = 'x-ploinky-caller-assertion';
const USER_CONTEXT_HEADER = 'x-ploinky-user-context';
let cachedWireVerify = null;
async function loadWireVerify() {
  if (cachedWireVerify) return cachedWireVerify;
  const candidates = [
    process.env.PLOINKY_WIRE_VERIFY_MODULE,
    '/Agent/lib/wireVerify.mjs',
    path.resolve(process.cwd(), 'Agent/lib/wireVerify.mjs'),
    path.resolve(process.cwd(), '../Agent/lib/wireVerify.mjs')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      cachedWireVerify = mod;
      return mod;
    } catch (_) {}
  }
  return null;
}

function readRouterPublicKeyMaterial() {
  const jwkEnv = process.env.PLOINKY_ROUTER_PUBLIC_KEY_JWK;
  if (jwkEnv && jwkEnv.trim()) {
    try { return { publicKeyJwk: JSON.parse(jwkEnv) }; } catch (_) {}
  }
  const pemPath = process.env.PLOINKY_ROUTER_PUBLIC_KEY_PATH;
  if (pemPath) {
    try { return { publicPem: fs.readFileSync(pemPath, 'utf8') }; } catch (_) {}
  }
  for (const candidate of ['/Agent/router-session.pub', '/shared/router-session.pub']) {
    try {
      if (fs.existsSync(candidate)) return { publicPem: fs.readFileSync(candidate, 'utf8') };
    } catch (_) {}
  }
  return null;
}

function expectedAudienceForSelf() {
  const principal = process.env.PLOINKY_AGENT_PRINCIPAL;
  if (principal && principal.trim()) return principal.trim();
  const agentName = process.env.AGENT_NAME || '';
  return agentName ? `agent:${agentName}` : '';
}

let sharedReplayCache = null;
let sharedCallerReplayCache = null;
async function verifyInvocationFromHeaders(headers = {}, bodyObject) {
  const raw = headers[INVOCATION_TOKEN_HEADER] || headers[INVOCATION_TOKEN_HEADER.toLowerCase()];
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'missing invocation token' };
  }
  const wire = await loadWireVerify();
  if (!wire) {
    return { ok: false, reason: 'wire-verify module unavailable' };
  }
  const keyMaterial = readRouterPublicKeyMaterial();
  if (!keyMaterial) {
    return { ok: false, reason: 'router public key not configured' };
  }
  if (!sharedReplayCache) sharedReplayCache = wire.createMemoryReplayCache({ maxSize: 4096 });
  const audience = expectedAudienceForSelf();
  try {
    const { payload } = wire.verifyInvocationToken(raw.trim(), {
      routerPublicPem: keyMaterial.publicPem,
      routerPublicKeyJwk: keyMaterial.publicKeyJwk,
      expectedAudience: audience || undefined,
      bodyObject,
      replayCache: sharedReplayCache
    });
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
}

function readAgentPublicKeys() {
  const raw = String(process.env.PLOINKY_AGENT_PUBLIC_KEYS_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readHeaderValue(headers = {}, headerName) {
  const direct = headers[headerName];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const lower = headers[String(headerName).toLowerCase()];
  return typeof lower === 'string' && lower.trim() ? lower.trim() : '';
}

function buildDirectInvocationPayload({ callerAssertionPayload, userContextPayload }) {
  const delegatedUser = userContextPayload?.user && typeof userContextPayload.user === 'object'
    ? userContextPayload.user
    : null;
  return {
    iss: 'direct-agent-wire',
    sub: String(callerAssertionPayload?.iss || ''),
    aud: expectedAudienceForSelf(),
    tool: String(callerAssertionPayload?.tool || ''),
    scope: Array.isArray(callerAssertionPayload?.scope) ? [...callerAssertionPayload.scope] : [],
    body_hash: String(callerAssertionPayload?.body_hash || ''),
    jti: String(callerAssertionPayload?.jti || ''),
    iat: Number(callerAssertionPayload?.iat || 0),
    exp: Number(callerAssertionPayload?.exp || 0),
    user: delegatedUser ? { ...delegatedUser } : null,
    user_context_token: ''
  };
}

async function verifyDirectAgentRequest(headers = {}, bodyObject) {
  const callerAssertionToken = readHeaderValue(headers, CALLER_ASSERTION_HEADER);
  if (!callerAssertionToken) {
    return { ok: false, reason: 'missing caller assertion' };
  }
  const userContextToken = readHeaderValue(headers, USER_CONTEXT_HEADER);
  if (!userContextToken) {
    return { ok: false, reason: 'missing user context token' };
  }
  const wire = await loadWireVerify();
  if (!wire) {
    return { ok: false, reason: 'wire-verify module unavailable' };
  }
  const callerPublicKeys = readAgentPublicKeys();
  if (!sharedCallerReplayCache) {
    sharedCallerReplayCache = wire.createMemoryReplayCache({ maxSize: 4096 });
  }
  try {
    const callerAssertion = wire.verifyCallerAssertion(callerAssertionToken, {
      resolveCallerPublicKey: (principalId) => {
        const entry = callerPublicKeys[String(principalId || '').trim()];
        return entry?.publicKeyJwk ? { publicKeyJwk: entry.publicKeyJwk } : null;
      },
      replayCache: sharedCallerReplayCache,
      expectedAudience: expectedAudienceForSelf() || undefined,
      bodyObject
    });
    const keyMaterial = readRouterPublicKeyMaterial();
    if (!keyMaterial) {
      return { ok: false, reason: 'router public key not configured' };
    }
    const callerPrincipal = String(callerAssertion?.payload?.iss || '').trim();
    if (!callerPrincipal) {
      return { ok: false, reason: 'caller assertion missing issuer' };
    }
    const userContext = wire.verifyJws(userContextToken, {
      publicPem: keyMaterial.publicPem,
      publicKeyJwk: keyMaterial.publicKeyJwk,
      expectedAudience: callerPrincipal
    });
    const invocation = buildDirectInvocationPayload({
      callerAssertionPayload: callerAssertion.payload,
      userContextPayload: userContext.payload
    });
    invocation.user_context_token = userContextToken;
    return {
      ok: true,
      payload: invocation
    };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function loadSdkDeps() {
  const { types, streamHttp, mcp, zod } = await import('mcp-sdk');
  return {
    McpServer: mcp.McpServer,
    StreamableHTTPServerTransport: streamHttp.StreamableHTTPServerTransport,
    isInitializeRequest: types.isInitializeRequest,
    z: zod.z
  };
}

function resolveConfigPath() {
  const candidates = [
    process.env.DPU_MCP_CONFIG_PATH,
    process.env.MCP_CONFIG_FILE,
    path.join(process.cwd(), 'mcp-config.json')
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error('Unable to locate mcp-config.json for standalone DPU runtime.');
}

function loadConfig() {
  const configPath = resolveConfigPath();
  return {
    configPath,
    config: JSON.parse(fs.readFileSync(configPath, 'utf8'))
  };
}

function createLiteralUnionSchema(z, values) {
  const unique = [...new Set(Array.isArray(values) ? values : [])];
  if (!unique.length) {
    return null;
  }
  if (unique.length === 1) {
    return z.literal(unique[0]);
  }
  return z.union(unique.map((value) => z.literal(value)));
}

function createFieldSchema(z, fieldSpec) {
  if (typeof fieldSpec === 'string') {
    fieldSpec = { type: fieldSpec };
  }
  if (!fieldSpec || typeof fieldSpec !== 'object') {
    return z.any();
  }
  const type = typeof fieldSpec.type === 'string' ? fieldSpec.type.toLowerCase() : 'string';
  let schema;
  switch (type) {
    case 'string':
      schema = Array.isArray(fieldSpec.enum)
        ? (createLiteralUnionSchema(z, fieldSpec.enum) || z.string())
        : z.string();
      break;
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(createFieldSchema(z, fieldSpec.items ?? { type: 'string' }));
      break;
    case 'object':
      schema = z.object(buildObjectShape(z, fieldSpec.properties || {}));
      break;
    default:
      schema = z.any();
      break;
  }
  if (fieldSpec.optional) {
    schema = schema.optional();
  }
  if (fieldSpec.nullable) {
    schema = schema.nullable();
  }
  return schema;
}

function buildObjectShape(z, spec = {}) {
  const shape = {};
  for (const [key, value] of Object.entries(spec || {})) {
    shape[key] = createFieldSchema(z, value);
  }
  return shape;
}

function buildCommandSpec(entry) {
  const cwdBase = entry?.cwd === 'workspace'
    ? process.cwd()
    : (typeof entry?.cwd === 'string' && entry.cwd.trim() ? path.resolve(process.cwd(), entry.cwd) : process.cwd());
  const commandValue = typeof entry?.command === 'string' ? entry.command.trim() : '';
  if (!commandValue) {
    throw new Error(`Missing command for MCP tool "${entry?.name || ''}".`.trim());
  }
  return {
    command: path.isAbsolute(commandValue) ? commandValue : path.resolve(process.cwd(), commandValue),
    cwd: cwdBase,
    env: entry?.env && typeof entry.env === 'object' ? entry.env : {}
  };
}

function executeShell(spec, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, [], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
    child.stdin.end(`${JSON.stringify(payload ?? {})}\n`);
  });
}

async function registerTools(server, config) {
  const { z } = await loadSdkDeps();
  for (const tool of Array.isArray(config.tools) ? config.tools : []) {
    const commandSpec = buildCommandSpec(tool);
    const definition = {
      title: tool.title,
      description: tool.description
    };
    const invocation = async (...cbArgs) => {
      let args = cbArgs[0] ?? {};
      let context = cbArgs[1] ?? {};
      if (cbArgs.length === 1 && typeof args === 'object' && args !== null && args.requestId) {
        context = args;
        args = {};
      }
      const headers = context?.requestInfo?.headers || {};
      const bodyObject = { tool: tool.name, arguments: args || {} };

      // Router-signed invocation token: verify and attach the grant so the
      // DPU store layer can enforce call-time scope.
      const invocationResult = await verifyInvocationFromHeaders(headers, bodyObject);
      const directAuthResult = invocationResult.ok
        ? { ok: false, reason: 'invocation already verified' }
        : await verifyDirectAgentRequest(headers, bodyObject);
      let enrichedContext = context;
      if (invocationResult.ok) {
        enrichedContext = { ...context, invocation: invocationResult.payload };
      } else if (directAuthResult.ok) {
        enrichedContext = { ...context, invocation: directAuthResult.payload };
      } else {
        const reasons = [invocationResult.reason, directAuthResult.reason].filter(Boolean).join('; ');
        throw new Error(`Invocation rejected: ${reasons || 'secure wire verification failed'}`);
      }

      const result = await executeShell(commandSpec, {
        tool: tool.name,
        input: args,
        metadata: enrichedContext
      });
      if (result.code !== 0) {
        throw new Error(result.stderr?.trim() || `Tool ${tool.name} failed.`);
      }
      return {
        content: [{
          type: 'text',
          text: result.stdout || '{}'
        }]
      };
    };
    const registered = server.registerTool(tool.name, definition, invocation);
    registered.inputSchema = z.object(buildObjectShape(z, tool.inputSchema || {}));
  }
  if (typeof server.setToolRequestHandlers === 'function') {
    server.setToolRequestHandlers();
  }
}

async function createServerInstance() {
  const { McpServer } = await loadSdkDeps();
  const server = new McpServer({ name: 'dpu-agent', version: '0.1.0' });
  const { config } = loadConfig();
  await registerTools(server, config);
  return server;
}

async function main() {
  const { StreamableHTTPServerTransport, isInitializeRequest } = await loadSdkDeps();
  const port = Number.parseInt(String(process.env.PORT || '7000'), 10);
  const sessions = {};

  const serverHttp = http.createServer((req, res) => {
    const sendJson = (code, value) => {
      const payload = Buffer.from(JSON.stringify(value));
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      });
      res.end(payload);
    };

    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        return sendJson(200, { ok: true, server: 'dpu-agent' });
      }
      if (req.method !== 'POST' || requestUrl.pathname !== '/mcp') {
        return sendJson(404, { ok: false, error: 'Not found.' });
      }

      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }

        const sessionId = req.headers['mcp-session-id'];
        const existing = sessionId && sessions[sessionId] ? sessions[sessionId] : null;
        try {
          if (!existing) {
            if (!isInitializeRequest(body)) {
              return sendJson(400, { jsonrpc: '2.0', error: { code: -32000, message: 'Missing session; send initialize first' }, id: null });
            }
            const server = await createServerInstance();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              enableJsonResponse: true,
              onsessioninitialized: (sid) => {
                sessions[sid] = { server, transport };
              }
            });
            await server.connect(transport);
            transport.onclose = () => {
              try {
                server.close();
              } catch {
                // ignore close errors
              }
              if (transport.sessionId && sessions[transport.sessionId]) {
                delete sessions[transport.sessionId];
              }
            };
            await transport.handleRequest(req, res, body);
            return;
          }
          await existing.transport.handleRequest(req, res, body);
        } catch (error) {
          if (!res.headersSent) {
            sendJson(500, {
              jsonrpc: '2.0',
              error: { code: -32603, message: error?.message || 'Internal server error.' },
              id: null
            });
          }
        }
      });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(500, { ok: false, error: error?.message || 'Internal server error.' });
      }
    }
  });

  serverHttp.listen(port, () => {
    process.stdout.write(`DPU MCP server listening on ${port}\n`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
