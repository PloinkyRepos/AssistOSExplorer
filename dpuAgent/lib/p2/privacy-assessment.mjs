export function assessExperimentPrivacy(experiment = {}) {
  const risks = [];
  if (!experiment.privacy?.differentialPrivacy) risks.push({ id: 'reconstruction', severity: 'high', recommendation: 'Enable and budget differential privacy.' });
  if (!experiment.privacy?.secureAggregation) risks.push({ id: 'update-observation', severity: 'high', recommendation: 'Require secure aggregation.' });
  if ((experiment.participants || []).length < 3) risks.push({ id: 'small-anonymity-set', severity: 'high', recommendation: 'Use at least three participants.' });
  if (!experiment.evaluation?.leakageTests) risks.push({ id: 'evaluation-leakage', severity: 'medium', recommendation: 'Run membership and reconstruction leakage tests.' });
  return { threatModel: 'federated-research-v1', allowed: risks.every((risk) => risk.severity !== 'high'), risks, achillesHooks: ['VeriProv', 'FL-LR'], utilityEvidenceRequired: true };
}
