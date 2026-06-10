import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { createWorkspacePathPolicy } from './path-policy.mjs';

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || '');
}

function buildVersionKey(stats, buffer) {
  const contentHash = crypto.createHash('sha256').update(buffer).digest('base64url');
  return [
    String(stats.size),
    String(Math.floor(stats.mtimeMs)),
    contentHash,
  ].join(':');
}

function tempFilePathFor(absolutePath) {
  const parsed = path.parse(absolutePath);
  const suffix = crypto.randomBytes(8).toString('hex');
  const fileName = parsed.ext
    ? `${parsed.name}.onlyoffice-tmp-${suffix}${parsed.ext}`
    : `${parsed.base}.onlyoffice-tmp-${suffix}`;
  return path.join(parsed.dir, fileName);
}

export function createWorkspaceStore({ workspaceRoot, pathPolicy = createWorkspacePathPolicy({ workspaceRoot }) } = {}) {
  return {
    async metadata(session = {}) {
      const resolved = await pathPolicy.resolve(session.path);
      const buffer = await fs.readFile(resolved.absolutePath);
      const stats = await fs.stat(resolved.absolutePath);
      return {
        ...resolved,
        storageKind: 'workspace',
        requestedPath: String(session.requestedPath || session.path || '').trim(),
        path: session.path,
        storageId: resolved.relativePath,
        fileName: path.posix.basename(resolved.relativePath),
        mimeType: String(session.mimeType || 'application/octet-stream'),
        canWrite: Boolean(session.canWrite ?? true),
        canComment: Boolean(session.canComment ?? true),
        versionKey: buildVersionKey(stats, buffer),
      };
    },

    async read(session = {}) {
      const resolved = await pathPolicy.resolve(session.path);
      const buffer = await fs.readFile(resolved.absolutePath);
      const stats = await fs.stat(resolved.absolutePath);
      return {
        ...resolved,
        storageKind: 'workspace',
        requestedPath: String(session.requestedPath || session.path || '').trim(),
        storageId: resolved.relativePath,
        fileName: path.posix.basename(resolved.relativePath),
        mimeType: String(session.mimeType || 'application/octet-stream'),
        buffer,
        versionKey: buildVersionKey(stats, buffer),
      };
    },

    async write(session = {}, buffer = Buffer.alloc(0)) {
      if (!session.canWrite) {
        throw new Error('Document is read-only.');
      }
      const resolved = await pathPolicy.resolve(session.path);
      const nextBuffer = asBuffer(buffer);
      const tempPath = tempFilePathFor(resolved.absolutePath);
      await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(tempPath, nextBuffer);
      await fs.rename(tempPath, resolved.absolutePath);
      const stats = await fs.stat(resolved.absolutePath);
      return {
        ...resolved,
        storageKind: 'workspace',
        requestedPath: String(session.requestedPath || session.path || '').trim(),
        storageId: resolved.relativePath,
        fileName: path.posix.basename(resolved.relativePath),
        mimeType: String(session.mimeType || 'application/octet-stream'),
        buffer: nextBuffer,
        versionKey: buildVersionKey(stats, nextBuffer),
      };
    },
  };
}

export default {
  createWorkspaceStore,
};
