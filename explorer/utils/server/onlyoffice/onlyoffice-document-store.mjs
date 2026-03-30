import path from 'node:path';
import { createOnlyOfficeDpuClient } from './onlyoffice-dpu-client.mjs';
import { getOnlyOfficeMimeType, isOnlyOfficeFile } from './file-types.mjs';
import {
  DPU_MY_SPACE_PATH,
  DPU_SHARED_PATH,
  isDpuSecretPath,
  isDpuVirtualPath,
  normalizeDpuPath
} from '../../../services/dpu/dpuPaths.js';
import { resolveDpuConfidentialNodeAtPath } from '../../../services/dpu/dpuPathResolver.js';
import { isDpuFileType } from '../../../services/dpu/dpuTypes.js';

async function resolveDpuNodeForPath(client, requestedPath) {
  const normalizedPath = normalizeDpuPath(requestedPath);
  if (normalizedPath === DPU_MY_SPACE_PATH) {
    const roots = await client.callTool('dpu_workspace_roots', {});
    return {
      id: roots?.roots?.mySpace?.id || '',
      type: 'folder',
      name: 'My Space'
    };
  }
  if (normalizedPath === DPU_SHARED_PATH) {
    return {
      id: '',
      type: 'folder',
      name: 'Shared'
    };
  }
  return resolveDpuConfidentialNodeAtPath(normalizedPath, {
    getRoots: async () => (await client.callTool('dpu_workspace_roots', {}))?.roots || {},
    listConfidential: async (args) => client.callTool('dpu_confidential_list', args)
  });
}

function decodeDpuOfficeContent(content) {
  return Buffer.from(String(content || ''), 'base64');
}

export function createOnlyOfficeDocumentStore({
  fs,
  workspaceRoot,
  validatePath,
  invalidateCachesForPath
}) {
  async function describeWorkspaceFile(requestedPath) {
    const validPath = await validatePath(requestedPath);
    const stat = await fs.stat(validPath);
    if (!stat.isFile()) {
      throw new Error('OnlyOffice preview is available only for files.');
    }
    const fileName = path.basename(validPath);
    if (!isOnlyOfficeFile(fileName)) {
      throw new Error('File type is not supported by OnlyOffice.');
    }
    return {
      storageKind: 'workspace',
      storageId: validPath,
      validPath,
      fileName,
      mimeType: getOnlyOfficeMimeType(fileName),
      canWrite: true,
      canComment: false,
      objectId: null,
      versionKey: `${Math.round(stat.mtimeMs)}:${stat.size}`
    };
  }

  async function describeDpuFile(requestedPath, authInfo) {
    if (isDpuSecretPath(requestedPath)) {
      throw new Error('OnlyOffice preview is not available for secrets.');
    }

    const client = createOnlyOfficeDpuClient({ workspaceRoot, authInfo });
    try {
      const node = await resolveDpuNodeForPath(client, requestedPath);
      if (!node?.id) {
        throw new Error(`Confidential file not found: ${requestedPath}`);
      }

      const parsed = await client.callTool('dpu_confidential_get', { id: node.id });
      const objectRecord = parsed?.object || {};
      if (!isDpuFileType(objectRecord.type, node.type)) {
        throw new Error(`Confidential path is not a file: ${requestedPath}`);
      }
      const fileName = String(objectRecord.name || path.basename(String(requestedPath || '')));
      if (!isOnlyOfficeFile(fileName)) {
        throw new Error('Confidential file type is not supported by OnlyOffice.');
      }
      if (!objectRecord.contentVisible) {
        throw new Error('You do not have read access to this Confidential document.');
      }

      return {
        storageKind: 'dpu',
        storageId: String(objectRecord.id || node.id),
        objectId: String(objectRecord.id || node.id),
        fileName,
        mimeType: getOnlyOfficeMimeType(fileName, objectRecord.mimeType || ''),
        canWrite: Boolean(objectRecord.canWrite),
        canComment: Boolean(objectRecord.canComment),
        requestedPath: normalizeDpuPath(requestedPath),
        versionKey: String(objectRecord.updatedAt || objectRecord.id || node.id)
      };
    } finally {
      await client.close();
    }
  }

  async function createSessionDescriptor({ requestedPath, authInfo }) {
    if (!requestedPath) {
      throw new Error('OnlyOffice session requires a file path.');
    }
    if (isDpuVirtualPath(requestedPath)) {
      return describeDpuFile(requestedPath, authInfo);
    }
    return describeWorkspaceFile(requestedPath);
  }

  async function readSessionContent(session) {
    if (session.storageKind === 'workspace') {
      const buffer = await fs.readFile(session.validPath);
      return {
        buffer,
        mimeType: session.mimeType,
        fileName: session.fileName
      };
    }

    const client = createOnlyOfficeDpuClient({ workspaceRoot, authInfo: session.authInfo });
    try {
      const parsed = await client.callTool('dpu_confidential_get', { id: session.objectId });
      const objectRecord = parsed?.object || {};
      if (!objectRecord.contentVisible) {
        throw new Error('Confidential document is not readable.');
      }
      return {
        buffer: decodeDpuOfficeContent(objectRecord.content),
        mimeType: getOnlyOfficeMimeType(session.fileName, objectRecord.mimeType || session.mimeType),
        fileName: session.fileName
      };
    } finally {
      await client.close();
    }
  }

  async function saveSessionContent(session, buffer) {
    if (!session.canWrite) {
      throw new Error('Document is read-only.');
    }

    if (session.storageKind === 'workspace') {
      await fs.writeFile(session.validPath, buffer);
      invalidateCachesForPath(session.validPath);
      return;
    }

    const client = createOnlyOfficeDpuClient({ workspaceRoot, authInfo: session.authInfo });
    try {
      await client.callTool('dpu_confidential_update', {
        id: session.objectId,
        content: Buffer.from(buffer).toString('base64'),
        mimeType: session.mimeType
      });
    } finally {
      await client.close();
    }
  }

  return {
    createSessionDescriptor,
    readSessionContent,
    saveSessionContent
  };
}

