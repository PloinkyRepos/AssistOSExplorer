import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecureExecutionRequest, createSecureProviderContract } from '../lib/p2/secure-execution-broker.mjs';
import { validateFederatedExperiment, createFederatedLearningBroker } from '../lib/p2/federated-learning.mjs';
import { assessExperimentPrivacy } from '../lib/p2/privacy-assessment.mjs';

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
    endpoint: 'https://nvflare.example',
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    verifyConfirmation: async () => ({ valid: true }),
    resolveParticipantResource: async (participant) => ({ localToParticipant: participant.id !== 'c', rawDataExportAllowed: false })
  });
  await assert.rejects(() => broker.submit(base), /participant c/i);
});
