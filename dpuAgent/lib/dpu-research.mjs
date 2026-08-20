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

const EXECUTION_MODES = Object.freeze(['local', 'remote', 'secure', 'federated']);
const ACCESS_STATES = Object.freeze(['available', 'pending', 'blocked']);
const VISIBILITIES = Object.freeze(['private', 'shared']);
const RESOURCE_ROLES = Object.freeze(['access', 'read', 'write']);
const JOB_TYPES = Object.freeze(['discover', 'access', 'acquire', 'transfer', 'remote-execution', 'secure-execution', 'federated']);
const JOB_STATES = Object.freeze(['queued', 'awaiting-confirmation', 'running', 'succeeded', 'failed', 'cancelled']);
const ACTION_TYPES = Object.freeze(['accept-terms', 'request-access', 'negotiate-edc', 'share-resource', 'secure-execution', 'federated-execution', 'release-output']);
const DEFAULT_ACTION_TTL_MS = 30 * 60 * 1000;

const defaultAdapterRegistry = createSourceAdapterRegistry({
  huggingface: createHuggingFaceAdapter(),
  edc: createEdcAdapter()
});

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

function createJob(type, actor, input = {}) {
  return {
    id: randomUUID(),
    type: enumValue(type, JOB_TYPES, 'job type'),
    state: 'queued',
    actorId: actor.principalId,
    resourceId: String(input.resourceId || '').trim(),
    sourceId: String(input.sourceId || '').trim(),
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

export async function registerResource(authInfo = null, payload = {}) {
  return withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const existing = payload.id ? state.resources[String(payload.id).trim()] : null;
    if (payload.id && !existing) {
      throw new Error('resource id is server-managed and cannot be used to create a resource.');
    }
    if (existing) assertResourcePermission(existing, actor, permissionsManifest, 'write');
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

export async function resolveResourceAccess(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
  const snapshot = await getResource(authInfo, { id });
  if (!snapshot.ok) return snapshot;
  const resource = snapshot.resource;
  const { source, credential, adapter } = await sourceContext(authInfo, resource.sourceId, registry);
  const access = await adapter.resolveAccess({ source, resource, credential });
  const updated = await registerResource(authInfo, { ...resource, ...access, id: resource.id });
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

export async function searchResearch(authInfo = null, { query, sourceIds = [], limit = 20 } = {}, { registry = defaultAdapterRegistry } = {}) {
  const normalizedQuery = nonEmpty(query, 'query');
  const available = await withResearchState(authInfo, async ({ state, permissionsManifest, actor }) => {
    const ids = stringList(sourceIds);
    const sources = Object.values(state.sources).filter((source) => source.enabled && (!ids.length || ids.includes(source.id)));
    for (const source of sources) assertSourceCredentialAccess(state, permissionsManifest, actor, source);
    const idempotencyKey = `discover:${normalizedQuery}:${ids.sort().join(',')}:${Math.max(1, Math.min(100, Number(limit) || 20))}`;
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
    throw error;
  }
}

function relevanceScore(resource, query) {
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const haystack = `${resource.name} ${resource.externalId} ${(resource.providerFacts?.tags || []).join(' ')}`.toLowerCase();
  const relevance = tokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
  const access = resource.accessState === 'available' ? 3 : resource.accessState === 'pending' ? 1 : 0;
  const fair = Object.entries(resource.fair || {}).reduce((score, [, value]) => score + (value === true || (Array.isArray(value) && value.length) || (typeof value === 'string' && value) ? 1 : 0), 0);
  const licence = resource.licence ? 2 : 0;
  return relevance + access + fair + licence;
}

export async function compareResearch(authInfo = null, { ids = [], query = '' } = {}) {
  const resources = [];
  for (const id of stringList(ids)) {
    const result = await getResource(authInfo, { id });
    if (result.ok) resources.push(result.resource);
  }
  const ranked = resources.map((resource) => ({
    resource,
    score: relevanceScore(resource, query),
    providerFacts: resource.providerFacts,
    evidence: { accessState: resource.accessState, licence: resource.licence, fair: resource.fair, citation: resource.citation }
  })).sort((a, b) => b.score - a.score || a.resource.name.localeCompare(b.resource.name));
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

export async function getJob(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
  const snapshot = await withResearchState(authInfo, async ({ state, actor }) => {
    const job = state.jobs[nonEmpty(id, 'id')];
    if (!job || (job.actorId !== actor.principalId && !isAdmin(actor))) return { value: { ok: false, error: `DPU job not found: ${id}` } };
    return { value: { ok: true, job: serializeJob(job) } };
  });
  const job = snapshot.job;
  if (!snapshot.ok || job.state !== 'running') return snapshot;
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
    return { saveState: true, value: { ok: true, job: serializeJob(currentJob) } };
  });
  if (operationSucceeded && job.resourceId) {
    await recordProvenance(authInfo, job.resourceId, {
      relation: job.type === 'access' ? 'contractNegotiationCompleted' : 'transferCompleted',
      jobId: job.id, sourceId: job.sourceId, remoteState
    });
  }
  return updated;
}

export async function cancelJob(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
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
  return withResearchState(authInfo, async ({ state, actor }) => {
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
}

export async function confirmAction(authInfo = null, { id } = {}, { registry = defaultAdapterRegistry } = {}) {
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
    proposal.status = 'confirmed';
    proposal.decidedAt = nowIso();
    const job = Object.values(state.jobs).find((entry) => entry.actionProposalId === proposal.id);
    if (job && job.state === 'awaiting-confirmation') {
      job.state = 'running';
      job.startedAt = proposal.decidedAt;
      job.updatedAt = proposal.decidedAt;
    }
    return { saveState: true, savePermissions: proposal.type === 'share-resource', value: { ok: true, proposal: structuredClone(proposal) } };
  });
  if (!confirmed.ok || confirmed.proposal.type === 'share-resource') return confirmed;
  try {
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
    return withResearchState(authInfo, async ({ state }) => {
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
  }
}

export async function getResourceProvenance(authInfo = null, { id } = {}) {
  const resource = await getResource(authInfo, { id });
  if (!resource.ok) return resource;
  const events = await readProvenanceEvents(resource.resource.id);
  return { ok: true, resourceId: resource.resource.id, events };
}

export { defaultAdapterRegistry };
