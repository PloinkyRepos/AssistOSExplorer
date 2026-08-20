function required(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

export function validateSecureExecutionRequest(request = {}) {
  return {
    workloadId: required(request.workloadId, 'workloadId'),
    confirmationProposalId: required(request.confirmationProposalId, 'confirmationProposalId'),
    attestationEvidence: request.attestationEvidence && typeof request.attestationEvidence === 'object'
      ? structuredClone(request.attestationEvidence)
      : (() => { throw new Error('attestationEvidence is required.'); })(),
    expectedEnvironmentIdentity: required(request.expectedEnvironmentIdentity, 'expectedEnvironmentIdentity'),
    providerPolicyId: required(request.providerPolicyId, 'providerPolicyId')
  };
}

function requireVerifier(value, name) {
  if (typeof value !== 'function') throw new Error(`${name} verifier is required.`);
  return value;
}

export function createSecureProviderContract({
  endpoint,
  fetchImpl = globalThis.fetch,
  verifyConfirmation,
  verifyAttestation,
  evaluatePolicy
} = {}) {
  const base = required(endpoint, 'provider.endpoint').replace(/\/$/, '');
  const confirm = requireVerifier(verifyConfirmation, 'DPU confirmation');
  const attest = requireVerifier(verifyAttestation, 'attestation');
  const policy = requireVerifier(evaluatePolicy, 'provider policy');
  const invoke = async (targetPath, init = {}) => {
    const response = await fetchImpl(`${base}${targetPath}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) }
    });
    if (!response.ok) throw new Error(`Secure provider failed (${response.status}).`);
    return response.status === 204 ? {} : response.json();
  };
  const authorize = async (request) => {
    const normalized = validateSecureExecutionRequest(request);
    const confirmation = await confirm(normalized.confirmationProposalId, request);
    if (!confirmation?.valid) throw new Error('A valid actor-bound DPU confirmation is required.');
    const attestation = await attest(normalized.attestationEvidence, request);
    if (!attestation?.verified) throw new Error('TEE/CVM attestation verification failed.');
    if (String(attestation.environmentIdentity || '') !== normalized.expectedEnvironmentIdentity) {
      throw new Error('Secure environment identity mismatch.');
    }
    const decision = await policy(normalized.providerPolicyId, { ...request, attestation, confirmation });
    if (!decision?.allowed) throw new Error('Provider policy denied the workload.');
    return { normalized, confirmation, attestation, decision };
  };
  return {
    async submitWorkload(request) {
      const authorization = await authorize(request);
      return invoke('/workloads', {
        method: 'POST',
        body: JSON.stringify({ ...request, verifiedAuthorization: authorization })
      });
    },
    getJob: (id) => invoke(`/workloads/${encodeURIComponent(required(id, 'id'))}`),
    cancelJob: (id) => invoke(`/workloads/${encodeURIComponent(required(id, 'id'))}`, { method: 'DELETE' }),
    getEvidence: (id) => invoke(`/workloads/${encodeURIComponent(required(id, 'id'))}/evidence`),
    async releaseOutput(id, request = {}) {
      await authorize(request);
      return invoke(`/workloads/${encodeURIComponent(required(id, 'id'))}/outputs`, {
        method: 'POST', body: JSON.stringify(request)
      });
    }
  };
}
