import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecureExecutionRequest, createSecureProviderContract } from '../lib/secure-execution/secure-execution-broker.mjs';
import { validateFederatedExperiment, createFederatedLearningBroker } from '../lib/federated/federated-learning.mjs';
import { assessExperimentPrivacy } from '../lib/federated/privacy-assessment.mjs';
import { createNvFlareBackend } from '../lib/federated/nvflare-backend.mjs';

test('secure execution rejects missing attestation, policy, identity or confirmation', () => {
  assert.throws(() => validateSecureExecutionRequest({ workloadId: 'w1' }), /confirmation/);
  assert.throws(() => validateSecureExecutionRequest({ workloadId: 'w1', confirmationProposalId: 'p1' }), /attestation/);
  assert.equal(validateSecureExecutionRequest({ workloadId: 'w1', confirmationProposalId: 'p1', attestationEvidence: { quote: 'evidence' }, expectedEnvironmentIdentity: 'tee:1', providerPolicyId: 'policy:1' }).workloadId, 'w1');
});

test('secure broker trusts injected verifiers, not caller supplied booleans', async () => {
  const contract = createSecureProviderContract({
    endpoint: 'https://secure.example',
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    verifyConfirmation: async () => ({ valid: true }),
    verifyAttestation: async () => ({ verified: true, environmentIdentity: 'tee:1' }),
    evaluatePolicy: async () => ({ allowed: false })
  });
  await assert.rejects(() => contract.submitWorkload({
    workloadId: 'w1', confirmationProposalId: 'p1', attestationEvidence: { verified: true },
    expectedEnvironmentIdentity: 'tee:1', providerPolicyId: 'policy:1', policy: { allowed: true }
  }), /policy denied/);
});

test('federation keeps raw data local and requires three secure participants', () => {
  const base = { model: { id: 'model', version: 'sha-1' }, strategy: 'fedavg', privacy: { secureAggregation: true } };
  assert.throws(() => validateFederatedExperiment({ ...base, participants: [] }), /three/);
  const value = validateFederatedExperiment({ ...base, participants: ['a', 'b', 'c'].map((id) => ({ id, resourceId: `r-${id}`, rawDataTransfer: false })) });
  assert.equal(value.participants.every((participant) => participant.rawDataTransfer === false), true);
  assert.equal(assessExperimentPrivacy(value).allowed, false);
});

test('federation broker resolves trusted local-only participant resources', async () => {
  const base = { confirmationProposalId: 'p1', model: { id: 'model', version: 'sha-1' }, strategy: 'fedavg', privacy: { secureAggregation: true }, participants: ['a', 'b', 'c'].map((id) => ({ id, resourceId: `r-${id}`, rawDataTransfer: false })) };
  const broker = createFederatedLearningBroker({
    backend: {
      async submit() { return { ok: true }; },
      async get() { return { ok: true }; },
      async cancel() { return { ok: true }; }
    },
    verifyConfirmation: async () => ({ valid: true }),
    resolveParticipantResource: async (participant) => ({ localToParticipant: participant.id !== 'c', rawDataExportAllowed: false })
  });
  await assert.rejects(() => broker.submit(base), /participant c/i);
});

test('NVFlare backend resolves only administrator-catalogued templates below the private root', async () => {
  const calls = [];
  const backend = createNvFlareBackend({ runBridge: async (payload) => {
    calls.push(payload);
    return payload.operation === 'test'
      ? { ok: true, identity: 'admin@nvidia.com', version: '2.8.1' }
      : { ok: true, externalJobId: 'job-1', state: 'RUNNING' };
  } });
  const secretValue = JSON.stringify({
    username: 'admin@nvidia.com', startupKitPath: '/private/nvflare/admin', templatesRoot: '/private/nvflare/jobs'
  });
  const configured = { settings: { templateCatalog: { medical: 'medical-job' } } };
  assert.equal((await backend.test({ backend: configured, secretValue })).version, '2.8.1');
  await backend.submit({ backend: configured, secretValue, experiment: { templateId: 'medical' }, submitToken: 'submit-1' });
  assert.equal(calls[1].jobPath, '/private/nvflare/jobs/medical-job');
  await assert.rejects(() => backend.submit({
    backend: { settings: { templateCatalog: { escape: '../outside' } } },
    secretValue,
    experiment: { templateId: 'escape' },
    submitToken: 'submit-2'
  }), /inside templatesRoot/);
});
