import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dpu-research-'));
process.env.DPU_DATA_ROOT = dataRoot;
process.env.DPU_MASTER_KEY = 'research-test-key';

const research = await import(`../lib/dpu-research.mjs?test=${Date.now()}`);
const { putSecret, assertInvocationScopeFor } = await import(`../lib/dpu-store.mjs?research=${Date.now()}`);
const { createSourceAdapterRegistry } = await import('../lib/source-adapters/source-adapter.mjs');
const { getResourceMaterializationRoot } = await import('../lib/dpu-store-internal/storage.mjs');

const admin = { user: { id: 'local:admin', username: 'admin', email: 'admin@example.com', roles: ['admin'] } };
const other = { user: { id: 'other', email: 'other@example.com' } };
const fakeAdapter = {
  getCapabilities: () => ['search', 'metadata', 'download', 'provenance', 'citation'],
  testConnection: async () => ({ ok: true, identity: 'fixture', authenticated: false }),
  discover: async ({ source, query }) => [{
    provider: 'fixture', sourceId: source.id, externalId: `dataset/${query}`, name: `Dataset ${query}`,
    revision: 'commit-123', persistentId: `fixture:${query}`, accessState: 'available', executionMode: 'remote',
    licence: 'Apache-2.0', citation: 'Fixture citation', fair: { metadataAvailable: true, licenceAvailable: true }
  }],
  describe: async ({ resource }) => resource,
  resolveAccess: async () => ({ accessState: 'available' }),
  acquire: async ({ destinationRoot }) => {
    await fs.writeFile(path.join(destinationRoot, 'data.csv'), 'a,b\n1,2\n');
    return { revision: 'commit-123', fileManifest: [{ path: 'data.csv', size: 8, checksum: 'sha256:fixture' }] };
  },
  getCitation: async () => ({ citation: 'Fixture citation' })
};
const registry = createSourceAdapterRegistry({ fixture: fakeAdapter });

test.after(async () => fs.rm(dataRoot, { recursive: true, force: true }));

test('clean-break state rejects a legacy state file', async () => {
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dpu-legacy-'));
  const previous = process.env.DPU_DATA_ROOT;
  try {
    process.env.DPU_DATA_ROOT = legacyRoot;
    await fs.writeFile(path.join(legacyRoot, 'state.json'), JSON.stringify({ version: 4, objects: {} }));
    const storage = await import(`../lib/dpu-store-internal/storage.mjs?legacy=${Date.now()}`);
    await assert.rejects(() => storage.loadState(), /unsupported schema/);
  } finally {
    process.env.DPU_DATA_ROOT = previous;
    await fs.rm(legacyRoot, { recursive: true, force: true });
  }
});

test('research invocation scopes reject unrelated delegated capabilities', () => {
  assert.doesNotThrow(() => assertInvocationScopeFor('dpu_resource_get', { invocation: { scope: ['dpu:research:read'] } }));
  assert.throws(() => assertInvocationScopeFor('dpu_resource_acquire', { invocation: { scope: ['dpu:research:read'] } }), /does not permit/);
  assert.doesNotThrow(() => assertInvocationScopeFor('dpu_source_test', { invocation: { delegation: { scope: ['dpu:sources:admin'] } } }));
});

test('source discovery, exact resource registration, acquisition and provenance work end-to-end', async () => {
  const sourceResult = await research.upsertSource(admin, { name: 'Fixture', type: 'fixture' }, { registry });
  assert.equal(sourceResult.ok, true);
  assert.deepEqual(sourceResult.source.capabilities, ['search', 'metadata', 'download', 'provenance', 'citation']);

  const connection = await research.testSource(admin, { id: sourceResult.source.id }, { registry });
  assert.equal(connection.source.connectionState.status, 'connected');

  const found = await research.searchResearch(admin, { query: 'romanian-medical', sourceIds: [sourceResult.source.id] }, { registry });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].revision, 'commit-123');
  assert.equal(found.items[0].effectiveState, 'remote');

  const acquired = await research.acquireResource(admin, { id: found.items[0].id, idempotencyKey: 'fixture-acquire-1' }, { registry });
  assert.equal(acquired.job.state, 'succeeded');
  assert.equal(acquired.resource.effectiveState, 'local');
  assert.equal(acquired.resource.materializationPath, undefined);
  assert.equal(acquired.resource.location, `/Confidential/Research Data/${acquired.resource.id}`);
  assert.equal((await fs.readFile(path.join(getResourceMaterializationRoot(acquired.resource.id), 'commit-123', 'data.csv'), 'utf8')).trim(), 'a,b\n1,2');
  const provenance = await research.getResourceProvenance(admin, { id: acquired.resource.id });
  assert.equal(provenance.events.at(-1).relation, 'materialized');

  const files = await research.listResourceFiles(admin, { id: acquired.resource.id });
  assert.deepEqual(files.items.map((entry) => entry.path), ['data.csv']);
  const stat = await research.statResourceFile(admin, { id: acquired.resource.id, path: 'data.csv' });
  assert.equal(stat.file.size, 8);
  assert.equal(stat.file.mimeType, 'text/csv');
  const first = await research.readResourceFile(admin, { id: acquired.resource.id, path: 'data.csv', length: 4 });
  const second = await research.readResourceFile(admin, { id: acquired.resource.id, path: 'data.csv', offset: first.nextOffset, length: 32 });
  const reconstructed = Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(second.data, 'base64')]);
  assert.equal(reconstructed.toString(), 'a,b\n1,2\n');
  assert.equal(second.eof, true);
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'), createHash('sha256').update('a,b\n1,2\n').digest('hex'));
});

test('materialized resource reads require agent ACL and the dedicated invocation scope', async () => {
  const source = await research.upsertSource(admin, { name: 'Agent read fixture', type: 'fixture' }, { registry });
  const found = await research.searchResearch(admin, { query: 'agent-readable', sourceIds: [source.source.id] }, { registry });
  const acquired = await research.acquireResource(admin, { id: found.items[0].id, idempotencyKey: 'agent-readable-1' }, { registry });
  const agentPrincipal = 'agent:AchillesIDE/gitAgent';
  const agentAuth = {
    agent: { name: 'gitAgent', principalId: agentPrincipal },
    invocation: { scope: ['dpu:research:files:read'] }
  };
  await assert.rejects(() => research.readResourceFile(agentAuth, { id: acquired.resource.id, path: 'data.csv' }), /permission/);
  const proposal = await research.shareResource(admin, { id: acquired.resource.id, principal: agentPrincipal, role: 'read' });
  await research.confirmAction(admin, { id: proposal.proposal.id });
  assert.doesNotThrow(() => assertInvocationScopeFor('dpu_resource_file_read', agentAuth));
  assert.throws(() => assertInvocationScopeFor('dpu_resource_file_read', {
    ...agentAuth, invocation: { scope: ['dpu:research:read'] }
  }), /does not permit/);
  const result = await research.readResourceFile(agentAuth, { id: acquired.resource.id, path: 'data.csv', length: 8 });
  assert.equal(Buffer.from(result.data, 'base64').toString(), 'a,b\n1,2\n');
});

test('resource file reads reject traversal, unverified entries, oversized chunks and symlinks', async () => {
  const source = await research.upsertSource(admin, { name: 'Read safety fixture', type: 'fixture' }, { registry });
  const found = await research.searchResearch(admin, { query: 'read-safety', sourceIds: [source.source.id] }, { registry });
  const acquired = await research.acquireResource(admin, { id: found.items[0].id, idempotencyKey: 'read-safety-1' }, { registry });
  await assert.rejects(() => research.readResourceFile(admin, { id: acquired.resource.id, path: '../state.json' }), /escapes/);
  await assert.rejects(() => research.readResourceFile(admin, { id: acquired.resource.id, path: 'missing.csv' }), /verified manifest/);
  await assert.rejects(() => research.readResourceFile(admin, { id: acquired.resource.id, path: 'data.csv', length: 1024 * 1024 + 1 }), /length/);

  const materialization = path.join(getResourceMaterializationRoot(acquired.resource.id), 'commit-123');
  await fs.rm(path.join(materialization, 'data.csv'));
  await fs.symlink(path.join(dataRoot, 'state.json'), path.join(materialization, 'data.csv'));
  await assert.rejects(() => research.readResourceFile(admin, { id: acquired.resource.id, path: 'data.csv' }), /regular file/);
});

test('source connection authorization happens before provider network work', async () => {
  let calls = 0;
  const guardedAdapter = { ...fakeAdapter, testConnection: async () => { calls += 1; return { ok: true }; } };
  const guardedRegistry = createSourceAdapterRegistry({ guarded: guardedAdapter });
  const source = await research.upsertSource(admin, { name: 'Guarded', type: 'guarded' }, { registry: guardedRegistry });
  await assert.rejects(() => research.testSource(other, { id: source.source.id }, { registry: guardedRegistry }), /admin role/);
  assert.equal(calls, 0);
});

test('expired resources are visible as blocked but cannot be read or acquired', async () => {
  const registered = await research.registerResource(admin, {
    provider: 'fixture', sourceId: 'none', externalId: 'expired/one', accessState: 'available', expiresAt: '2000-01-01T00:00:00.000Z'
  }, { trustedProvider: true });
  assert.equal(registered.resource.effectiveState, 'blocked');
  await assert.rejects(() => research.getResource(admin, { id: registered.resource.id }), /expired/);
});

test('resource ids are server-managed and cannot escape DPU storage paths', async () => {
  await assert.rejects(() => research.registerResource(admin, {
    id: '../../outside', provider: 'fixture', sourceId: 'none', externalId: 'unsafe/one'
  }, { trustedProvider: true }), /server-managed/);
  assert.throws(() => getResourceMaterializationRoot('../../outside'), /DPU UUID/);
});

test('public resource registration cannot claim provider-owned facts', async () => {
  await assert.rejects(() => research.registerResource(admin, {
    provider: 'huggingface', externalId: 'owner/data', revision: 'invented', accessState: 'available'
  }), /local or manual/);
  await assert.rejects(() => research.registerResource(admin, {
    provider: 'local', externalId: 'local/data', fileManifest: [{ path: 'invented.csv' }]
  }), /adapter-managed/);
  const local = await research.registerResource(admin, { provider: 'local', externalId: 'local/data', name: 'Local data' });
  assert.equal(local.resource.provider, 'local');
  assert.equal(local.resource.fileManifest.length, 0);
});

test('verified NVFlare backend submits a confirmed local-only experiment and records a derived result', async () => {
  const calls = [];
  const fakeNvFlare = {
    type: 'nvflare',
    capabilities: ['federated-learning', 'fedavg', 'cancel'],
    async test() { calls.push('test'); return { ok: true, identity: 'admin@nvidia.com', version: '2.8.1' }; },
    async submit({ experiment, submitToken }) {
      calls.push(`submit:${experiment.strategy}:${submitToken}`);
      return { ok: true, externalJobId: 'nv-job-1', state: 'RUNNING' };
    },
    async get() { calls.push('get'); return { ok: true, externalJobId: 'nv-job-1', state: 'FINISHED:COMPLETED' }; },
    async cancel() { calls.push('cancel'); return { ok: true }; }
  };
  const computeRegistry = new Map([['nvflare', fakeNvFlare]]);
  await putSecret(admin, {
    key: 'NVFLARE_CONFIG',
    value: JSON.stringify({ username: 'admin@nvidia.com', startupKitPath: '/private/kit', templatesRoot: '/private/jobs' })
  });
  const configured = await research.upsertComputeBackend(admin, {
    name: 'NVFlare POC', type: 'nvflare', secretRef: 'NVFLARE_CONFIG', expectedIdentity: 'admin@nvidia.com',
    settings: { templateCatalog: { medical: 'medical-job' } }
  }, { registry: computeRegistry });
  await assert.rejects(() => research.setComputeBackendEnabled(admin, { id: configured.backend.id, enabled: true }), /pass its connection/);
  const tested = await research.testComputeBackend(admin, { id: configured.backend.id }, { registry: computeRegistry });
  assert.equal(tested.backend.connectionState.version, '2.8.1');
  await research.setComputeBackendEnabled(admin, { id: configured.backend.id, enabled: true });

  const participantIds = [];
  for (const suffix of ['a', 'b', 'c']) {
    const registered = await research.registerResource(admin, {
      provider: 'fixture', externalId: `participant/${suffix}`, executionMode: 'federated', accessState: 'available',
      localToParticipant: true, rawDataExportAllowed: false
    }, { trustedProvider: true });
    participantIds.push(registered.resource.id);
  }
  const proposed = await research.proposeFederatedExperiment(admin, {
    backendId: configured.backend.id,
    templateId: 'medical',
    participantResourceIds: participantIds,
    modelId: 'medical-model',
    modelRevision: 'sha-123',
    strategy: 'fedavg',
    rounds: 3,
    privacy: { secureAggregation: true, differentialPrivacy: { epsilon: 2 } },
    evaluation: { leakageTests: ['membership', 'reconstruction'] },
    idempotencyKey: 'federated-medical-1'
  });
  assert.equal(proposed.job.state, 'awaiting-confirmation');
  const submitted = await research.confirmAction(admin, { id: proposed.proposal.id }, { computeRegistry });
  assert.equal(submitted.job.externalJobId, 'nv-job-1');
  const completed = await research.getJob(admin, { id: submitted.job.id }, { computeRegistry });
  assert.equal(completed.job.state, 'succeeded');
  assert.ok(completed.job.result.derivedResourceId);
  const derived = await research.getResource(admin, { id: completed.job.result.derivedResourceId });
  assert.equal(derived.resource.resourceType, 'model');
  assert.deepEqual(calls.slice(0, 3), ['test', `submit:fedavg:${submitted.job.idempotencyKey}`, 'get']);
  const provenance = await research.getResourceProvenance(admin, { id: derived.resource.id });
  assert.equal(provenance.events.at(-1).relation, 'wasGeneratedBy');
});

test('secure backend is fail-closed until a concrete verified adapter exists', async () => {
  const configured = await research.upsertComputeBackend(admin, {
    name: 'Future TEE', type: 'secure', secretRef: 'NVFLARE_CONFIG', expectedIdentity: 'tee:expected',
    attestationVerifier: 'provider-specific', policyId: 'policy-1'
  });
  assert.equal(configured.backend.available, false);
  await assert.rejects(() => research.testComputeBackend(admin, { id: configured.backend.id }), /concrete attestation/);
  await assert.rejects(() => research.setComputeBackendEnabled(admin, { id: configured.backend.id, enabled: true }), /pass its connection/);
});

test('secure provider conformance interface supports verified proposal, confirmation and job lifecycle', async () => {
  const secureAdapter = {
    type: 'secure',
    capabilities: ['secure-execution', 'attestation', 'cancel'],
    async test() { return { ok: true, identity: 'tee:verified', version: 'provider-1' }; },
    async submit() { return { ok: true, externalJobId: 'secure-job-1', state: 'RUNNING' }; },
    async get() { return { ok: true, state: 'COMPLETED', evidence: { identity: 'tee:verified' }, outputs: [{ id: 'output-1' }] }; },
    async cancel() { return { ok: true }; }
  };
  const secureRegistry = new Map([['secure', secureAdapter]]);
  const configured = await research.upsertComputeBackend(admin, {
    name: 'Verified TEE', type: 'secure', secretRef: 'NVFLARE_CONFIG', expectedIdentity: 'tee:verified',
    attestationVerifier: 'provider-attestation-v1', policyId: 'policy-1'
  }, { registry: secureRegistry });
  await research.testComputeBackend(admin, { id: configured.backend.id }, { registry: secureRegistry });
  await research.setComputeBackendEnabled(admin, { id: configured.backend.id, enabled: true });
  const resource = await research.registerResource(admin, {
    provider: 'fixture', externalId: 'secure/data', executionMode: 'secure', accessState: 'available'
  }, { trustedProvider: true });
  const proposed = await research.proposeSecureExecution(admin, {
    backendId: configured.backend.id, workloadId: 'analysis-1', resourceIds: [resource.resource.id], idempotencyKey: 'secure-1'
  });
  const submitted = await research.confirmAction(admin, { id: proposed.proposal.id }, { computeRegistry: secureRegistry });
  assert.equal(submitted.job.state, 'running');
  const completed = await research.getJob(admin, { id: submitted.job.id }, { computeRegistry: secureRegistry });
  assert.equal(completed.job.state, 'succeeded');
  assert.equal(completed.job.result.evidence.identity, 'tee:verified');
});

test('discovery does not update a private resource owned by another actor', async () => {
  const source = await research.upsertSource(admin, { name: 'Private discovery fixture', type: 'fixture' }, { registry });
  const ownerDiscovery = await research.searchResearch(admin, { query: 'private-discovery', sourceIds: [source.source.id] }, { registry });
  const ownerResource = ownerDiscovery.items[0];
  const otherDiscovery = await research.searchResearch(other, { query: 'private-discovery', sourceIds: [source.source.id] }, { registry });
  assert.notEqual(otherDiscovery.items[0].id, ownerResource.id);
  assert.equal((await research.getResource(admin, { id: ownerResource.id })).resource.ownerId, 'admin@example.com');
  await assert.rejects(() => research.getResource(other, { id: ownerResource.id }), /resource access permission/);
});

test('sharing is immutable until the intended actor confirms it', async () => {
  const registered = await research.registerResource(admin, { provider: 'fixture', sourceId: 'none', externalId: 'private/one', revision: '1', executionMode: 'remote' }, { trustedProvider: true });
  const proposed = await research.shareResource(admin, { id: registered.resource.id, principal: 'other@example.com', role: 'read' });
  assert.equal(proposed.proposal.status, 'pending');
  assert.equal((await research.confirmAction(other, { id: proposed.proposal.id })).ok, false);
  await research.confirmAction(admin, { id: proposed.proposal.id });
  const visible = await research.getResource(other, { id: registered.resource.id });
  assert.equal(visible.ok, true);
  assert.equal(visible.resource.role, 'read');
  assert.equal(visible.resource.effectiveState, 'shared');

  const revoke = await research.revokeResource(admin, { id: registered.resource.id, principal: 'other@example.com' });
  await research.confirmAction(admin, { id: revoke.proposal.id });
  await assert.rejects(() => research.getResource(other, { id: registered.resource.id }), /permission/);
  const provenance = await research.getResourceProvenance(admin, { id: registered.resource.id });
  assert.deepEqual(provenance.events.slice(-2).map((event) => event.relation), ['sharedWithPrincipal', 'accessRevoked']);
});

test('derived output release is a separate actor-bound confirmation', async () => {
  const registered = await research.registerResource(admin, {
    provider: 'fixture', externalId: 'derived/model', resourceType: 'model',
    securityRestrictions: ['protected-output', 'release-confirmation-required']
  }, { trustedProvider: true });
  const proposed = await research.proposeOutputRelease(admin, { id: registered.resource.id, destination: 'research-registry' });
  assert.equal(proposed.proposal.status, 'pending');
  assert.equal((await research.confirmAction(other, { id: proposed.proposal.id })).ok, false);
  await research.confirmAction(admin, { id: proposed.proposal.id });
  const released = await research.getResource(admin, { id: registered.resource.id });
  assert.equal(released.resource.release.status, 'released');
  const provenance = await research.getResourceProvenance(admin, { id: registered.resource.id });
  assert.equal(provenance.events.at(-1).relation, 'outputReleased');
});

test('pending resources create a confirmation-bound access job', async () => {
  const registered = await research.registerResource(admin, {
    provider: 'fixture', sourceId: 'none', externalId: 'gated/one', accessState: 'pending', executionMode: 'remote'
  }, { trustedProvider: true });
  const result = await research.acquireResource(admin, { id: registered.resource.id }, { registry });
  assert.equal(result.job.state, 'awaiting-confirmation');
  assert.equal(result.proposal.type, 'accept-terms');
  const rejected = await research.rejectAction(admin, { id: result.proposal.id });
  assert.equal(rejected.proposal.status, 'rejected');
  assert.equal((await research.getJob(admin, { id: result.job.id })).job.state, 'cancelled');
});

test('confirming Hugging Face terms only rechecks provider access and does not accept terms', async () => {
  let accessChecks = 0;
  let accessRequests = 0;
  const gatedAdapter = {
    ...fakeAdapter,
    resolveAccess: async () => { accessChecks += 1; return { accessState: 'pending', accessConditions: { gated: true, termsUrl: 'https://hf.example/datasets/gated' } }; },
    requestAccess: async () => { accessRequests += 1; return {}; }
  };
  const gatedRegistry = createSourceAdapterRegistry({ gated: gatedAdapter });
  const source = await research.upsertSource(admin, { name: 'Gated HF', type: 'gated' }, { registry: gatedRegistry });
  const registered = await research.registerResource(admin, { provider: 'huggingface', sourceId: source.source.id, externalId: 'owner/gated', accessState: 'pending' }, { trustedProvider: true });
  const pending = await research.acquireResource(admin, { id: registered.resource.id, idempotencyKey: 'gated-1' }, { registry: gatedRegistry });
  const reused = await research.acquireResource(admin, { id: registered.resource.id, idempotencyKey: 'gated-1' }, { registry: gatedRegistry });
  assert.equal(reused.job.id, pending.job.id);
  const confirmed = await research.confirmAction(admin, { id: pending.proposal.id }, { registry: gatedRegistry });
  assert.equal(confirmed.job.state, 'failed');
  assert.equal(confirmed.resource.accessState, 'pending');
  assert.equal(accessChecks, 1);
  assert.equal(accessRequests, 0);
});

test('failed external access confirmation completes its proposal and job deterministically', async () => {
  const failingEdc = { ...fakeAdapter, requestAccess: async () => { throw new Error('provider unavailable'); } };
  const failingRegistry = createSourceAdapterRegistry({ 'failing-edc': failingEdc });
  const source = await research.upsertSource(admin, { name: 'Failing EDC', type: 'failing-edc' }, { registry: failingRegistry });
  const resource = await research.registerResource(admin, {
    provider: 'edc', sourceId: source.source.id, externalId: 'failing/access', accessState: 'pending'
  }, { trustedProvider: true });
  const pending = await research.acquireResource(admin, { id: resource.resource.id, idempotencyKey: 'failing-edc-1' }, { registry: failingRegistry });
  const confirmed = await research.confirmAction(admin, { id: pending.proposal.id }, { registry: failingRegistry });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.proposal.status, 'failed');
  assert.equal(confirmed.job.state, 'failed');
  assert.match(confirmed.job.error, /provider unavailable/);
});

test('source credentials never enter state, source responses or provenance', async () => {
  const marker = 'never-persist-this-provider-token';
  await putSecret(admin, { key: 'FIXTURE_TOKEN', value: marker });
  const source = await research.upsertSource(admin, { name: 'Credential Fixture', type: 'fixture', secretRef: 'FIXTURE_TOKEN' }, { registry });
  await research.testSource(admin, { id: source.source.id }, { registry });
  const stateText = await fs.readFile(path.join(dataRoot, 'state.json'), 'utf8');
  assert.equal(stateText.includes(marker), false);
  assert.equal(JSON.stringify(await research.listSources(admin)).includes(marker), false);
  const provenanceFiles = await fs.readdir(path.join(dataRoot, 'provenance')).catch(() => []);
  for (const file of provenanceFiles) assert.equal((await fs.readFile(path.join(dataRoot, 'provenance', file), 'utf8')).includes(marker), false);
});
