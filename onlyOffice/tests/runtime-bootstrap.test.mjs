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
    assertImageContract() {},
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
      },
      assertImageContract() {},
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

test('failed drain keeps storage and DocumentServer alive and reports failure', async () => {
  const serverFactory = createServerFactory();
  let documentServerStops = 0;
  const runtime = await startOnlyOfficeAgent({
    env: {
      ONLYOFFICE_JWT_SECRET: 'jwt-secret',
      PLOINKY_WORKSPACE_ROOT: '/tmp/workspace',
    },
    assertImageContract() {},
    createHttpServer: serverFactory.createHttpServer,
    createControlRouteHandler: () => () => true,
    createStorageRouteHandler: () => () => true,
    createWorkspaceStore: () => ({}),
    createDpuStore: () => ({}),
    createStorageRouter: () => ({}),
    createEditorProxy: () => ({ handle() {}, handleUpgrade() {} }),
    startDocumentServer: () => ({
      async stop() {
        documentServerStops += 1;
      },
    }),
    drainOnlyOfficeSessions: async () => {
      throw new Error('callback acknowledgement missing');
    },
  });

  await assert.rejects(() => runtime.stop(), /callback acknowledgement missing/);
  assert.equal(serverFactory.records[0].closed, true, 'control listener stops admitting new sessions');
  assert.equal(serverFactory.records[2].closed, true, 'editor listener stops admitting new sessions');
  assert.equal(serverFactory.records[1].closed, false, 'callback storage remains live');
  assert.equal(documentServerStops, 0, 'DocumentServer remains live for a retry');
});

test('active editor socket cannot block force-save drain before targeted restart', async () => {
  const records = [];
  const activeSocket = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy() {
      this.destroyed = true;
      this.emit('close');
      records[2].finishClose?.();
    },
  });
  let drained = false;
  const runtime = await startOnlyOfficeAgent({
    env: {
      ONLYOFFICE_JWT_SECRET: 'jwt-secret',
      PLOINKY_WORKSPACE_ROOT: '/tmp/workspace',
    },
    assertImageContract() {},
    createHttpServer(handler) {
      const emitter = new EventEmitter();
      const index = records.length;
      const record = { handler, closeStarted: false, closeFinished: false };
      const server = Object.assign(emitter, {
        listen(_port, _host, callback) {
          callback?.();
          return server;
        },
        close(callback) {
          record.closeStarted = true;
          if (index !== 2) {
            record.closeFinished = true;
            callback?.();
            return;
          }
          record.finishClose = () => {
            record.closeFinished = true;
            callback?.();
          };
        },
      });
      records.push(record);
      return server;
    },
    createControlRouteHandler: () => () => true,
    createStorageRouteHandler: () => () => true,
    createWorkspaceStore: () => ({}),
    createDpuStore: () => ({}),
    createStorageRouter: () => ({}),
    createEditorProxy: () => ({ handle() {}, handleUpgrade() {} }),
    startDocumentServer: () => ({ async stop() {} }),
    drainOnlyOfficeSessions: async () => {
      assert.equal(records[0].closeStarted, true, 'control no longer accepts new work');
      assert.equal(records[2].closeStarted, true, 'editor no longer accepts new work');
      assert.equal(records[2].closeFinished, false, 'active WebSocket still delays close callback');
      assert.equal(activeSocket.destroyed, false, 'editor stays connected through force-save acknowledgement');
      drained = true;
    },
  });
  runtime.editorServer.emit('connection', activeSocket);

  await runtime.stop();

  assert.equal(drained, true);
  assert.equal(activeSocket.destroyed, true);
  assert.equal(records[2].closeFinished, true);
});
