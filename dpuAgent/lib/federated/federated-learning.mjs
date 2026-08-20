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

export function createFederatedLearningBroker({
  backend,
  verifyConfirmation,
  resolveParticipantResource
} = {}) {
  if (typeof verifyConfirmation !== 'function') throw new Error('DPU confirmation verifier is required.');
  if (typeof resolveParticipantResource !== 'function') throw new Error('Participant resource resolver is required.');
  if (!backend || ['submit', 'get', 'cancel'].some((method) => typeof backend[method] !== 'function')) {
    throw new Error('A federated backend implementing submit, get and cancel is required.');
  }
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
      return backend.submit(normalized);
    },
    get: backend.get.bind(backend),
    cancel: backend.cancel.bind(backend)
  };
}
