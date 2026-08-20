const STRATEGIES = ['fedavg', 'fedprox', 'scaffold', 'custom'];
export function validateFederatedExperiment(value = {}) {
  const participants = Array.isArray(value.participants) ? value.participants : [];
  if (participants.length < 3) throw new Error('Federated experiments require at least three participants.');
  if (participants.some((participant) => !participant.id || !participant.resourceId || participant.rawDataTransfer === true)) throw new Error('Each participant needs a local resource and rawDataTransfer must remain false.');
  if (!value.model?.id || !value.model?.version) throw new Error('An exact model id and version are required.');
  if (!STRATEGIES.includes(String(value.strategy || '').toLowerCase())) throw new Error(`strategy must be one of: ${STRATEGIES.join(', ')}.`);
  if (value.privacy?.secureAggregation !== true) throw new Error('Secure aggregation is required.');
  return { ...structuredClone(value), participants: participants.map((participant) => ({ ...participant, rawDataTransfer: false })) };
}

export function createNvFlareContract({ endpoint, fetchImpl = fetch } = {}) {
  const base = String(endpoint || '').replace(/\/$/, '');
  if (!base) throw new Error('NVFlare endpoint is required.');
  const invoke = async (path, init = {}) => { const response = await fetchImpl(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }); if (!response.ok) throw new Error(`NVFlare operation failed (${response.status}).`); return response.json(); };
  return {
    submit: (experiment) => invoke('/experiments', { method: 'POST', body: JSON.stringify(validateFederatedExperiment(experiment)) }),
    get: (id) => invoke(`/experiments/${encodeURIComponent(id)}`),
    cancel: (id) => invoke(`/experiments/${encodeURIComponent(id)}`, { method: 'DELETE' })
  };
}

export function createFederatedLearningBroker({
  endpoint,
  fetchImpl = globalThis.fetch,
  verifyConfirmation,
  resolveParticipantResource
} = {}) {
  if (typeof verifyConfirmation !== 'function') throw new Error('DPU confirmation verifier is required.');
  if (typeof resolveParticipantResource !== 'function') throw new Error('Participant resource resolver is required.');
  const transport = createNvFlareContract({ endpoint, fetchImpl });
  return {
    async submit(experiment = {}) {
      const proposalId = String(experiment.confirmationProposalId || '').trim();
      if (!proposalId || !(await verifyConfirmation(proposalId, experiment))?.valid) {
        throw new Error('A valid actor-bound DPU confirmation is required.');
      }
      const normalized = validateFederatedExperiment(experiment);
      for (const participant of normalized.participants) {
        const resource = await resolveParticipantResource(participant);
        if (!resource?.localToParticipant || resource?.rawDataExportAllowed === true) {
          throw new Error(`Participant ${participant.id} does not have a verified local-only resource.`);
        }
      }
      return transport.submit(normalized);
    },
    get: transport.get,
    cancel: transport.cancel
  };
}
