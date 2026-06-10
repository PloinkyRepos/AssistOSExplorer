import {
  isDpuSecretPath,
  isDpuVirtualPath
} from './dpu-paths.mjs';

function wrapBackend(store, session) {
  return {
    metadata: async () => {
      if (typeof store?.metadata === 'function') {
        return store.metadata(session);
      }
      return session;
    },
    read: async () => store.read(session),
    write: async (buffer) => store.write(session, buffer)
  };
}

export function createStorageRouter({ workspaceStore, dpuStore } = {}) {
  if (!workspaceStore || !dpuStore) {
    throw new Error('Storage router requires workspaceStore and dpuStore.');
  }

  function forSession(session) {
    const requestedPath = String(session?.requestedPath || session?.path || '');
    if (isDpuSecretPath(requestedPath)) {
      throw new Error('OnlyOffice preview is not available for secrets.');
    }
    if (String(session?.storageKind || '').trim() === 'dpu' || isDpuVirtualPath(requestedPath)) {
      return wrapBackend(dpuStore, session);
    }
    return wrapBackend(workspaceStore, session);
  }

  return {
    forSession
  };
}
