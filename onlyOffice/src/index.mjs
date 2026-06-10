import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.mjs';
import { createEditorProxy as defaultCreateEditorProxy } from './proxy/editor-proxy.mjs';
import { createControlRouteHandler as defaultCreateControlRouteHandler } from './routes/control.mjs';
import { createStorageRouteHandler as defaultCreateStorageRouteHandler } from './routes/storage.mjs';
import { createSessionStore } from './session-store.mjs';
import { createDpuStore as defaultCreateDpuStore } from './storage/dpu-store.mjs';
import { createStorageRouter as defaultCreateStorageRouter } from './storage/router.mjs';
import { createWorkspaceStore as defaultCreateWorkspaceStore } from './storage/workspace-store.mjs';

function requireWorkspaceRoot(env) {
  const workspaceRoot = String(env?.PLOINKY_WORKSPACE_ROOT || '').trim();
  if (!workspaceRoot) {
    throw new Error('PLOINKY_WORKSPACE_ROOT is required.');
  }
  return workspaceRoot;
}

async function createAgentClient(...args) {
  const modulePath = String(process.env.ONLYOFFICE_AGENT_CLIENT_MODULE || '/Agent/client/AgentMcpClient.mjs').trim();
  const module = await import(modulePath);
  return module.createAgentClient(...args);
}

function sendNotFound(res) {
  res.statusCode = 404;
  res.end('Not found.');
}

function sendInternalError(res) {
  if (!res.headersSent) {
    res.statusCode = 500;
  }
  if (!res.writableEnded) {
    res.end('Internal server error.');
  }
}

function createRequestListener(handler, { parseUrl = false } = {}) {
  return async function onRequest(req, res) {
    try {
      const handled = parseUrl
        ? await handler(req, res, new URL(req.url, 'http://127.0.0.1'))
        : await handler(req, res);
      if (handled === false && !res.writableEnded) {
        sendNotFound(res);
      }
    } catch (error) {
      console.error('[onlyoffice] request handling failed', error);
      sendInternalError(res);
    }
  };
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off?.('error', onError);
      reject(error);
    };
    server.on?.('error', onError);
    server.listen(port, host, () => {
      server.off?.('error', onError);
      resolve();
    });
  });
}

async function closeServer(server) {
  if (!server || typeof server.close !== 'function') {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function normalizeOutgoingHeaders(headers = {}, targetUrl) {
  const outgoing = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    outgoing[name] = value;
  }
  outgoing.host = targetUrl.host;
  return outgoing;
}

function applyResponseHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      res.setHeader(name, value.map((item) => String(item)));
      continue;
    }
    res.setHeader(name, String(value));
  }
}

function createHttpForwarder({
  request = http.request,
  secureRequest = https.request,
} = {}) {
  return async function forwardHttp(plan, req, res) {
    const targetUrl = new URL(plan.targetUrl);
    const requestFn = targetUrl.protocol === 'https:' ? secureRequest : request;
    await new Promise((resolve, reject) => {
      const upstream = requestFn(targetUrl, {
        method: req.method || 'GET',
        headers: normalizeOutgoingHeaders(plan.headers, targetUrl),
      }, (upstreamRes) => {
        res.statusCode = upstreamRes.statusCode || 502;
        applyResponseHeaders(res, upstreamRes.headers || {});
        upstreamRes.on('error', reject);
        upstreamRes.on('end', resolve);
        upstreamRes.pipe(res);
      });

      upstream.on('error', reject);
      upstream.end();
    });
  };
}

function socketConnectorFor(targetUrl, { connect = net.connect, secureConnect = tls.connect } = {}) {
  const port = Number(targetUrl.port || (targetUrl.protocol === 'wss:' ? 443 : 80));
  return targetUrl.protocol === 'wss:'
    ? secureConnect({ host: targetUrl.hostname, port, servername: targetUrl.hostname })
    : connect({ host: targetUrl.hostname, port });
}

function appendHeaderLine(lines, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendHeaderLine(lines, name, item);
    }
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  lines.push(`${name}: ${String(value)}`);
}

function buildUpgradeRequest(targetUrl, headers = {}) {
  const lines = [
    `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1`,
  ];
  for (const [name, value] of Object.entries(headers)) {
    appendHeaderLine(lines, name, value);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function createUpgradeForwarder({
  connect = net.connect,
  secureConnect = tls.connect,
} = {}) {
  return async function forwardUpgrade(plan, req, socket, head) {
    const targetUrl = new URL(plan.targetUrl);
    const upstream = socketConnectorFor(targetUrl, { connect, secureConnect });
    await new Promise((resolve, reject) => {
      upstream.once('error', reject);
      socket.once('error', () => upstream.destroy());
      upstream.once('connect', () => {
        socket.pipe(upstream).pipe(socket);
        const requestText = buildUpgradeRequest(targetUrl, {
          ...normalizeOutgoingHeaders(plan.headers, targetUrl),
          connection: 'Upgrade',
          upgrade: 'websocket',
        });
        upstream.write(requestText);
        if (head?.length) {
          upstream.write(head);
        }
        resolve();
      });
    });
  };
}

function defaultDocumentServerCommand(env) {
  return String(env?.ONLYOFFICE_DOCUMENT_SERVER_COMMAND || '/bin/bash scripts/run-document-server-with-autoassembly.sh').trim();
}

function startDocumentServerProcess({
  env = process.env,
  spawnProcess = spawn,
  command = defaultDocumentServerCommand(env),
} = {}) {
  if (!command) {
    throw new Error('OnlyOffice document server command is required.');
  }

  const child = spawnProcess('/bin/bash', ['-lc', command], {
    env,
    stdio: 'inherit',
  });

  let stopped = false;
  return {
    child,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      if (child.exitCode !== null || child.signalCode) {
        return;
      }
      child.kill('SIGTERM');
      try {
        await once(child, 'exit');
      } catch (_) {}
    },
  };
}

export async function startOnlyOfficeAgent({
  env = process.env,
  createAgentClient: createAgentClientFn = createAgentClient,
  createHttpServer = http.createServer,
  createControlRouteHandler = defaultCreateControlRouteHandler,
  createStorageRouteHandler = defaultCreateStorageRouteHandler,
  createWorkspaceStore = defaultCreateWorkspaceStore,
  createDpuStore = defaultCreateDpuStore,
  createStorageRouter = defaultCreateStorageRouter,
  createEditorProxy = defaultCreateEditorProxy,
  startDocumentServer = startDocumentServerProcess,
} = {}) {
  const config = loadConfig(env);
  const sessionStore = createSessionStore({
    idleTtlMs: config.sessionIdleTtlMs,
  });
  const workspaceStore = createWorkspaceStore({
    workspaceRoot: requireWorkspaceRoot(env),
  });
  const dpuStore = createDpuStore({
    createAgentClient: createAgentClientFn,
  });
  const storageRouter = createStorageRouter({
    workspaceStore,
    dpuStore,
  });
  const controlHandler = createControlRouteHandler({
    env,
    config,
    sessionStore,
    storageRouter,
  });
  const storageHandler = createStorageRouteHandler({
    config,
    sessionStore,
    storageRouter,
  });
  const editorProxy = createEditorProxy({
    targetBaseUrl: config.internalDocumentServerBaseUrl,
    forwardHttp: createHttpForwarder(),
    forwardUpgrade: createUpgradeForwarder(),
  });
  const controlServer = createHttpServer(createRequestListener(controlHandler, { parseUrl: true }));
  const storageServer = createHttpServer(createRequestListener(storageHandler));
  const editorServer = createHttpServer(createRequestListener(editorProxy.handle));
  editorServer.on?.('upgrade', (req, socket, head) => {
    Promise.resolve(editorProxy.handleUpgrade(req, socket, head))
      .catch(() => socket.destroy());
  });

  const documentServerProcess = startDocumentServer({
    env,
  });

  try {
    await listen(controlServer, config.controlPort, '0.0.0.0');
    await listen(storageServer, config.storagePort, '127.0.0.1');
    await listen(editorServer, config.editorPort, '0.0.0.0');
  } catch (error) {
    await Promise.allSettled([
      closeServer(editorServer),
      closeServer(storageServer),
      closeServer(controlServer),
      documentServerProcess?.stop?.(),
    ]);
    throw error;
  }

  let stopped = false;
  return {
    config,
    sessionStore,
    workspaceStore,
    dpuStore,
    storageRouter,
    controlServer,
    storageServer,
    editorServer,
    documentServerProcess,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await Promise.allSettled([
        closeServer(editorServer),
        closeServer(storageServer),
        closeServer(controlServer),
        documentServerProcess?.stop?.(),
      ]);
    },
  };
}

const isDirectRun = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch (_) {
    return false;
  }
})();

if (isDirectRun) {
  const runtime = await startOnlyOfficeAgent();
  const stopAndExit = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', stopAndExit);
  process.on('SIGTERM', stopAndExit);
  await new Promise(() => {});
}

export default {
  startOnlyOfficeAgent,
};
