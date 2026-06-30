import fsSync from 'node:fs';
import fs from 'node:fs/promises';
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
const STORE_FILE = path.join(DATA_DIR, 'userpersisto-store.json');
const TABLES = [
  'user',
  'session',
  'ssoLoginRequest',
  'ssoAuthCode',
  'emailAuthCode',
  'webauthnChallenge',
  'passkeyCredential',
  'totpSecret',
  'creditLedgerEntry',
  'subscription',
  'auditEvent',
  'agentSetting'
];

let PersistoClient;
let cachedPersistoClient = null;

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isConnectionError(error) {
  const message = String(error?.message || error || '');
  return /(fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up|network|Failed to fetch)/i.test(message);
}

function isEmptyPersistoSelectError(error) {
  const message = String(error?.message || error || '');
  return /ENOENT:.*\/[A-Za-z0-9._-]+\.undefined\b/.test(message);
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
  if (process.env.USERPERSISTO_STORAGE === 'file') return null;
  if (cachedPersistoClient) return cachedPersistoClient;
  const Client = await loadPersistoClientClass();
  if (!Client) return null;
  const url = process.env.PERSISTO_URL || `http://${process.env.PERSISTO_HOST || 'localhost'}:${process.env.PERSISTO_PORT || '3000'}`;
  const client = new Client(url);
  try {
    await client.execute('select', 'user', {}, { limit: 1 });
    cachedPersistoClient = client;
    return client;
  } catch (error) {
    if (isConnectionError(error)) return null;
    cachedPersistoClient = client;
    return client;
  }
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const store = parsed && typeof parsed === 'object' ? parsed : {};
    for (const table of TABLES) {
      if (!Array.isArray(store[table])) store[table] = [];
    }
    return store;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return Object.fromEntries(TABLES.map((table) => [table, []]));
  }
}

async function writeFileStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmpFile, STORE_FILE);
}

function matchesFilter(record, filter = {}) {
  return Object.entries(filter || {}).every(([key, value]) => {
    if (value === undefined || value === null || value === '') return true;
    return record?.[key] === value;
  });
}

function applyQueryOptions(rows, options = {}) {
  let result = rows;
  if (options?.sortBy) {
    const field = options.sortBy;
    result = result.sort((a, b) => String(a?.[field] || '').localeCompare(String(b?.[field] || '')));
  }
  if (Number.isFinite(options?.limit)) {
    result = result.slice(0, Math.max(0, Math.floor(options.limit)));
  }
  return result;
}

function getRecordId(table, record) {
  return record?.id || record?.[`${table}Id`] || record?.userId || record?.email;
}

async function readPersistoFsRows(table, filter = {}, options = {}) {
  const persistenceFolder = String(
    process.env.PERSISTENCE_FOLDER || path.join(DATA_DIR, 'persisto-data', 'work_space_data')
  ).trim();
  const prefix = table.toUpperCase().slice(0, 7);
  let names = [];
  try {
    names = await fs.readdir(persistenceFolder);
  } catch (_) {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (!name.startsWith(`${prefix}.`)) continue;
    try {
      const row = JSON.parse(await fs.readFile(path.join(persistenceFolder, name), 'utf8'));
      if (matchesFilter(row, filter)) rows.push(row);
    } catch (_) {}
  }
  return applyQueryOptions(rows, options);
}

export class UserPersistoStore {
  async select(table, filter = {}, options = {}) {
    const client = await getPersistoClient();
    if (client) {
      try {
        const result = await client.execute('select', table, filter, options || {});
        return Array.isArray(result) ? result : (result?.objects || []);
      } catch (error) {
        if (isEmptyPersistoSelectError(error)) return readPersistoFsRows(table, filter, options);
        if (!isConnectionError(error)) throw error;
      }
    }
    const store = await readFileStore();
    const rows = (store[table] || []).filter((record) => matchesFilter(record, filter));
    return clone(applyQueryOptions(rows, options));
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
    if (client) {
      const method = `create${table.charAt(0).toUpperCase()}${table.slice(1)}`;
      try {
        return await client.execute(method, record);
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }
    const store = await readFileStore();
    store[table] ||= [];
    store[table].push(record);
    await writeFileStore(store);
    return clone(record);
  }

  async configureTypes(types = {}) {
    const client = await getPersistoClient();
    if (!client) return false;
    await client.addType(types);
    return true;
  }

  async update(table, id, patch = {}) {
    const client = await getPersistoClient();
    if (client) {
      try {
        const method = `update${table.charAt(0).toUpperCase()}${table.slice(1)}`;
        return await client.execute(method, id, { ...patch, updatedAt: nowIso() });
      } catch (error) {
        if (!isConnectionError(error)) throw error;
      }
    }
    const store = await readFileStore();
    const rows = store[table] || [];
    const index = rows.findIndex((record) => getRecordId(table, record) === id || record.id === id);
    if (index < 0) throw new Error(`${table} record not found.`);
    rows[index] = { ...rows[index], ...patch, updatedAt: nowIso() };
    await writeFileStore(store);
    return clone(rows[index]);
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
