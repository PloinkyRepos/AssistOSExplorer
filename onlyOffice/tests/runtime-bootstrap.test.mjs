import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { startOnlyOfficeAgent } from '../src/index.mjs';

function createServerFactory() {
  const records = [];
  return {
    records,
    createHttpServer(handler) {
      const emitter = new EventEmitter();
      const record = {
        handler,
        listens: [],
        closed: false,
      };
      const server = Object.assign(emitter, {
        listen(port, host, callback) {
          record.listens.push({ port, host });
          callback?.();
          return server;
        },
        close(callback) {
          record.closed = true;
          callback?.();
        },
      });
      records.push(record);
      return server;
    },
  };
}

test('onlyoffice agent runtime starts control storage and editor listeners with separated ports', async () => {
  const env = {
    ONLYOFFICE_JWT_SECRET: 'jwt-secret',
    ONLYOFFICE_PUBLIC_URL: 'http://office.localhost:8081',
    ONLYOFFICE_CONTROL_PORT: '17000',
    ONLYOFFICE_STORAGE_PORT: '19100',
    ONLYOFFICE_EDITOR_PORT: '18080',
    PLOINKY_WORKSPACE_ROOT: '/tmp/workspace',
  };
  const serverFactory = createServerFactory();
  const calls = {
    control: null,
    workspace: null,
    dpu: null,
    router: null,
    storage: null,
    editor: null,
    documentServerStarts: 0,
    documentServerStops: 0,
  };
  const controlHandler = () => true;
  const storageHandler = () => true;
  const editorHandler = () => {};
  const editorUpgradeHandler = () => {};

  const runtime = await startOnlyOfficeAgent({
    env,
    createHttpServer: serverFactory.createHttpServer,
    createControlRouteHandler(args) {
      calls.control = args;
      return controlHandler;
    },
    createWorkspaceStore(args) {
      calls.workspace = args;
      return { kind: 'workspace-store' };
    },
    createDpuStore(args) {
      calls.dpu = args;
      return { kind: 'dpu-store' };
    },
    createStorageRouter(args) {
      calls.router = args;
      return { kind: 'storage-router' };
    },
    createStorageRouteHandler(args) {
      calls.storage = args;
      return storageHandler;
    },
    createEditorProxy(args) {
      calls.editor = args;
      return {
        handle: editorHandler,
        handleUpgrade: editorUpgradeHandler,
      };
    },
    startDocumentServer() {
      calls.documentServerStarts += 1;
      return {
        async stop() {
          calls.documentServerStops += 1;
        },
      };
    },
  });

  assert.equal(calls.documentServerStarts, 1);
  assert.equal(serverFactory.records.length, 3);
  assert.deepEqual(serverFactory.records.map((record) => record.listens[0]), [
    { port: 17000, host: '0.0.0.0' },
    { port: 19100, host: '127.0.0.1' },
    { port: 18080, host: '0.0.0.0' },
  ]);
  assert.equal(calls.workspace.workspaceRoot, '/tmp/workspace');
  assert.equal(calls.control.config.controlPort, 17000);
  assert.equal(calls.control.config.publicEditorBaseUrl, 'http://office.localhost:8081');
  assert.equal(calls.storage.storageRouter.kind, 'storage-router');
  assert.equal(calls.editor.targetBaseUrl, 'http://127.0.0.1:80');
  assert.equal(typeof calls.editor.forwardHttp, 'function');
  assert.equal(typeof calls.editor.forwardUpgrade, 'function');
  assert.deepEqual(calls.router, {
    workspaceStore: { kind: 'workspace-store' },
    dpuStore: { kind: 'dpu-store' },
  });
  assert.equal(calls.dpu.createAgentClient.name, 'createAgentClient');

  await runtime.stop();

  assert.equal(calls.documentServerStops, 1);
  assert.equal(serverFactory.records.every((record) => record.closed), true);
});

test('onlyoffice agent runtime requires an explicit workspace root', async () => {
  await assert.rejects(
    () => startOnlyOfficeAgent({
      env: {
        ONLYOFFICE_JWT_SECRET: 'jwt-secret',
        ONLYOFFICE_PUBLIC_URL: 'http://office.localhost:8081',
      },
      createWorkspaceStore() {
        throw new Error('workspace root fallback was used');
      },
      startDocumentServer() {
        throw new Error('document server should not start');
      },
    }),
    /PLOINKY_WORKSPACE_ROOT is required/
  );
});
