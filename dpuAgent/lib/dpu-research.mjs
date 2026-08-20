import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { nowIso, normalizeName, normalizePrincipal } from './dpu-store-internal/common.mjs';
import { aclEntries, requireAuthenticatedActor } from './dpu-store-internal/identity-acl.mjs';
import {
  getPermissionAcl,
  removePermissionRole,
  resolvePrincipalReference,
  setPermissionRole,
  upsertPrincipalIdentity
} from './dpu-store-internal/permissions-manifest.mjs';
import {
  appendProvenanceEvent,
  getResourceMaterializationRoot,
  loadPermissionsManifest,
  loadState,
  readProvenanceEvents,
  readSecretsMap,
  savePermissionsManifest,
  saveState,
  withFileLock
} from './dpu-store-internal/storage.mjs';
import { createSourceAdapterRegistry, normalizeCapabilities, sanitizeProviderFacts } from './source-adapters/source-adapter.mjs';
import { createHuggingFaceAdapter } from './source-adapters/huggingface-adapter.mjs';
import { createEdcAdapter } from './source-adapters/edc-adapter.mjs';
import { validateFederatedExperiment } from './federated/federated-learning.mjs';
import { assessExperimentPrivacy } from './federated/privacy-assessment.mjs';
import { createNvFlareBackend } from './federated/nvflare-backend.mjs';

const EXECUTION_MODES = Object.freeze(['local', 'remote', 'secure', 'federated']);
const ACCESS_STATES = Object.freeze(['available', 'pending', 'blocked']);
const VISIBILITIES = Object.freeze(['private', 'shared']);
const RESOURCE_ROLES = Object.freeze(['access', 'read', 'write']);
const JOB_TYPES = Object.freeze(['discover', 'access', 'acquire', 'transfer', 'remote-execution', 'secure-execution', 'federated']);
const JOB_STATES = Object.freeze(['queued', 'awaiting-confirmation', 'running', 'succeeded', 'failed', 'cancelled']);
const ACTION_TYPES = Object.freeze(['accept-terms', 'request-access', 'negotiate-edc', 'share-resource', 'revoke-resource', 'secure-execution', 'federated-execution', 'release-output']);
const DEFAULT_ACTION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_FILE_READ_LENGTH = 64 * 1024;
const MAX_FILE_READ_LENGTH = 1024 * 1024;

const defaultAdapterRegistry = createSourceAdapterRegistry({
  huggingface: createHuggingFaceAdapter(),
  edc: createEdcAdapter()
});
const defaultComputeBackendRegistry = new Map([['nvflare', createNvFlareBackend()]]);

function nonEmpty(value, fieldName) {
  return normalizeName(value, fieldName);
}

function enumValue(value, allowed, fieldName, fallback = '') {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}.`);
  return normalized;
}

function stringList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function isAdmin(actor) {
  const roles = Array.isArray(actor?.roles) ? actor.roles.map((role) => String(role).toLowerCase()) : [];
  return roles.includes('admin') || String(actor?.id || '').toLowerCase() === 'local:admin' || String(actor?.username || '').toLowerCase() === 'admin';
}

function assertAdmin(actor) {
  if (!isAdmin(actor)) throw new Error('Access denied: DPU source management requires an admin role.');
}

function actorCandidates(actor) {
  return [...new Set([actor?.principalId, actor?.agentPrincipalId].map((value) => String(value || '').trim()).filter(Boolean))];
}

function isResourceExpired(resource, at = Date.now()) {
  const expiresAt = Date.parse(String(resource?.expiresAt || ''));
  return Number.isFinite(expiresAt) && expiresAt <= at;
}

function resourceRole(resource, actor, permissionsManifest) {
  if (resource.ownerId === actor.principalId) return 'write';
  const acl = getPermissionAcl(permissionsManifest, 'resource', resource.id) || {};
  let role = '';
  for (const principal of actorCandidates(actor)) {
    const candidate = String(acl[principal] || '').trim().toLowerCase();
    if (RESOURCE_ROLES.indexOf(candidate) > RESOURCE_ROLES.indexOf(role)) role = candidate;
  }
  return role;
}

function roleAllows(role, required) {
  return RESOURCE_ROLES.indexOf(role) >= RESOURCE_ROLES.indexOf(required);
}

function assertResourcePermission(resource, actor, permissionsManifest, required) {
  if (isResourceExpired(resource)) throw new Error('Access denied: the research resource has expired.');
  const role = resourceRole(resource, actor, permissionsManifest);
  if (!role || !roleAllows(role, required)) throw new Error(`Access denied: resource ${required} permission is required.`);
  return role;
}

function assertSourceCredentialAccess(state, permissionsManifest, actor, source) {
  if (!source.secretRef) return;
  const secret = state.secrets[source.secretRef];
  if (!secret) throw new Error(`DPU secret not found: ${source.secretRef}`);
  if (secret.ownerId === actor.principalId || isAdmin(actor)) return;
  const acl = getPermissionAcl(permissionsManifest, 'secret', source.secretRef) || {};
  if (!actorCandidates(actor).some((principal) => ['access', 'write-access', 'read', 'write'].includes(String(acl[principal] || '').toLowerCase()))) {
    throw new Error('Access denied: source credential access is required.');
  }
}

function effectiveState(resource) {
  if (isResourceExpired(resource)) return 'blocked';
  if (resource.accessState === 'pending' || resource.accessState === 'blocked') return resource.accessState;
  if (resource.visibility === 'shared') return 'shared';
  return resource.executionMode;
}

function normalizeFair(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    persistentIdentifier: String(input.persistentIdentifier || '').trim(),
    metadataAvailable: Boolean(input.metadataAvailable),
    licenceAvailable: Boolean(input.licenceAvailable),
    machineReadableFormats: stringList(input.machineReadableFormats),
    citationAvailable: Boolean(input.citationAvailable),
    reuseInformation: String(input.reuseInformation || '').trim()
  };
}

function normalizeResource(payload = {}, actor, existing = null) {
  const timestamp = nowIso();
  if (!existing && payload.id !== undefined) {
    throw new Error('resource id is server-managed and must not be supplied when creating a resource.');
  }
  if (existing && payload.id !== undefined && String(payload.id).trim() !== existing.id) {
    throw new Error('resource id cannot be changed.');
  }
  const id = existing?.id || randomUUID();
  const executionMode = enumValue(payload.executionMode, EXECUTION_MODES, 'executionMode', existing?.executionMode || 'remote');
  const accessState = enumValue(payload.accessState, ACCESS_STATES, 'accessState', existing?.accessState || 'available');
  const visibility = enumValue(payload.visibility, VISIBILITIES, 'visibility', existing?.visibility || 'private');
  const provider = String(payload.provider ?? existing?.provider ?? '').trim().toLowerCase();
  const externalId = String(payload.externalId ?? existing?.externalId ?? '').trim();
  if (!provider) throw new Error('provider is required.');
  if (!externalId) throw new Error('externalId is required.');
  return {
    id,
    persistentId: String(payload.persistentId ?? existing?.persistentId ?? '').trim(),
    externalId,
    name: String(payload.name ?? existing?.name ?? externalId).trim(),
    resourceType: String(payload.resourceType ?? existing?.resourceType ?? 'dataset').trim().toLowerCase(),
    provider,
    sourceId: String(payload.sourceId ?? existing?.sourceId ?? '').trim(),
    version: String(payload.version ?? existing?.version ?? '').trim(),
    revision: String(payload.revision ?? existing?.revision ?? '').trim(),
    licence: String(payload.licence ?? existing?.licence ?? '').trim(),
    citation: String(payload.citation ?? existing?.citation ?? '').trim(),
    fair: normalizeFair(payload.fair ?? existing?.fair),
    accessConditions: sanitizeProviderFacts(payload.accessConditions ?? existing?.accessConditions ?? {}),
    intendedUse: String(payload.intendedUse ?? existing?.intendedUse ?? '').trim(),
    executionMode,
    accessState,
    visibility,
    expiresAt: String(payload.expiresAt ?? existing?.expiresAt ?? '').trim(),
    securityRestrictions: stringList(payload.securityRestrictions ?? existing?.securityRestrictions),
    checksum: String(payload.checksum ?? existing?.checksum ?? '').trim(),
    fileManifest: Array.isArray(payload.fileManifest ?? existing?.fileManifest) ? structuredClone(payload.fileManifest ?? existing.fileManifest) : [],
    materializationPath: String(payload.materializationPath ?? existing?.materializationPath ?? '').trim(),
    derivedResourceIds: stringList(payload.derivedResourceIds ?? existing?.derivedResourceIds),
    resultIds: stringList(payload.resultIds ?? existing?.resultIds),
    jobIds: stringList(payload.jobIds ?? existing?.jobIds),
    providerFacts: sanitizeProviderFacts(payload.providerFacts ?? existing?.providerFacts ?? {}),
    localToParticipant: Boolean(payload.localToParticipant ?? existing?.localToParticipant),
    rawDataExportAllowed: Boolean(payload.rawDataExportAllowed ?? existing?.rawDataExportAllowed),
    ownerId: existing?.ownerId || actor.principalId,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function serializeResource(resource, actor, permissionsManifest) {
  const role = resourceRole(resource, actor, permissionsManifest);
  const expired = isResourceExpired(resource);
  const canRead = Boolean(!expired && role && roleAllows(role, 'read'));
  const canWrite = Boolean(!expired && role && roleAllows(role, 'write'));
  const { materializationPath: _privateMaterializationPath, ...publicResource } = structuredClone(resource);
  return {
    ...publicResource,
    effectiveState: effectiveState(resource),
    expired,
    role,
    canRead,
    canWrite,
    aclVisible: canWrite,
    acl: canWrite ? aclEntries(getPermissionAcl(permissionsManifest, 'resource', resource.id) || {}) : [],
    providerFacts: canRead ? structuredClone(resource.providerFacts || {}) : {},
    location: resource.materializationPath ? `/Confidential/Research Data/${resource.id}` : ''
  };
}

function normalizeManifestPath(value, { allowRoot = false } = {}) {
  const raw = String(value || '').replaceAll('\\', '/').trim();
  if (!raw && allowRoot) return '';
  if (!raw || raw.includes('\0') || raw.startsWith('/')) {
    throw new Error('Resource file path must be a relative manifest path.');
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' && allowRoot) return '';
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Resource file path escapes the materialization root.');
  }
  return normalized;
}

function normalizedManifest(resource) {
  return (Array.isArray(resource?.fileManifest) ? resource.fileManifest : []).map((entry) => ({
    ...structuredClone(entry),
    path: normalizeManifestPath(entry?.path)
  }));
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json',
    '.jsonl': 'application/x-ndjson', '.txt': 'text/plain', '.md': 'text/markdown',
    '.parquet': 'application/vnd.apache.parquet', '.arrow': 'application/vnd.apache.arrow.file',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
  })[extension] || 'application/octet-stream';
}

async function resolveMaterializedFile(authInfo, id, requestedPath) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'read');
    if (!resource.materializationPath || resource.executionMode !== 'local') {
      throw new Error('Resource is not locally materialized.');
    }
    const relativePath = normalizeManifestPath(requestedPath);
    const manifestEntry = normalizedManifest(resource).find((entry) => entry.path === relativePath);
    if (!manifestEntry) throw new Error('Resource file is not present in the verified manifest.');
    return {
      value: {
        ok: true,
        resourceId: resource.id,
        relativePath,
        manifestEntry,
        materializationPath: resource.materializationPath
      }
    };
  });
}

async function openVerifiedMaterializedFile(resolved) {
  const root = await fs.realpath(resolved.materializationPath);
  const target = path.resolve(root, resolved.relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resource file path escapes the materialization root.');
  }
  const fileInfo = await fs.lstat(target);
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
    throw new Error('Resource manifest entry is not a regular file.');
  }
  const realTarget = await fs.realpath(target);
  const realRelative = path.relative(root, realTarget);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Resource file resolves outside the materialization root.');
  }
  return { target: realTarget, fileInfo };
}

function normalizeSource(payload = {}, existing = null) {
  const timestamp = nowIso();
  const type = String(payload.type ?? existing?.type ?? '').trim().toLowerCase();
  if (!type) throw new Error('source type is required.');
  const endpoint = String(payload.endpoint ?? existing?.endpoint ?? '').trim().replace(/\/$/, '');
  if (endpoint) {
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new Error('source endpoint must be an absolute HTTP(S) URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('source endpoint must be an HTTP(S) URL without credentials, query parameters, or fragments.');
    }
  }
  return {
    id: existing?.id || String(payload.id || randomUUID()).trim(),
    name: String(payload.name ?? existing?.name ?? type).trim(),
    type,
    endpoint,
    enabled: payload.enabled === undefined ? (existing?.enabled ?? true) : Boolean(payload.enabled),
    secretRef: String(payload.secretRef ?? existing?.secretRef ?? '').trim(),
    capabilities: normalizeCapabilities(payload.capabilities ?? existing?.capabilities),
    settings: sanitizeProviderFacts(payload.settings ?? existing?.settings ?? {}),
    connectionState: existing?.connectionState || { status: 'unknown', checkedAt: '', identity: '' },
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function normalizeComputeBackend(payload = {}, existing = null) {
  const timestamp = nowIso();
  const type = String(payload.type ?? existing?.type ?? '').trim().toLowerCase();
  if (!['nvflare', 'secure'].includes(type)) throw new Error('compute backend type must be nvflare or secure.');
  const enabledRequested = payload.enabled === undefined ? Boolean(existing?.enabled) : Boolean(payload.enabled);
  const connectionState = existing?.connectionState || { status: 'unknown', checkedAt: '', identity: '', version: '' };
  if (enabledRequested && connectionState.status !== 'connected') {
    throw new Error('Compute backend must pass its connection and identity test before it can be enabled.');
  }
  return {
    id: existing?.id || String(payload.id || randomUUID()).trim(),
    name: String(payload.name ?? existing?.name ?? type).trim(),
    type,
    enabled: enabledRequested,
    secretRef: String(payload.secretRef ?? existing?.secretRef ?? '').trim(),
    expectedIdentity: String(payload.expectedIdentity ?? existing?.expectedIdentity ?? '').trim(),
    attestationVerifier: String(payload.attestationVerifier ?? existing?.attestationVerifier ?? '').trim(),
    policyId: String(payload.policyId ?? existing?.policyId ?? '').trim(),
    settings: sanitizeProviderFacts(payload.settings ?? existing?.settings ?? {}),
    capabilities: Array.isArray(existing?.capabilities) ? [...existing.capabilities] : [],
    connectionState,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function serializeComputeBackend(backend, { admin = false } = {}) {
  const result = structuredClone(backend);
  if (!admin) {
    delete result.secretRef;
    delete result.settings;
    delete result.attestationVerifier;
    delete result.policyId;
  }
  result.available = Boolean(result.enabled && result.connectionState?.status === 'connected');
  return result;
}

async function computeBackendContext(authInfo, backendId, registry = defaultComputeBackendRegistry) {
  const snapshot = await withResearchState(authInfo, async ({ state }) => {
    const backend = state.computeBackends[nonEmpty(backendId, 'backendId')];
    if (!backend) throw new Error(`DPU compute backend not found: ${backendId}`);
    return { value: structuredClone(backend) };
  });
  const adapter = registry.get(snapshot.type);
  if (!adapter) throw new Error(`DPU compute backend adapter is unavailable: ${snapshot.type}`);
  const secrets = await readSecretsMap();
  const secretValue = snapshot.secretRef ? String(secrets[snapshot.secretRef] || '') : '';
  if (!secretValue) throw new Error('DPU compute backend credential is unavailable.');
  return { backend: snapshot, adapter, secretValue };
}

function createJob(type, actor, input = {}) {
  return {
    id: randomUUID(),
    type: enumValue(type, JOB_TYPES, 'job type'),
    state: 'queued',
    actorId: actor.principalId,
    resourceId: String(input.resourceId || '').trim(),
    sourceId: String(input.sourceId || '').trim(),
    backendId: String(input.backendId || '').trim(),
    externalJobId: String(input.externalJobId || '').trim(),
    actionProposalId: String(input.actionProposalId || '').trim(),
    idempotencyKey: String(input.idempotencyKey || randomUUID()).trim(),
    progress: 0,
    result: null,
    error: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: '',
    completedAt: '',
    stagingPath: '',
    workerPid: 0
  };
}

function serializeJob(job) {
  if (!job) return job;
  const { stagingPath: _privateStagingPath, workerPid: _privateWorkerPid, ...publicJob } = structuredClone(job);
  return publicJob;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function recoverInterruptedJobs(state) {
  let changed = false;
  for (const job of Object.values(state.jobs)) {
    if (job?.state !== 'running' || !['discover', 'acquire'].includes(job.type) || processIsAlive(Number(job.workerPid))) continue;
    if (job.stagingPath) await fs.rm(job.stagingPath, { recursive: true, force: true }).catch(() => {});
    job.state = 'failed';
    job.error = 'The local DPU worker stopped before the job completed; its staging area was cleaned deterministically.';
    job.stagingPath = '';
    job.workerPid = 0;
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    changed = true;
  }
  return changed;
}

function findIdempotentJob(state, actor, { type, resourceId = '', sourceId = '', idempotencyKey = '' }) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  return Object.values(state.jobs).find((job) => (
    job.idempotencyKey === key
    && job.actorId === actor.principalId
    && job.type === type
    && job.resourceId === String(resourceId || '').trim()
    && job.sourceId === String(sourceId || '').trim()
  )) || null;
}

function createProposal(type, actor, payload = {}) {
  const normalizedType = enumValue(type, ACTION_TYPES, 'action type');
  const createdAt = nowIso();
  return {
    id: randomUUID(),
    type: normalizedType,
    actorId: actor.principalId,
    status: 'pending',
    resourceId: String(payload.resourceId || '').trim(),
    sourceId: String(payload.sourceId || '').trim(),
    effects: stringList(payload.effects),
    parameters: sanitizeProviderFacts(payload.parameters || {}),
    createdAt,
    expiresAt: new Date(Date.now() + Math.max(60_000, Number(payload.ttlMs) || DEFAULT_ACTION_TTL_MS)).toISOString(),
    decidedAt: ''
  };
}

async function withResearchState(authInfo, worker, { admin = false } = {}) {
  return withFileLock(async () => {
    const state = await loadState();
    const recovered = await recoverInterruptedJobs(state);
    const permissionsManifest = await loadPermissionsManifest();
    const actor = requireAuthenticatedActor(authInfo, permissionsManifest);
    if (admin) assertAdmin(actor);
    if (upsertPrincipalIdentity(permissionsManifest, actor.principalId, { email: actor.email, username: actor.username, id: actor.id, roles: actor.roles })) {
      await savePermissionsManifest(permissionsManifest);
    }
    const result = await worker({ state, permissionsManifest, actor });
    if (result?.saveState || recovered) await saveState(state);
    if (result?.savePermissions) await savePermissionsManifest(permissionsManifest);
    return result?.value;
  });
}

async function sourceContext(authInfo, sourceId, registry = defaultAdapterRegistry, { admin = false } = {}) {
  const context = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const source = state.sources[sourceId];
    if (!source) throw new Error(`DPU source not found: ${sourceId}`);
    if (!source.enabled) throw new Error(`DPU source is disabled: ${sourceId}`);
    assertSourceCredentialAccess(state, permissionsManifest, actor, source);
    return { value: { source: structuredClone(source), actor } };
  }, { admin });
  const secrets = await readSecretsMap();
  const credential = context.source.secretRef ? String(secrets[context.source.secretRef] || '') : '';
  return { ...context, credential, adapter: registry.get(context.source.type) };
}

async function recordProvenance(authInfo, resourceId, payload) {
  const event = { id: randomUUID(), timestamp: nowIso(), resourceId, ...sanitizeProviderFacts(payload) };
  await appendProvenanceEvent(resourceId, event);
  await withResearchState(authInfo, async ({ state }) => {
    const index = Array.isArray(state.provenanceIndex[resourceId]) ? state.provenanceIndex[resourceId] : [];
    index.push({ id: event.id, timestamp: event.timestamp, relation: String(event.relation || '').trim(), jobId: String(event.jobId || '').trim() });
    state.provenanceIndex[resourceId] = index;
    return { saveState: true, value: event };
  });
  return event;
}

export async function listResources(authInfo = null, filters = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const items = Object.values(state.resources)
      .filter((resource) => resourceRole(resource, actor, permissionsManifest))
      .filter((resource) => !filters.effectiveState || effectiveState(resource) === filters.effectiveState)
      .filter((resource) => !filters.sourceId || resource.sourceId === filters.sourceId)
      .map((resource) => serializeResource(resource, actor, permissionsManifest))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { value: { ok: true, items } };
  });
}

export async function getResource(authInfo = null, { id } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'access');
    return { value: { ok: true, resource: serializeResource(resource, actor, permissionsManifest) } };
  });
}

export async function listResourceFiles(authInfo = null, { id, path: directory = '' } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'read');
    if (!resource.materializationPath || resource.executionMode !== 'local') {
      throw new Error('Resource is not locally materialized.');
    }
    const prefix = normalizeManifestPath(directory, { allowRoot: true });
    const direct = new Map();
    for (const entry of normalizedManifest(resource)) {
      if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) continue;
      const remainder = prefix ? entry.path.slice(prefix.length).replace(/^\//, '') : entry.path;
      if (!remainder) continue;
      const [name, ...rest] = remainder.split('/');
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (rest.length) direct.set(entryPath, { path: entryPath, name, type: 'directory' });
      else direct.set(entryPath, {
        path: entry.path,
        name,
        type: 'file',
        size: Number(entry.size) || 0,
        checksum: String(entry.checksum || ''),
        mimeType: String(entry.mimeType || mimeTypeFor(entry.path))
      });
    }
    return { value: { ok: true, resourceId: resource.id, path: prefix, items: [...direct.values()].sort((a, b) => a.path.localeCompare(b.path)) } };
  });
}

export async function statResourceFile(authInfo = null, { id, path: filePath } = {}) {
  const resolved = await resolveMaterializedFile(authInfo, id, filePath);
  if (!resolved.ok) return resolved;
  const { fileInfo } = await openVerifiedMaterializedFile(resolved);
  return {
    ok: true,
    resourceId: resolved.resourceId,
    file: {
      path: resolved.relativePath,
      type: 'file',
      size: fileInfo.size,
      checksum: String(resolved.manifestEntry.checksum || ''),
      mimeType: String(resolved.manifestEntry.mimeType || mimeTypeFor(resolved.relativePath))
    }
  };
}

export async function readResourceFile(authInfo = null, { id, path: filePath, offset = 0, length = DEFAULT_FILE_READ_LENGTH } = {}) {
  const resolved = await resolveMaterializedFile(authInfo, id, filePath);
  if (!resolved.ok) return resolved;
  const normalizedOffset = Number(offset);
  const normalizedLength = Number(length);
  if (!Number.isSafeInteger(normalizedOffset) || normalizedOffset < 0) throw new Error('offset must be a non-negative integer.');
  if (!Number.isSafeInteger(normalizedLength) || normalizedLength < 1 || normalizedLength > MAX_FILE_READ_LENGTH) {
    throw new Error(`length must be an integer between 1 and ${MAX_FILE_READ_LENGTH}.`);
  }
  const { target, fileInfo } = await openVerifiedMaterializedFile(resolved);
  const bytesToRead = Math.min(normalizedLength, Math.max(0, fileInfo.size - normalizedOffset));
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await fs.open(target, 'r');
  let bytesRead = 0;
  try {
    if (bytesToRead) ({ bytesRead } = await handle.read(buffer, 0, bytesToRead, normalizedOffset));
  } finally {
    await handle.close();
  }
  const nextOffset = normalizedOffset + bytesRead;
  return {
    ok: true,
    resourceId: resolved.resourceId,
    file: {
      path: resolved.relativePath,
      size: fileInfo.size,
      checksum: String(resolved.manifestEntry.checksum || ''),
      mimeType: String(resolved.manifestEntry.mimeType || mimeTypeFor(resolved.relativePath))
    },
    offset: normalizedOffset,
    bytesRead,
    nextOffset,
    eof: nextOffset >= fileInfo.size,
    encoding: 'base64',
    data: buffer.subarray(0, bytesRead).toString('base64')
  };
}

export async function registerResource(authInfo = null, payload = {}, { trustedProvider = false } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const existing = payload.id ? state.resources[String(payload.id).trim()] : null;
    if (payload.id && !existing) {
      throw new Error('resource id is server-managed and cannot be used to create a resource.');
    }
    if (existing) assertResourcePermission(existing, actor, permissionsManifest, 'write');
    if (!trustedProvider) {
      if (existing) throw new Error('Provider-backed resource facts can only be updated by the owning source adapter.');
      const provider = String(payload.provider || '').trim().toLowerCase();
      if (!['local', 'manual'].includes(provider)) {
        throw new Error('Manual resource registration accepts only local or manual providers.');
      }
      const providerOwnedFields = [
        'sourceId', 'revision', 'version', 'accessState', 'providerFacts', 'fileManifest',
        'materializationPath', 'checksum', 'localToParticipant', 'rawDataExportAllowed'
      ];
      if (providerOwnedFields.some((field) => payload[field] !== undefined)) {
        throw new Error('Provider revision, access, materialization and locality facts are adapter-managed.');
      }
    }
    const resource = normalizeResource(payload, actor, existing);
    state.resources[resource.id] = resource;
    return { saveState: true, value: { ok: true, resource: serializeResource(resource, actor, permissionsManifest) } };
  });
}

export async function updateResourceUse(authInfo = null, { id, intendedUse } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'write');
    resource.intendedUse = String(intendedUse || '').trim();
    resource.updatedAt = nowIso();
    return { saveState: true, value: { ok: true, resource: serializeResource(resource, actor, permissionsManifest) } };
  });
}

export async function shareResource(authInfo = null, { id, principal, role = 'read' } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'write');
    const normalizedRole = enumValue(role, RESOURCE_ROLES, 'role');
    const proposal = createProposal('share-resource', actor, {
      resourceId: resource.id,
      effects: [`Grant ${normalizedRole} access to ${String(principal || '').trim()}.`],
      parameters: { principal: normalizePrincipal(principal, 'principal'), role: normalizedRole }
    });
    state.actionProposals[proposal.id] = proposal;
    return { saveState: true, value: { ok: true, proposal } };
  });
}

export async function revokeResource(authInfo = null, { id, principal } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'write');
    const normalizedPrincipal = normalizePrincipal(principal, 'principal');
    const proposal = createProposal('revoke-resource', actor, {
      resourceId: resource.id,
      effects: [`Revoke research-resource access from ${normalizedPrincipal}.`],
      parameters: { principal: normalizedPrincipal }
    });
    state.actionProposals[proposal.id] = proposal;
    return { saveState: true, value: { ok: true, proposal } };
  });
}

export async function proposeOutputRelease(authInfo = null, { id, destination = '' } = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const resource = state.resources[nonEmpty(id, 'id')];
    if (!resource) return { value: { ok: false, error: `DPU resource not found: ${id}` } };
    assertResourcePermission(resource, actor, permissionsManifest, 'write');
    const proposal = createProposal('release-output', actor, {
      resourceId: resource.id,
      effects: [`Release the protected derived output to ${nonEmpty(destination, 'destination')}.`],
      parameters: { destination: nonEmpty(destination, 'destination') }
    });
    state.actionProposals[proposal.id] = proposal;
    return { saveState: true, value: { ok: true, proposal } };
  });
}

export async function resolveResourceAccess(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
  const snapshot = await getResource(authInfo, { id });
  if (!snapshot.ok) return snapshot;
  const resource = snapshot.resource;
  const { source, credential, adapter } = await sourceContext(authInfo, resource.sourceId, registry);
  const access = await adapter.resolveAccess({ source, resource, credential });
  const updated = await registerResource(authInfo, { ...resource, ...access, id: resource.id }, { trustedProvider: true });
  await recordProvenance(authInfo, resource.id, { relation: 'accessResolved', sourceId: source.id, accessState: access.accessState });
  return updated;
}

export async function listSources(authInfo = null) {
  return withResearchState(authInfo, async ({ state }) => ({
    value: { ok: true, items: Object.values(state.sources).map((source) => structuredClone(source)).sort((a, b) => a.name.localeCompare(b.name)) }
  }), { admin: true });
}

export async function getSource(authInfo = null, { id } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const source = state.sources[nonEmpty(id, 'id')];
    return { value: source ? { ok: true, source: structuredClone(source) } : { ok: false, error: `DPU source not found: ${id}` } };
  }, { admin: true });
}

export async function upsertSource(authInfo = null, payload = {}, { registry = defaultAdapterRegistry } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const existing = payload.id ? state.sources[String(payload.id).trim()] : null;
    const source = normalizeSource(payload, existing);
    const adapter = registry.get(source.type);
    source.capabilities = adapter.getCapabilities();
    if (source.secretRef && !state.secrets[source.secretRef]) throw new Error(`DPU secret not found: ${source.secretRef}`);
    state.sources[source.id] = source;
    return { saveState: true, value: { ok: true, source: structuredClone(source) } };
  }, { admin: true });
}

export async function testSource(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
  const { source, credential, adapter } = await sourceContext(authInfo, nonEmpty(id, 'id'), registry, { admin: true });
  const result = await adapter.testConnection({ source, credential });
  return withResearchState(authInfo, async ({ state }) => {
    const current = state.sources[source.id];
    current.connectionState = {
      status: result.ok ? 'connected' : 'error',
      checkedAt: nowIso(),
      identity: String(result.identity || ''),
      authenticated: Boolean(result.authenticated)
    };
    current.updatedAt = nowIso();
    return { saveState: true, value: { ok: Boolean(result.ok), source: structuredClone(current) } };
  }, { admin: true });
}

export async function setSourceEnabled(authInfo = null, { id, enabled } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const source = state.sources[nonEmpty(id, 'id')];
    if (!source) return { value: { ok: false, error: `DPU source not found: ${id}` } };
    source.enabled = Boolean(enabled);
    source.updatedAt = nowIso();
    return { saveState: true, value: { ok: true, source: structuredClone(source) } };
  }, { admin: true });
}

export async function removeSource(authInfo = null, { id } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const normalizedId = nonEmpty(id, 'id');
    if (!state.sources[normalizedId]) return { value: { ok: false, error: `DPU source not found: ${id}` } };
    if (Object.values(state.jobs).some((job) => job.sourceId === normalizedId && ['queued', 'running', 'awaiting-confirmation'].includes(job.state))) {
      throw new Error('DPU source has active jobs.');
    }
    delete state.sources[normalizedId];
    return { saveState: true, value: { ok: true, deleted: true, id: normalizedId } };
  }, { admin: true });
}

export async function listComputeBackends(authInfo = null) {
  return withResearchState(authInfo, async ({ state, actor }) => {
    const admin = isAdmin(actor);
    const items = Object.values(state.computeBackends)
      .filter((backend) => admin || (backend.enabled && backend.connectionState?.status === 'connected'))
      .map((backend) => serializeComputeBackend(backend, { admin }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { value: { ok: true, items } };
  });
}

export async function upsertComputeBackend(authInfo = null, payload = {}, { registry = defaultComputeBackendRegistry } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const existing = payload.id ? state.computeBackends[String(payload.id).trim()] : null;
    const backend = normalizeComputeBackend(payload, existing);
    if (backend.secretRef && !state.secrets[backend.secretRef]) throw new Error(`DPU secret not found: ${backend.secretRef}`);
    const adapter = registry.get(backend.type);
    backend.capabilities = adapter?.capabilities ? [...adapter.capabilities] : [];
    state.computeBackends[backend.id] = backend;
    return { saveState: true, value: { ok: true, backend: serializeComputeBackend(backend, { admin: true }) } };
  }, { admin: true });
}

export async function testComputeBackend(authInfo = null, { id } = {}, { registry = defaultComputeBackendRegistry } = {}) {
  const backendId = nonEmpty(id, 'id');
  const backendSnapshot = await withResearchState(authInfo, async ({ state }) => ({
    value: state.computeBackends[backendId] ? structuredClone(state.computeBackends[backendId]) : null
  }), { admin: true });
  if (!backendSnapshot) throw new Error(`DPU compute backend not found: ${backendId}`);
  if (backendSnapshot.type === 'secure' && !registry.get('secure')) {
    throw new Error('Secure execution remains unavailable until a concrete attestation-verifying provider adapter is installed.');
  }
  const { backend, adapter, secretValue } = await computeBackendContext(authInfo, backendId, registry);
  const result = await adapter.test({ backend, secretValue });
  return withResearchState(authInfo, async ({ state }) => {
    const current = state.computeBackends[backend.id];
    const expected = String(current.expectedIdentity || '').trim();
    const identity = String(result.identity || '').trim();
    const identityMatches = !expected || expected === identity;
    current.connectionState = {
      status: result.ok && identityMatches ? 'connected' : 'error',
      checkedAt: nowIso(),
      identity,
      version: String(result.version || '')
    };
    if (!identityMatches) current.enabled = false;
    current.updatedAt = nowIso();
    return {
      saveState: true,
      value: {
        ok: Boolean(result.ok && identityMatches),
        backend: serializeComputeBackend(current, { admin: true }),
        ...(identityMatches ? {} : { error: 'NVFlare deployment identity did not match the configured identity.' })
      }
    };
  }, { admin: true });
}

export async function proposeSecureExecution(authInfo = null, payload = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const backend = state.computeBackends[nonEmpty(payload.backendId, 'backendId')];
    if (!backend || backend.type !== 'secure' || !backend.enabled || backend.connectionState?.status !== 'connected') {
      throw new Error('An enabled, identity-verified and attested secure backend is required.');
    }
    if (!backend.attestationVerifier || !backend.policyId || !backend.expectedIdentity) {
      throw new Error('Secure backend attestation identity, verifier and policy must be configured.');
    }
    const resourceIds = stringList(payload.resourceIds);
    if (!resourceIds.length) throw new Error('Secure execution requires at least one resource.');
    for (const resourceId of resourceIds) {
      const resource = state.resources[resourceId];
      if (!resource) throw new Error(`Secure execution resource not found: ${resourceId}`);
      assertResourcePermission(resource, actor, permissionsManifest, 'read');
      if (resource.executionMode !== 'secure') throw new Error(`Resource ${resourceId} is not approved for secure execution.`);
    }
    const workload = {
      workloadId: nonEmpty(payload.workloadId, 'workloadId'),
      resourceIds,
      parameters: sanitizeProviderFacts(payload.parameters || {}),
      outputPolicy: sanitizeProviderFacts(payload.outputPolicy || {})
    };
    const proposal = createProposal('secure-execution', actor, {
      effects: [`Submit ${workload.workloadId} to the attested secure backend ${backend.name}.`],
      parameters: { backendId: backend.id, workload }
    });
    const job = createJob('secure-execution', actor, {
      backendId: backend.id, actionProposalId: proposal.id, idempotencyKey: payload.idempotencyKey
    });
    job.state = 'awaiting-confirmation';
    state.actionProposals[proposal.id] = proposal;
    state.jobs[job.id] = job;
    for (const resourceId of resourceIds) state.resources[resourceId].jobIds = stringList([...state.resources[resourceId].jobIds, job.id]);
    return { saveState: true, value: { ok: true, proposal: structuredClone(proposal), job: serializeJob(job) } };
  });
}

export async function setComputeBackendEnabled(authInfo = null, { id, enabled } = {}) {
  return withResearchState(authInfo, async ({ state }) => {
    const backend = state.computeBackends[nonEmpty(id, 'id')];
    if (!backend) return { value: { ok: false, error: `DPU compute backend not found: ${id}` } };
    if (enabled && backend.connectionState?.status !== 'connected') {
      throw new Error('Compute backend must pass its connection and identity test before it can be enabled.');
    }
    backend.enabled = Boolean(enabled);
    backend.updatedAt = nowIso();
    return { saveState: true, value: { ok: true, backend: serializeComputeBackend(backend, { admin: true }) } };
  }, { admin: true });
}

export async function proposeFederatedExperiment(authInfo = null, payload = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const backend = state.computeBackends[nonEmpty(payload.backendId, 'backendId')];
    if (!backend || backend.type !== 'nvflare' || !backend.enabled || backend.connectionState?.status !== 'connected') {
      throw new Error('An enabled and verified NVFlare backend is required.');
    }
    const resourceIds = stringList(payload.participantResourceIds);
    const participants = resourceIds.map((resourceId, index) => {
      const resource = state.resources[resourceId];
      if (!resource) throw new Error(`Federated participant resource not found: ${resourceId}`);
      assertResourcePermission(resource, actor, permissionsManifest, 'read');
      if (resource.executionMode !== 'federated' || !resource.localToParticipant || resource.rawDataExportAllowed) {
        throw new Error(`Resource ${resourceId} is not verified for local-only federated use.`);
      }
      return { id: `participant-${index + 1}`, resourceId, rawDataTransfer: false };
    });
    const experiment = validateFederatedExperiment({
      templateId: nonEmpty(payload.templateId, 'templateId'),
      model: {
        id: nonEmpty(payload.modelId, 'modelId'),
        version: nonEmpty(payload.modelRevision, 'modelRevision')
      },
      strategy: String(payload.strategy || '').trim().toLowerCase(),
      rounds: Math.max(1, Math.floor(Number(payload.rounds) || 1)),
      participants,
      privacy: sanitizeProviderFacts(payload.privacy || {}),
      evaluation: sanitizeProviderFacts(payload.evaluation || {})
    });
    const privacyAssessment = assessExperimentPrivacy(experiment);
    if (!privacyAssessment.allowed) throw new Error('Federated experiment failed the DPU privacy assessment.');
    const proposal = createProposal('federated-execution', actor, {
      effects: [`Submit a ${experiment.strategy} job to ${backend.name} without exporting participant raw data.`],
      parameters: { backendId: backend.id, experiment, privacyAssessment }
    });
    const job = createJob('federated', actor, { backendId: backend.id, actionProposalId: proposal.id, idempotencyKey: payload.idempotencyKey });
    job.state = 'awaiting-confirmation';
    state.actionProposals[proposal.id] = proposal;
    state.jobs[job.id] = job;
    for (const resourceId of resourceIds) {
      state.resources[resourceId].jobIds = stringList([...state.resources[resourceId].jobIds, job.id]);
    }
    return { saveState: true, value: { ok: true, proposal: structuredClone(proposal), job: serializeJob(job), privacyAssessment } };
  });
}

async function submitFederatedAction(authInfo, proposal, { registry = defaultComputeBackendRegistry } = {}) {
  const { backend, adapter, secretValue } = await computeBackendContext(authInfo, proposal.parameters.backendId, registry);
  const job = await withResearchState(authInfo, async ({ state }) => ({
    value: Object.values(state.jobs).find((entry) => entry.actionProposalId === proposal.id)
  }));
  try {
    const submitted = await adapter.submit({
      backend,
      secretValue,
      experiment: proposal.parameters.experiment,
      submitToken: job.idempotencyKey
    });
    return withResearchState(authInfo, async ({ state }) => {
      const current = state.jobs[job.id];
      current.externalJobId = String(submitted.externalJobId || '').trim();
      current.state = 'running';
      current.progress = 1;
      current.result = { backendType: 'nvflare', externalState: String(submitted.state || 'RUNNING') };
      current.updatedAt = nowIso();
      return { saveState: true, value: { ok: true, proposal, job: serializeJob(current) } };
    });
  } catch (error) {
    return withResearchState(authInfo, async ({ state }) => {
      const current = state.jobs[job.id];
      current.state = 'failed';
      current.error = String(error?.message || 'Federated submission failed.');
      current.completedAt = nowIso();
      current.updatedAt = current.completedAt;
      return { saveState: true, value: { ok: false, error: current.error, proposal, job: serializeJob(current) } };
    });
  }
}

async function submitSecureAction(authInfo, proposal, { registry = defaultComputeBackendRegistry } = {}) {
  const { backend, adapter, secretValue } = await computeBackendContext(authInfo, proposal.parameters.backendId, registry);
  const job = await withResearchState(authInfo, async ({ state }) => ({
    value: Object.values(state.jobs).find((entry) => entry.actionProposalId === proposal.id)
  }));
  if (typeof adapter.submit !== 'function') throw new Error('Secure backend does not implement workload submission.');
  try {
    const submitted = await adapter.submit({ backend, secretValue, workload: proposal.parameters.workload, submitToken: job.idempotencyKey });
    return withResearchState(authInfo, async ({ state }) => {
      const current = state.jobs[job.id];
      current.externalJobId = String(submitted.externalJobId || '').trim();
      current.state = 'running';
      current.progress = 1;
      current.result = { backendType: 'secure', externalState: String(submitted.state || 'RUNNING') };
      current.updatedAt = nowIso();
      return { saveState: true, value: { ok: true, proposal, job: serializeJob(current) } };
    });
  } catch (error) {
    return withResearchState(authInfo, async ({ state }) => {
      const current = state.jobs[job.id];
      current.state = 'failed';
      current.error = String(error?.message || 'Secure workload submission failed.');
      current.completedAt = nowIso();
      current.updatedAt = current.completedAt;
      return { saveState: true, value: { ok: false, error: current.error, proposal, job: serializeJob(current) } };
    });
  }
}

export async function searchResearch(authInfo = null, { query, sourceIds = [], providerTypes = [], limit = 20 } = {}, { registry = defaultAdapterRegistry } = {}) {
  const normalizedQuery = nonEmpty(query, 'query');
  const available = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const ids = stringList(sourceIds);
    const types = stringList(providerTypes).map((type) => type.toLowerCase());
    const sources = Object.values(state.sources).filter((source) => (
      source.enabled
      && (!ids.length || ids.includes(source.id))
      && (!types.length || types.includes(source.type))
    ));
    for (const source of sources) assertSourceCredentialAccess(state, permissionsManifest, actor, source);
    const sourceScope = ids.sort().join(',');
    const providerScope = types.length ? `${sourceScope}:provider=${types.sort().join(',')}` : sourceScope;
    const idempotencyKey = `discover:${normalizedQuery}:${providerScope}:${Math.max(1, Math.min(100, Number(limit) || 20))}`;
    const existing = findIdempotentJob(state, actor, { type: 'discover', idempotencyKey });
    if (existing) {
      const items = (Array.isArray(existing.result?.resourceIds) ? existing.result.resourceIds : [])
        .map((resourceId) => state.resources[resourceId])
        .filter(Boolean)
        .map((resource) => serializeResource(resource, actor, permissionsManifest));
      return { value: { reused: true, job: serializeJob(existing), items } };
    }
    const job = createJob('discover', actor, { idempotencyKey });
    job.state = 'running';
    job.startedAt = nowIso();
    job.workerPid = process.pid;
    state.jobs[job.id] = job;
    return { saveState: true, value: { sources: sources.map((source) => structuredClone(source)), jobId: job.id, actor } };
  });
  if (available.reused) return { ok: available.job.state === 'succeeded', job: available.job, items: available.items, reused: true };
  const secrets = await readSecretsMap();
  const discovered = [];
  try {
    for (const source of available.sources) {
      const adapter = registry.get(source.type);
      const credential = source.secretRef ? String(secrets[source.secretRef] || '') : '';
      const results = await adapter.discover({ source, query: normalizedQuery, credential, limit });
      discovered.push(...results);
    }
    const value = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
      const items = [];
      for (const candidate of discovered) {
        const existing = Object.values(state.resources).find((resource) => (
          resource.provider === candidate.provider
          && resource.externalId === candidate.externalId
          && resource.revision === candidate.revision
          && roleAllows(resourceRole(resource, actor, permissionsManifest), 'write')
        ));
        const resource = normalizeResource(candidate, actor, existing || null);
        state.resources[resource.id] = resource;
        items.push(serializeResource(resource, actor, permissionsManifest));
      }
      const job = state.jobs[available.jobId];
      job.state = 'succeeded';
      job.progress = 100;
      job.result = { resourceIds: items.map((item) => item.id), count: items.length };
      job.completedAt = nowIso();
      job.updatedAt = job.completedAt;
      job.workerPid = 0;
      return { saveState: true, value: { ok: true, job: serializeJob(job), items } };
    });
    return value;
  } catch (error) {
    await withResearchState(authInfo, async ({ state }) => {
      const job = state.jobs[available.jobId];
      job.state = 'failed';
      job.error = error?.message || 'Research discovery failed.';
      job.completedAt = nowIso();
      job.updatedAt = job.completedAt;
      job.workerPid = 0;
      return { saveState: true, value: null };
    });
    await recordProvenance(authInfo, resource.id, {
      relation: 'acquisitionFailed', jobId: job.id, sourceId: source.id,
      error: 'Provider acquisition failed; details are retained on the authorized job record.'
    });
    throw error;
  }
}

function comparisonScore(resource, query, provenanceEvents = []) {
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const haystack = `${resource.name} ${resource.externalId} ${(resource.providerFacts?.tags || []).join(' ')}`.toLowerCase();
  const relevance = tokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
  const access = resource.accessState === 'available' ? 3 : resource.accessState === 'pending' ? 1 : 0;
  const fair = Object.entries(resource.fair || {}).reduce((score, [, value]) => score + (value === true || (Array.isArray(value) && value.length) || (typeof value === 'string' && value) ? 1 : 0), 0);
  const licence = resource.licence ? 2 : 0;
  const provenance = Math.min(3, provenanceEvents.length);
  const lineage = provenanceEvents.some((event) => event.used || event.generatedBy || event.generatedResourceId) ? 2 : 0;
  const threatPenalty = (resource.securityRestrictions || []).some((value) => /blocked|prohibited|high-risk/i.test(String(value))) ? -3 : 0;
  const leakageEvidence = resource.providerFacts?.leakageAssessment || resource.providerFacts?.privacyAssessment;
  const leakage = leakageEvidence ? 1 : 0;
  const breakdown = { relevance, access, fair, licence, provenance, lineage, threatPenalty, leakage };
  return { total: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
}

export async function compareResearch(authInfo = null, { ids = [], query = '' } = {}) {
  const resources = [];
  for (const id of stringList(ids)) {
    const result = await getResource(authInfo, { id });
    if (result.ok) resources.push(result.resource);
  }
  const ranked = [];
  for (const resource of resources) {
    const provenanceEvents = await readProvenanceEvents(resource.id);
    const scoring = comparisonScore(resource, query, provenanceEvents);
    ranked.push({
      resource,
      score: scoring.total,
      scoreBreakdown: scoring.breakdown,
      providerFacts: resource.providerFacts,
      evidence: {
        accessState: resource.accessState,
        licence: resource.licence,
        fair: resource.fair,
        citation: resource.citation,
        provenanceEventCount: provenanceEvents.length,
        lineagePresent: scoring.breakdown.lineage > 0,
        securityRestrictions: resource.securityRestrictions,
        leakageAssessmentPresent: scoring.breakdown.leakage > 0
      }
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.resource.name.localeCompare(b.resource.name));
  return {
    ok: true,
    items: ranked,
    recommendation: ranked[0] ? { resourceId: ranked[0].resource.id, reason: 'Highest combined relevance, access, licence, and FAIR evidence score.' } : null,
    proposedActions: ranked[0]?.resource.accessState === 'available' ? [{ type: 'acquire', resourceId: ranked[0].resource.id }] : []
  };
}

export async function acquireResource(authInfo = null, { id, allowPatterns = [], idempotencyKey = '' } = {}, { registry = defaultAdapterRegistry } = {}) {
  const snapshot = await getResource(authInfo, { id });
  if (!snapshot.ok) return snapshot;
  const resource = snapshot.resource;
  if (resource.accessState !== 'available') {
    return withResearchState(authInfo, async ({ state, actor }) => {
      const type = resource.provider === 'edc' ? 'negotiate-edc' : 'accept-terms';
      const existingJob = findIdempotentJob(state, actor, {
        type: 'access', resourceId: resource.id, sourceId: resource.sourceId, idempotencyKey
      });
      if (existingJob) {
        const existingProposal = state.actionProposals[existingJob.actionProposalId] || null;
        return { value: { ok: true, proposal: structuredClone(existingProposal), job: serializeJob(existingJob), reused: true } };
      }
      const proposal = createProposal(type, actor, {
        resourceId: resource.id,
        sourceId: resource.sourceId,
        effects: ['Accept provider conditions or request access before acquisition.'],
        parameters: {
          provider: resource.provider,
          externalId: resource.externalId,
          accessConditions: resource.accessConditions,
          providerUrl: String(resource.accessConditions?.termsUrl || '')
        }
      });
      const job = createJob('access', actor, { resourceId: resource.id, sourceId: resource.sourceId, actionProposalId: proposal.id, idempotencyKey });
      job.state = 'awaiting-confirmation';
      state.actionProposals[proposal.id] = proposal;
      state.jobs[job.id] = job;
      state.resources[resource.id].jobIds = stringList([...state.resources[resource.id].jobIds, job.id]);
      return { saveState: true, value: { ok: true, proposal, job: serializeJob(job) } };
    });
  }
  const { source, credential, adapter } = await sourceContext(authInfo, resource.sourceId, registry);
  const selection = await withResearchState(authInfo, async ({ state, actor }) => {
    const jobType = resource.provider === 'edc' ? 'transfer' : 'acquire';
    const existing = findIdempotentJob(state, actor, {
      type: jobType, resourceId: resource.id, sourceId: source.id, idempotencyKey
    });
    if (existing) return { value: { job: serializeJob(existing), reused: true } };
    const next = createJob(jobType, actor, { resourceId: resource.id, sourceId: source.id, idempotencyKey });
    next.state = 'running';
    next.startedAt = nowIso();
    next.workerPid = process.pid;
    state.jobs[next.id] = next;
    state.resources[resource.id].jobIds = stringList([...state.resources[resource.id].jobIds, next.id]);
    return { saveState: true, value: { job: serializeJob(next), reused: false } };
  });
  const job = selection.job;
  if (selection.reused) return { ok: true, job, resource };
  if (job.state === 'succeeded') return { ok: true, job, resource };
  const root = getResourceMaterializationRoot(resource.id);
  await fs.mkdir(root, { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, '.staging-'));
  await withResearchState(authInfo, async ({ state }) => {
    const currentJob = state.jobs[job.id];
    if (currentJob) currentJob.stagingPath = staging;
    return { saveState: Boolean(currentJob), value: null };
  });
  try {
    const isCancelled = async () => withResearchState(authInfo, async ({ state }) => ({
      value: state.jobs[job.id]?.state === 'cancelled'
    }));
    const result = await adapter.acquire({ source, resource, credential, destinationRoot: staging, allowPatterns, isCancelled });
    if (await isCancelled()) throw new Error('DPU acquisition was cancelled.');
    const revisionName = String(result.revision || resource.revision || 'current').replace(/[^A-Za-z0-9._-]/g, '_');
    const finalPath = path.join(root, revisionName);
    if (result.remoteOperation) await fs.rm(staging, { recursive: true, force: true });
    else await fs.rename(staging, finalPath);
    const value = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
      const current = state.resources[resource.id];
      current.executionMode = result.remoteOperation ? 'remote' : 'local';
      current.accessState = 'available';
      current.revision = String(result.revision || current.revision).trim();
      current.version = current.revision || current.version;
      current.fileManifest = Array.isArray(result.fileManifest) ? result.fileManifest : [];
      current.materializationPath = result.remoteOperation ? '' : finalPath;
      current.providerFacts = sanitizeProviderFacts({ ...current.providerFacts, remoteOperation: result.remoteOperation || null });
      current.updatedAt = nowIso();
      const currentJob = state.jobs[job.id];
      currentJob.state = result.remoteOperation ? 'running' : 'succeeded';
      currentJob.progress = result.remoteOperation ? 50 : 100;
      currentJob.result = sanitizeProviderFacts({ location: current.materializationPath ? `/Confidential/Research Data/${current.id}` : '', remoteOperation: result.remoteOperation || null });
      currentJob.stagingPath = '';
      currentJob.workerPid = 0;
      currentJob.completedAt = result.remoteOperation ? '' : nowIso();
      currentJob.updatedAt = nowIso();
      return { saveState: true, value: { ok: true, job: serializeJob(currentJob), resource: serializeResource(current, actor, permissionsManifest) } };
    });
    await recordProvenance(authInfo, resource.id, {
      relation: result.remoteOperation ? 'transferStarted' : 'materialized',
      jobId: job.id,
      sourceId: source.id,
      revision: result.revision,
      fileManifest: result.fileManifest || [],
      generatedBy: job.id,
      used: resource.persistentId || resource.externalId
    });
    return value;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    await withResearchState(authInfo, async ({ state }) => {
      const currentJob = state.jobs[job.id];
      if (currentJob?.state !== 'cancelled') {
        currentJob.state = 'failed';
        currentJob.error = error?.message || 'Resource acquisition failed.';
        currentJob.completedAt = nowIso();
        currentJob.updatedAt = currentJob.completedAt;
      }
      if (currentJob) currentJob.stagingPath = '';
      if (currentJob) currentJob.workerPid = 0;
      return { saveState: true, value: null };
    });
    throw error;
  }
}

export async function listJobs(authInfo = null, filters = {}) {
  return withResearchState(authInfo, async ({ state, actor }) => {
    const items = Object.values(state.jobs)
      .filter((job) => job.actorId === actor.principalId || isAdmin(actor))
      .filter((job) => !filters.state || job.state === filters.state)
      .filter((job) => !filters.resourceId || job.resourceId === filters.resourceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { value: { ok: true, items: items.map(serializeJob) } };
  });
}

export async function getJob(authInfo = null, { id } = {}, {
  registry = defaultAdapterRegistry,
  computeRegistry = defaultComputeBackendRegistry
} = {}) {
  const snapshot = await withResearchState(authInfo, async ({ state, actor }) => {
    const job = state.jobs[nonEmpty(id, 'id')];
    if (!job || (job.actorId !== actor.principalId && !isAdmin(actor))) return { value: { ok: false, error: `DPU job not found: ${id}` } };
    return { value: { ok: true, job: serializeJob(job) } };
  });
  const job = snapshot.job;
  if (!snapshot.ok || job.state !== 'running') return snapshot;
  if (job.type === 'federated') {
    if (!job.externalJobId || !job.backendId) return snapshot;
    const { adapter, secretValue } = await computeBackendContext(authInfo, job.backendId, computeRegistry);
    const remote = await adapter.get({ secretValue, externalJobId: job.externalJobId });
    const externalState = String(remote.state || '').toUpperCase();
    const failed = /(FAILED|ABORTED|CANCELLED|ERROR)/.test(externalState);
    const succeeded = /(FINISHED:COMPLETED|^COMPLETED$|^SUCCEEDED$)/.test(externalState);
    if (!failed && !succeeded) return { ...snapshot, externalState };
    const completed = await withResearchState(authInfo, async ({ state }) => {
      const currentJob = state.jobs[job.id];
      if (!currentJob || currentJob.state !== 'running') return { value: { ok: true, job: serializeJob(currentJob) } };
      const proposal = state.actionProposals[currentJob.actionProposalId];
      const experiment = proposal?.parameters?.experiment || {};
      let derivedResource = null;
      if (succeeded && !currentJob.result?.derivedResourceId) {
        derivedResource = normalizeResource({
          provider: 'nvflare',
          externalId: currentJob.externalJobId,
          persistentId: `nvflare:job:${currentJob.externalJobId}`,
          name: `${experiment.model?.id || 'federated-model'} result`,
          resourceType: 'model',
          version: experiment.model?.version || '',
          revision: experiment.model?.version || '',
          executionMode: 'remote',
          accessState: 'available',
          securityRestrictions: ['protected-output', 'release-confirmation-required'],
          providerFacts: {
            backendId: currentJob.backendId,
            externalJobId: currentJob.externalJobId,
            strategy: experiment.strategy,
            rounds: experiment.rounds,
            externalState
          }
        }, { principalId: currentJob.actorId });
        derivedResource.ownerId = currentJob.actorId;
        state.resources[derivedResource.id] = derivedResource;
        for (const participant of experiment.participants || []) {
          const sourceResource = state.resources[participant.resourceId];
          if (sourceResource) sourceResource.derivedResourceIds = stringList([...sourceResource.derivedResourceIds, derivedResource.id]);
        }
      }
      currentJob.state = succeeded ? 'succeeded' : 'failed';
      currentJob.progress = succeeded ? 100 : currentJob.progress;
      currentJob.error = failed ? `NVFlare job ended in ${externalState || 'an error state'}.` : '';
      currentJob.result = sanitizeProviderFacts({
        ...(currentJob.result || {}),
        externalState,
        externalJobId: currentJob.externalJobId,
        derivedResourceId: derivedResource?.id || currentJob.result?.derivedResourceId || ''
      });
      currentJob.completedAt = nowIso();
      currentJob.updatedAt = currentJob.completedAt;
      return {
        saveState: true,
        value: {
          ok: true,
          job: serializeJob(currentJob),
          derivedResourceId: currentJob.result.derivedResourceId,
          participantResourceIds: (experiment.participants || []).map((entry) => entry.resourceId)
        }
      };
    });
    if (completed.derivedResourceId) {
      await recordProvenance(authInfo, completed.derivedResourceId, {
        relation: 'wasGeneratedBy', jobId: job.id, backendId: job.backendId,
        externalJobId: job.externalJobId, used: completed.participantResourceIds
      });
      for (const resourceId of completed.participantResourceIds) {
        await recordProvenance(authInfo, resourceId, {
          relation: 'usedByFederatedExecution', jobId: job.id,
          generatedResourceId: completed.derivedResourceId
        });
      }
    }
    delete completed.derivedResourceId;
    delete completed.participantResourceIds;
    return completed;
  }
  if (job.type === 'secure-execution') {
    if (!job.externalJobId || !job.backendId) return snapshot;
    const { adapter, secretValue } = await computeBackendContext(authInfo, job.backendId, computeRegistry);
    if (typeof adapter.get !== 'function') throw new Error('Secure backend does not implement job status.');
    const remote = await adapter.get({ secretValue, externalJobId: job.externalJobId });
    const externalState = String(remote.state || '').toUpperCase();
    const failed = /(FAILED|ABORTED|CANCELLED|ERROR)/.test(externalState);
    const succeeded = /(^COMPLETED$|^SUCCEEDED$|FINISHED:COMPLETED)/.test(externalState);
    if (!failed && !succeeded) return { ...snapshot, externalState };
    return withResearchState(authInfo, async ({ state }) => {
      const current = state.jobs[job.id];
      current.state = succeeded ? 'succeeded' : 'failed';
      current.progress = succeeded ? 100 : current.progress;
      current.error = failed ? `Secure workload ended in ${externalState || 'an error state'}.` : '';
      current.result = sanitizeProviderFacts({ ...(current.result || {}), externalState, evidence: remote.evidence || null, outputs: remote.outputs || [] });
      current.completedAt = nowIso();
      current.updatedAt = current.completedAt;
      return { saveState: true, value: { ok: true, job: serializeJob(current) } };
    });
  }
  const operation = job.type === 'access' ? job.result?.negotiation : job.result?.remoteOperation;
  const operationId = String(operation?.['@id'] || operation?.id || '').trim();
  if (!operationId || !job.sourceId) return snapshot;
  const { source, credential, adapter } = await sourceContext(authInfo, job.sourceId, registry);
  if (typeof adapter.getOperation !== 'function') return snapshot;
  const remote = await adapter.getOperation({
    source, credential, operationId, operationType: job.type === 'access' ? 'negotiation' : 'transfer'
  });
  const remoteState = String(remote?.state || remote?.['edc:state'] || '').toUpperCase();
  const failed = /(ERROR|FAILED|TERMINATED)/.test(remoteState);
  const succeeded = job.type === 'access'
    ? /(FINALIZED|CONFIRMED|AGREED)/.test(remoteState)
    : /(COMPLETED|FINALIZED)/.test(remoteState);
  if (!failed && !succeeded) return { ...snapshot, remoteState };
  const contractAgreementId = job.type === 'access'
    ? String(remote?.contractAgreementId || remote?.['edc:contractAgreementId'] || '').trim()
    : '';
  const operationSucceeded = succeeded && (job.type !== 'access' || Boolean(contractAgreementId));
  let materializedTransfer = null;
  let publishedTransferPath = '';
  if (operationSucceeded && job.type === 'transfer' && typeof adapter.materializeCompletedTransfer === 'function') {
    const root = getResourceMaterializationRoot(job.resourceId);
    await fs.mkdir(root, { recursive: true });
    const staging = await fs.mkdtemp(path.join(root, '.staging-transfer-'));
    try {
      materializedTransfer = await adapter.materializeCompletedTransfer({
        source,
        credential,
        remoteStatus: remote,
        destinationRoot: staging,
        isCancelled: async () => withResearchState(authInfo, async ({ state }) => ({ value: state.jobs[job.id]?.state === 'cancelled' }))
      });
      if (materializedTransfer) {
        const resourceSnapshot = await getResource(authInfo, { id: job.resourceId });
        const revisionName = String(materializedTransfer.revision || resourceSnapshot.resource?.revision || 'current').replace(/[^A-Za-z0-9._-]/g, '_');
        publishedTransferPath = path.join(root, revisionName);
        await fs.rename(staging, publishedTransferPath);
      } else {
        await fs.rm(staging, { recursive: true, force: true });
      }
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  const updated = await withResearchState(authInfo, async ({ state, actor }) => {
    const currentJob = state.jobs[job.id];
    if (!currentJob || currentJob.state !== 'running') return { value: { ok: true, job: serializeJob(currentJob) } };
    currentJob.state = operationSucceeded ? 'succeeded' : 'failed';
    currentJob.progress = operationSucceeded ? 100 : currentJob.progress;
    currentJob.error = operationSucceeded ? '' : (failed
      ? `EDC operation ended in ${remoteState || 'an error state'}.`
      : 'EDC negotiation completed without a contract agreement identifier.');
    currentJob.result = sanitizeProviderFacts({ ...(currentJob.result || {}), remoteStatus: remote });
    currentJob.completedAt = nowIso();
    currentJob.updatedAt = currentJob.completedAt;
    const resource = state.resources[currentJob.resourceId];
    if (resource && operationSucceeded && currentJob.type === 'access') {
      resource.providerFacts = sanitizeProviderFacts({ ...resource.providerFacts, contractAgreementId, negotiation: remote });
      resource.accessState = contractAgreementId ? 'available' : 'pending';
      resource.updatedAt = nowIso();
    }
    if (resource && operationSucceeded && currentJob.type === 'transfer' && materializedTransfer) {
      resource.executionMode = 'local';
      resource.materializationPath = publishedTransferPath;
      resource.fileManifest = Array.isArray(materializedTransfer.fileManifest) ? materializedTransfer.fileManifest : [];
      resource.revision = String(materializedTransfer.revision || resource.revision).trim();
      resource.updatedAt = nowIso();
      currentJob.result = sanitizeProviderFacts({
        ...(currentJob.result || {}),
        location: `/Confidential/Research Data/${resource.id}`,
        materialized: true
      });
    }
    return { saveState: true, value: { ok: true, job: serializeJob(currentJob) } };
  });
  if (operationSucceeded && job.resourceId) {
    await recordProvenance(authInfo, job.resourceId, {
      relation: job.type === 'access' ? 'contractNegotiationCompleted' : 'transferCompleted',
      jobId: job.id, sourceId: job.sourceId, remoteState,
      materialized: Boolean(materializedTransfer),
      fileManifest: materializedTransfer?.fileManifest || []
    });
  }
  return updated;
}

export async function cancelJob(authInfo = null, { id } = {}, {
  registry = defaultAdapterRegistry,
  computeRegistry = defaultComputeBackendRegistry
} = {}) {
  const result = await withResearchState(authInfo, async ({ state, actor }) => {
    const job = state.jobs[nonEmpty(id, 'id')];
    if (!job || (job.actorId !== actor.principalId && !isAdmin(actor))) return { value: { ok: false, error: `DPU job not found: ${id}` } };
    if (!JOB_STATES.includes(job.state)) throw new Error('DPU job state is invalid.');
    if (['succeeded', 'failed', 'cancelled'].includes(job.state)) return { value: { ok: true, job: serializeJob(job) } };
    job.state = 'cancelled';
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    return { saveState: true, value: { ok: true, job: serializeJob(job), stagingPath: job.stagingPath } };
  });
  if (result.ok && result.stagingPath) {
    await fs.rm(result.stagingPath, { recursive: true, force: true });
  }
  if (result.ok && result.job?.type === 'federated' && result.job.externalJobId && result.job.backendId) {
    const { adapter, secretValue } = await computeBackendContext(authInfo, result.job.backendId, computeRegistry);
    await adapter.cancel({ secretValue, externalJobId: result.job.externalJobId });
    const proposal = await withResearchState(authInfo, async ({ state }) => ({
      value: state.actionProposals[result.job.actionProposalId] || null
    }));
    for (const participant of proposal?.parameters?.experiment?.participants || []) {
      await recordProvenance(authInfo, participant.resourceId, { relation: 'federatedExecutionCancelled', jobId: result.job.id });
    }
  }
  if (result.ok && result.job?.type === 'secure-execution' && result.job.externalJobId && result.job.backendId) {
    const { adapter, secretValue } = await computeBackendContext(authInfo, result.job.backendId, computeRegistry);
    if (typeof adapter.cancel !== 'function') throw new Error('Secure backend does not implement cancellation.');
    await adapter.cancel({ secretValue, externalJobId: result.job.externalJobId });
  }
  if (result.ok && result.job?.resourceId) {
    await recordProvenance(authInfo, result.job.resourceId, { relation: 'jobCancelled', jobId: result.job.id });
  }
  const remoteOperation = result.job?.type === 'access' ? result.job?.result?.negotiation : result.job?.result?.remoteOperation;
  const remoteOperationId = String(remoteOperation?.['@id'] || remoteOperation?.id || '').trim();
  if (result.ok && remoteOperationId) {
    const { source, credential, adapter } = await sourceContext(authInfo, result.job.sourceId, registry);
    if (typeof adapter.cancelOperation === 'function') {
      await adapter.cancelOperation({ source, credential, operationId: remoteOperationId, operationType: result.job.type === 'access' ? 'negotiation' : 'transfer' });
    }
  }
  if (result && typeof result === 'object') delete result.stagingPath;
  return result;
}

export async function getAction(authInfo = null, { id } = {}) {
  return withResearchState(authInfo, async ({ state, actor }) => {
    const proposal = state.actionProposals[nonEmpty(id, 'id')];
    if (!proposal || (proposal.actorId !== actor.principalId && !isAdmin(actor))) return { value: { ok: false, error: `DPU action proposal not found: ${id}` } };
    return { value: { ok: true, proposal: structuredClone(proposal) } };
  });
}

export async function rejectAction(authInfo = null, { id } = {}) {
  const rejected = await withResearchState(authInfo, async ({ state, actor }) => {
    const proposal = state.actionProposals[nonEmpty(id, 'id')];
    if (!proposal || proposal.actorId !== actor.principalId) return { value: { ok: false, error: `DPU action proposal not found: ${id}` } };
    if (proposal.status !== 'pending') throw new Error('DPU action proposal is no longer pending.');
    proposal.status = 'rejected';
    proposal.decidedAt = nowIso();
    for (const job of Object.values(state.jobs)) {
      if (job.actionProposalId === proposal.id && job.state === 'awaiting-confirmation') {
        job.state = 'cancelled';
        job.completedAt = proposal.decidedAt;
        job.updatedAt = proposal.decidedAt;
      }
    }
    return { saveState: true, value: { ok: true, proposal: structuredClone(proposal) } };
  });
  if (rejected.ok && rejected.proposal.resourceId) {
    await recordProvenance(authInfo, rejected.proposal.resourceId, {
      relation: 'actionRejected', proposalId: rejected.proposal.id, actionType: rejected.proposal.type
    });
  }
  return rejected;
}

export async function confirmAction(authInfo = null, { id } = {}, {
  registry = defaultAdapterRegistry,
  computeRegistry = defaultComputeBackendRegistry
} = {}) {
  const confirmed = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const proposal = state.actionProposals[nonEmpty(id, 'id')];
    if (!proposal || proposal.actorId !== actor.principalId) return { value: { ok: false, error: `DPU action proposal not found: ${id}` } };
    if (proposal.status !== 'pending') throw new Error('DPU action proposal is no longer pending.');
    if (Date.parse(proposal.expiresAt) <= Date.now()) throw new Error('DPU action proposal has expired.');
    if (proposal.type === 'share-resource') {
      const resource = state.resources[proposal.resourceId];
      assertResourcePermission(resource, actor, permissionsManifest, 'write');
      const principal = resolvePrincipalReference(permissionsManifest, proposal.parameters.principal);
      setPermissionRole(permissionsManifest, 'resource', resource.id, principal, proposal.parameters.role);
      resource.visibility = 'shared';
      resource.updatedAt = nowIso();
    }
    if (proposal.type === 'revoke-resource') {
      const resource = state.resources[proposal.resourceId];
      assertResourcePermission(resource, actor, permissionsManifest, 'write');
      const principal = resolvePrincipalReference(permissionsManifest, proposal.parameters.principal);
      removePermissionRole(permissionsManifest, 'resource', resource.id, principal);
      const acl = getPermissionAcl(permissionsManifest, 'resource', resource.id) || {};
      resource.visibility = Object.keys(acl).length ? 'shared' : 'private';
      resource.updatedAt = nowIso();
    }
    if (proposal.type === 'release-output') {
      const resource = state.resources[proposal.resourceId];
      assertResourcePermission(resource, actor, permissionsManifest, 'write');
      resource.release = {
        status: 'released',
        destination: String(proposal.parameters.destination || ''),
        actorId: actor.principalId,
        releasedAt: nowIso()
      };
      resource.updatedAt = nowIso();
    }
    proposal.status = 'confirmed';
    proposal.decidedAt = nowIso();
    const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === proposal.id);
    if (job && job.state === 'awaiting-confirmation') {
      job.state = 'running';
      job.startedAt = proposal.decidedAt;
      job.updatedAt = proposal.decidedAt;
    }
    return {
      saveState: true,
      savePermissions: ['share-resource', 'revoke-resource'].includes(proposal.type),
      value: { ok: true, proposal: structuredClone(proposal) }
    };
  });
  if (!confirmed.ok) return confirmed;
  if (['share-resource', 'revoke-resource', 'release-output'].includes(confirmed.proposal.type)) {
    await recordProvenance(authInfo, confirmed.proposal.resourceId, {
      relation: confirmed.proposal.type === 'share-resource'
        ? 'sharedWithPrincipal'
        : confirmed.proposal.type === 'revoke-resource'
          ? 'accessRevoked'
          : 'outputReleased',
      proposalId: confirmed.proposal.id,
      parameters: confirmed.proposal.parameters
    });
    return confirmed;
  }
  try {
    if (confirmed.proposal.type === 'federated-execution') {
      return submitFederatedAction(authInfo, confirmed.proposal, { registry: computeRegistry });
    }
    if (confirmed.proposal.type === 'secure-execution') {
      return submitSecureAction(authInfo, confirmed.proposal, { registry: computeRegistry });
    }
    if (['accept-terms', 'request-access', 'negotiate-edc'].includes(confirmed.proposal.type)) {
    const resourceResult = await getResource(authInfo, { id: confirmed.proposal.resourceId });
    const resource = resourceResult.resource;
    const { source, credential, adapter } = await sourceContext(authInfo, resource.sourceId, registry);
    if (resource.provider === 'edc' && typeof adapter.requestAccess === 'function') {
      const negotiation = await adapter.requestAccess({ source, resource, credential });
      await withResearchState(authInfo, async ({ state }) => {
        const current = state.resources[resource.id];
        current.providerFacts = sanitizeProviderFacts({ ...current.providerFacts, negotiation });
        current.accessState = 'pending';
        current.updatedAt = nowIso();
        const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === confirmed.proposal.id);
        if (job) {
          job.state = 'running';
          job.startedAt = nowIso();
          job.result = { negotiation: sanitizeProviderFacts(negotiation) };
          job.updatedAt = job.startedAt;
        }
        return { saveState: true, value: null };
      });
      await recordProvenance(authInfo, resource.id, { relation: 'contractNegotiationStarted', sourceId: source.id, negotiation });
    } else {
      await withResearchState(authInfo, async ({ state }) => {
        const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === confirmed.proposal.id);
        if (job) {
          job.state = 'running';
          job.startedAt ||= nowIso();
          job.updatedAt = nowIso();
        }
        return { saveState: Boolean(job), value: null };
      });
      const access = await adapter.resolveAccess({ source, resource, credential });
      const outcome = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
        const current = state.resources[resource.id];
        current.accessState = access.accessState;
        current.accessConditions = sanitizeProviderFacts(access.accessConditions || current.accessConditions);
        current.updatedAt = nowIso();
        const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === confirmed.proposal.id);
        if (job) {
          job.state = access.accessState === 'available' ? 'succeeded' : 'failed';
          job.progress = access.accessState === 'available' ? 100 : job.progress;
          job.error = access.accessState === 'available' ? '' : 'Provider access is still pending. Complete the provider-side terms or access request, then resolve access again.';
          job.result = { accessState: access.accessState };
          job.completedAt = nowIso();
          job.updatedAt = job.completedAt;
        }
        return { saveState: true, value: { ...confirmed, job: serializeJob(job), resource: serializeResource(current, actor, permissionsManifest) } };
      });
      await recordProvenance(authInfo, resource.id, {
        relation: 'accessConfirmationChecked', sourceId: source.id, accessState: access.accessState
      });
      return outcome;
    }
    }
    return confirmed;
  } catch (error) {
    const failed = await withResearchState(authInfo, async ({ state }) => {
      const proposal = state.actionProposals[confirmed.proposal.id];
      if (proposal) {
        proposal.status = 'failed';
        proposal.decidedAt = nowIso();
        proposal.failureReason = String(error?.message || 'The provider action failed.');
      }
      const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === confirmed.proposal.id);
      if (job && job.state !== 'cancelled') {
        job.state = 'failed';
        job.error = String(error?.message || 'The provider action failed.');
        job.completedAt = nowIso();
        job.updatedAt = job.completedAt;
        job.workerPid = 0;
      }
      return {
        saveState: true,
        value: {
          ok: false,
          error: String(error?.message || 'The provider action failed.'),
          proposal: proposal ? structuredClone(proposal) : null,
          job: serializeJob(job)
        }
      };
    });
    if (failed.proposal?.resourceId) {
      await recordProvenance(authInfo, failed.proposal.resourceId, {
        relation: 'actionFailed', proposalId: failed.proposal.id, actionType: failed.proposal.type
      });
    }
    return failed;
  }
}

export async function getResourceProvenance(authInfo = null, { id } = {}) {
  const resource = await getResource(authInfo, { id });
  if (!resource.ok) return resource;
  const events = await readProvenanceEvents(resource.resource.id);
  return { ok: true, resourceId: resource.resource.id, events };
}

export { defaultAdapterRegistry };
