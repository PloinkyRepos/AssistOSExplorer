import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

function resolveDataDir() {
  if (process.env.USERPERSISTO_DATA_DIR) return process.env.USERPERSISTO_DATA_DIR;
  if (fsSync.existsSync('/userpersisto-data')) return '/userpersisto-data';
  const workspaceRoot = String(process.env.PLOINKY_WORKSPACE_ROOT || process.env.WORKSPACE_PATH || '').trim();
  if (workspaceRoot) return path.join(workspaceRoot, '.ploinky', 'agents', 'userPersistoAgent');
  return '/userpersisto-data';
}

const DATA_DIR = resolveDataDir();

let PersistoClient;
let cachedPersistoClient = null;

function nowIso() {
  return new Date().toISOString();
}

function isConnectionError(error) {
  const message = String(error?.message || error || '');
  return /(fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up|network|Failed to fetch)/i.test(message);
}

function isEmptyPersistoSelectError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return code === 'ENOENT' || /ENOENT:.*\/[^/]+\.undefined\b/.test(message);
}

function matchesFilter(row = {}, filter = {}) {
  return Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
}

async function loadPersistoClientClass() {
  if (PersistoClient) return PersistoClient;
  const workspaceRoot = String(process.env.PLOINKY_WORKSPACE_ROOT || process.env.WORKSPACE_PATH || '').trim();
  const localCandidates = [
    path.join(DATA_DIR, 'Persisto', 'src', 'PersistoClient.cjs'),
    workspaceRoot ? path.join(workspaceRoot, '.ploinky', 'agents', 'userPersistoAgent', 'Persisto', 'src', 'PersistoClient.cjs') : '',
    '/code/Persisto/src/PersistoClient.cjs'
  ].filter(Boolean);
  for (const candidate of localCandidates) {
    try {
      if (!fsSync.existsSync(candidate)) continue;
      const module = await import(pathToFileURL(candidate).href);
      PersistoClient = module.default || module;
      return PersistoClient;
    } catch (_) {}
  }
  const candidates = [
    'achillesAgentLib/utils/PersistoClient.mjs',
    '/node_modules/achillesAgentLib/utils/PersistoClient.mjs'
  ];
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      PersistoClient = module.default || module;
      return PersistoClient;
    } catch (_) {}
  }
  return null;
}

async function getPersistoClient() {
  if (cachedPersistoClient) return cachedPersistoClient;
  const Client = await loadPersistoClientClass();
  if (!Client) {
    throw new Error('PersistoClient is required for UserPersisto storage but was not found.');
  }
  const url = process.env.PERSISTO_URL || `http://${process.env.PERSISTO_HOST || 'localhost'}:${process.env.PERSISTO_PORT || '3000'}`;
  const client = new Client(url);
  try {
    await client.execute('select', 'user', {}, { limit: 1 });
    cachedPersistoClient = client;
    return client;
  } catch (error) {
    if (isConnectionError(error)) {
      throw new Error(`Persisto storage is required but is not reachable at ${url}: ${error?.message || error}`);
    }
    cachedPersistoClient = client;
    return client;
  }
}

export class UserPersistoStore {
  async select(table, filter = {}, options = {}) {
    const client = await getPersistoClient();
    let result;
    try {
      result = await client.execute('select', table, filter, options || {});
    } catch (error) {
      if (isEmptyPersistoSelectError(error)) return [];
      throw error;
    }
    const rows = Array.isArray(result) ? result : (result?.objects || []);
    return Object.keys(filter || {}).length ? rows.filter((row) => matchesFilter(row, filter)) : rows;
  }

  async selectAll(table, options = {}) {
    const rows = await this.select(table, {}, options || {});
    return Array.isArray(rows) ? rows : [];
  }

  async findOne(table, predicate, options = {}) {
    const rows = await this.selectAll(table, options);
    return rows.find(predicate) || null;
  }

  async selectOne(table, filter = {}) {
    const rows = await this.select(table, filter, { limit: 1 });
    return rows[0] || null;
  }

  async create(table, data = {}) {
    const record = {
      id: data.id || crypto.randomUUID(),
      ...data,
      createdAt: data.createdAt || nowIso(),
      updatedAt: data.updatedAt || nowIso()
    };
    const client = await getPersistoClient();
    const method = `create${table.charAt(0).toUpperCase()}${table.slice(1)}`;
    return client.execute(method, record);
  }

  async configureTypes(types = {}) {
    const client = await getPersistoClient();
    try {
      await client.addType(types);
    } catch (error) {
      const message = String(error?.message || error || '');
      if (!/Function \w+ already exists|Refusing to overwrite/i.test(message)) throw error;
    }
    return true;
  }

  async configureIndexes(indexes = {}) {
    const client = await getPersistoClient();
    for (const [table, field] of Object.entries(indexes || {})) {
      try {
        await client.execute('createIndex', table, field);
      } catch (error) {
        const message = String(error?.message || error || '');
        if (!/already exists/i.test(message)) throw error;
      }
    }
    return true;
  }

  async update(table, id, patch = {}) {
    const client = await getPersistoClient();
    const method = `update${table.charAt(0).toUpperCase()}${table.slice(1)}`;
    return client.execute(method, id, { ...patch, updatedAt: nowIso() });
  }

  async delete(table, id) {
    const client = await getPersistoClient();
    const method = `delete${table.charAt(0).toUpperCase()}${table.slice(1)}`;
    return client.execute(method, id);
  }

  async appendAudit(action, details = {}) {
    return this.create('auditEvent', {
      action,
      actorUserId: details.actorUserId || '',
      targetType: details.targetType || '',
      targetId: details.targetId || '',
      metadata: details.metadata || {},
      createdAt: nowIso()
    });
  }
}

let storeInstance;

export function getUserPersistoStore() {
  if (!storeInstance) storeInstance = new UserPersistoStore();
  return storeInstance;
}

export function resetUserPersistoStore() {
  storeInstance = null;
  cachedPersistoClient = null;
}
