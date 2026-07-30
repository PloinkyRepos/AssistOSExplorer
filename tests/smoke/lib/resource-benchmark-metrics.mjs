import { createHash } from 'node:crypto';

import {
  normalizeBenchmarkLabel,
  roundMetric,
  summarizeValues,
} from './ui-benchmark-metrics.mjs';

export const RESOURCE_BENCHMARK_SCHEMA_VERSION = 1;
export const RESOURCE_BENCHMARK_SCENARIO_VERSION = 'explorer-resource-idle-v1';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BOX_ROLE_LABEL = 'io.assistos.ploinky-box.role';
const SAMPLE_FIELDS = Object.freeze([
  'cpuBusyPercent',
  'elapsedMs',
  'load1',
  'load15',
  'load5',
  'memoryAvailableBytes',
  'memoryUsedBytes',
  'processCount',
  'runnableEntities',
  'swapUsedBytes',
  'timestamp',
  'totalEntities',
  'zombieCount',
]);

const COMPARISON_METRICS = Object.freeze([
  Object.freeze({ name: 'cpuBusyPercent', statistic: 'p95', unit: 'percent' }),
  Object.freeze({ name: 'memoryUsedBytes', statistic: 'p95', unit: 'bytes' }),
  Object.freeze({ name: 'swapUsedBytes', statistic: 'p95', unit: 'bytes' }),
  Object.freeze({ name: 'load1', statistic: 'p95', unit: 'load' }),
  Object.freeze({ name: 'processCount', statistic: 'p95', unit: 'count' }),
  Object.freeze({ name: 'zombieCount', statistic: 'max', unit: 'count' }),
]);

const SLOPE_METRICS = Object.freeze([
  Object.freeze({ name: 'memoryUsedBytes', unit: 'bytes-per-minute' }),
  Object.freeze({ name: 'processCount', unit: 'count-per-minute' }),
  Object.freeze({ name: 'zombieCount', unit: 'count-per-minute' }),
]);

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortedValue(nested)]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortedValue(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function exactPositiveInteger(value, name, { minimum = 1 } = {}) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return numeric;
}

function exactSafeId(value, name) {
  const text = String(value || '').trim();
  if (!SAFE_ID_PATTERN.test(text)) {
    throw new Error(`${name} must use 1-80 letters, numbers, dots, underscores, or dashes.`);
  }
  return text;
}

function exactSha(value, name) {
  const text = String(value || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(text)) throw new Error(`${name} must be an exact 40-hex Git SHA.`);
  return text;
}

function finiteMetric(value, name) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${name} must be finite.`);
  return numeric;
}

export function buildResourceScenario({
  workloadId = 'idle-steady',
  warmupSeconds = 300,
  durationSeconds = 1_800,
  intervalSeconds = 10,
  expectedTargets = 16,
} = {}) {
  const descriptor = {
    version: RESOURCE_BENCHMARK_SCENARIO_VERSION,
    workloadId: exactSafeId(workloadId, 'Resource benchmark workload ID'),
    warmupSeconds: exactPositiveInteger(warmupSeconds, 'Resource benchmark warmup seconds', {
      minimum: 0,
    }),
    durationSeconds: exactPositiveInteger(durationSeconds, 'Resource benchmark duration seconds'),
    intervalSeconds: exactPositiveInteger(intervalSeconds, 'Resource benchmark interval seconds'),
    expectedTargets: exactPositiveInteger(expectedTargets, 'Expected running target count'),
  };
  if (descriptor.workloadId !== 'idle-steady') {
    throw new Error('Resource benchmark schema v1 supports only the idle-steady workload.');
  }
  if (descriptor.intervalSeconds * 2 > descriptor.durationSeconds) {
    throw new Error('Resource benchmark duration must contain at least two sampling intervals.');
  }
  return Object.freeze({
    ...descriptor,
    fingerprint: sha256(canonicalJson(descriptor)),
  });
}

export function buildHostControls({
  platform,
  architecture,
  kernelRelease,
  osId,
  osVersionId,
  logicalCpuCount,
  cpuModel,
  totalMemoryBytes,
  containerRuntime,
  containerRuntimeVersion,
  nodeVersion,
} = {}) {
  const descriptor = {
    platform: exactSafeId(platform, 'Host platform'),
    architecture: exactSafeId(architecture, 'Host architecture'),
    kernelRelease: String(kernelRelease || '').trim(),
    osId: exactSafeId(osId, 'Host OS ID'),
    osVersionId: String(osVersionId || '').trim(),
    logicalCpuCount: exactPositiveInteger(logicalCpuCount, 'Host logical CPU count'),
    cpuModel: String(cpuModel || '').trim(),
    totalMemoryBytes: exactPositiveInteger(totalMemoryBytes, 'Host total memory bytes'),
    containerRuntime: exactSafeId(containerRuntime, 'Container runtime'),
    containerRuntimeVersion: String(containerRuntimeVersion || '').trim(),
    nodeVersion: String(nodeVersion || '').trim(),
  };
  for (const field of [
    'kernelRelease',
    'osVersionId',
    'cpuModel',
    'containerRuntimeVersion',
    'nodeVersion',
  ]) {
    if (!descriptor[field]) throw new Error(`Host ${field} is required.`);
  }
  return Object.freeze({
    ...descriptor,
    fingerprint: sha256(canonicalJson(descriptor)),
  });
}

export function parseProcStat(source) {
  const firstLine = String(source || '').split(/\r?\n/, 1)[0].trim();
  const fields = firstLine.split(/\s+/);
  if (fields[0] !== 'cpu' || fields.length < 6) {
    throw new Error('/proc/stat does not contain an aggregate CPU row.');
  }
  const ticks = fields.slice(1).map(Number);
  if (ticks.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('/proc/stat contains invalid aggregate CPU ticks.');
  }
  // Linux user/nice counters already include guest/guest_nice. Summing the
  // trailing guest fields again would overstate elapsed CPU time on a host
  // that itself runs virtual CPUs.
  const accountedTicks = ticks.slice(0, 8);
  return Object.freeze({
    total: accountedTicks.reduce((sum, value) => sum + value, 0),
    idle: (ticks[3] || 0) + (ticks[4] || 0),
  });
}

export function cpuBusyPercent(previous, current) {
  const totalDelta = finiteMetric(current?.total, 'Current CPU total')
    - finiteMetric(previous?.total, 'Previous CPU total');
  const idleDelta = finiteMetric(current?.idle, 'Current CPU idle')
    - finiteMetric(previous?.idle, 'Previous CPU idle');
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) {
    throw new Error('Aggregate CPU counters did not advance monotonically.');
  }
  return roundMetric(((totalDelta - idleDelta) / totalDelta) * 100);
}

export function parseMeminfo(source) {
  const entries = new Map();
  for (const line of String(source || '').split(/\r?\n/)) {
    const match = /^([A-Za-z_()]+):\s+([0-9]+)\s+kB$/.exec(line.trim());
    if (match) entries.set(match[1], Number(match[2]) * 1_024);
  }
  for (const name of ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']) {
    if (!Number.isFinite(entries.get(name))) {
      throw new Error(`/proc/meminfo is missing ${name}.`);
    }
  }
  const totalMemoryBytes = entries.get('MemTotal');
  const availableMemoryBytes = entries.get('MemAvailable');
  const totalSwapBytes = entries.get('SwapTotal');
  const freeSwapBytes = entries.get('SwapFree');
  if (availableMemoryBytes > totalMemoryBytes || freeSwapBytes > totalSwapBytes) {
    throw new Error('/proc/meminfo contains inconsistent memory totals.');
  }
  return Object.freeze({
    totalMemoryBytes,
    availableMemoryBytes,
    memoryUsedBytes: totalMemoryBytes - availableMemoryBytes,
    totalSwapBytes,
    swapUsedBytes: totalSwapBytes - freeSwapBytes,
  });
}

export function parseLoadavg(source) {
  const fields = String(source || '').trim().split(/\s+/);
  const entityMatch = /^([0-9]+)\/([0-9]+)$/.exec(fields[3] || '');
  const load = fields.slice(0, 3).map(Number);
  if (load.some((value) => !Number.isFinite(value) || value < 0) || !entityMatch) {
    throw new Error('/proc/loadavg is invalid.');
  }
  return Object.freeze({
    load1: load[0],
    load5: load[1],
    load15: load[2],
    runnableEntities: Number(entityMatch[1]),
    totalEntities: Number(entityMatch[2]),
  });
}

export function processStateFromStat(source) {
  const text = String(source || '').trim();
  const closing = text.lastIndexOf(')');
  if (closing < 1 || text[closing + 1] !== ' ' || !text[closing + 2]) {
    throw new Error('/proc process stat row is invalid.');
  }
  return text[closing + 2];
}

export function summarizeResourceSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error('At least two resource samples are required.');
  }
  let previousElapsed = -1;
  for (const [index, sample] of samples.entries()) {
    const elapsed = finiteMetric(sample?.elapsedMs, `Resource sample ${index} elapsedMs`);
    if (elapsed <= previousElapsed) {
      throw new Error('Resource sample elapsed times must increase strictly.');
    }
    previousElapsed = elapsed;
  }
  const metricNames = [
    'cpuBusyPercent',
    'memoryUsedBytes',
    'memoryAvailableBytes',
    'swapUsedBytes',
    'load1',
    'load5',
    'load15',
    'processCount',
    'zombieCount',
    'runnableEntities',
    'totalEntities',
  ];
  const metrics = Object.fromEntries(metricNames.map((name) => [
    name,
    summarizeValues(samples.map((sample) => sample[name])),
  ]));
  const slopesPerMinute = Object.fromEntries(
    SLOPE_METRICS.map(({ name }) => [name, roundMetric(linearSlopePerMinute(samples, name), 6)]),
  );
  return Object.freeze({
    sampleCount: samples.length,
    elapsedMs: roundMetric(samples.at(-1).elapsedMs - samples[0].elapsedMs),
    metrics,
    slopesPerMinute,
    first: Object.fromEntries(metricNames.map((name) => [name, samples[0][name]])),
    last: Object.fromEntries(metricNames.map((name) => [name, samples.at(-1)[name]])),
  });
}

export function linearSlopePerMinute(samples, metricName) {
  const points = (Array.isArray(samples) ? samples : [])
    .map((sample) => ({
      x: Number(sample?.elapsedMs) / 60_000,
      y: Number(sample?.[metricName]),
    }))
    .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function labelsFromRow(row) {
  if (row?.Labels && typeof row.Labels === 'object' && !Array.isArray(row.Labels)) {
    return row.Labels;
  }
  const labels = {};
  for (const entry of String(row?.Labels || '').split(',')) {
    const separator = entry.indexOf('=');
    if (separator > 0) labels[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return labels;
}

function rowName(row) {
  const candidate = Array.isArray(row?.Names)
    ? row.Names[0]
    : (row?.Names || row?.Name || '');
  return String(candidate).replace(/^\//, '');
}

function rowId(row) {
  return String(row?.Id || row?.ID || '').trim().toLowerCase();
}

export function parseContainerRows(source) {
  const text = String(source || '').trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      throw new Error('Container runtime returned invalid JSON inventory.');
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Container runtime inventory row ${index} is invalid.`);
    }
    return row;
  });
}

function targetRows(rows) {
  return rows.filter((row) => rowName(row).startsWith('ploinky_'));
}

function identityFingerprint(rows) {
  const identities = rows.map((row) => `${rowId(row)}:${rowName(row)}`).sort();
  if (identities.some((identity) => identity.startsWith(':'))) {
    throw new Error('Running target inventory is missing an exact container ID.');
  }
  return sha256(canonicalJson(identities));
}

export function classifyRuntimeEvidence({
  variant,
  hostRows,
  nestedRows = null,
  expectedTargets,
} = {}) {
  const normalizedVariant = String(variant || '').trim();
  if (!['master', 'ploinky-proxy'].includes(normalizedVariant)) {
    throw new Error('Deployment variant must be master or ploinky-proxy.');
  }
  const requiredTargets = exactPositiveInteger(expectedTargets, 'Expected running target count');
  if (!Array.isArray(hostRows)) throw new Error('Host container inventory must be an array.');
  const boxes = hostRows.filter((row) => labelsFromRow(row)[BOX_ROLE_LABEL] === 'box');
  let topology;
  let targets;
  let outerBoxName = null;
  let outerBoxIdentityFingerprint = null;
  if (normalizedVariant === 'master') {
    if (boxes.length !== 0) {
      throw new Error('Master reference deployment must not contain a running outer Ploinky Box.');
    }
    topology = 'direct';
    targets = targetRows(hostRows);
  } else {
    if (boxes.length !== 1) {
      throw new Error('Ploinky-proxy deployment must contain exactly one running outer Ploinky Box.');
    }
    if (!Array.isArray(nestedRows)) {
      throw new Error('Ploinky-proxy deployment requires nested container inventory.');
    }
    topology = 'box';
    targets = targetRows(nestedRows);
    outerBoxName = rowName(boxes[0]);
    outerBoxIdentityFingerprint = identityFingerprint(boxes);
  }
  if (targets.length !== requiredTargets) {
    throw new Error(
      `${normalizedVariant} deployment has ${targets.length} running Ploinky targets; expected exactly ${requiredTargets}.`,
    );
  }
  return Object.freeze({
    variant: normalizedVariant,
    topology,
    outerBoxCount: boxes.length,
    outerBoxName,
    outerBoxIdentityFingerprint,
    expectedTargetCount: requiredTargets,
    runningTargetCount: targets.length,
    targetIdentityFingerprint: identityFingerprint(targets),
    exactGraph: true,
  });
}

export function assertRuntimeEvidenceStable(evidence) {
  const phases = ['beforeWarmup', 'afterWarmup', 'afterSampling'];
  for (const phase of phases) {
    const current = evidence?.[phase];
    if (!current?.exactGraph) {
      throw new Error(`Resource benchmark runtime evidence is missing exact ${phase} graph state.`);
    }
    if (!['master', 'ploinky-proxy'].includes(current.variant)) {
      throw new Error(`Resource benchmark runtime evidence ${phase} variant is invalid.`);
    }
    const expectedTopology = current.variant === 'master' ? 'direct' : 'box';
    if (current.topology !== expectedTopology) {
      throw new Error(`Resource benchmark runtime evidence ${phase} topology is invalid.`);
    }
    const expectedTargets = exactPositiveInteger(
      current.expectedTargetCount,
      `Resource benchmark runtime evidence ${phase} expected targets`,
    );
    if (
      current.runningTargetCount !== expectedTargets
      || current.outerBoxCount !== (current.variant === 'master' ? 0 : 1)
      || !SHA256_PATTERN.test(String(current.targetIdentityFingerprint || ''))
    ) {
      throw new Error(`Resource benchmark runtime evidence ${phase} identity is invalid.`);
    }
    if (current.variant === 'master') {
      if (current.outerBoxName !== null || current.outerBoxIdentityFingerprint !== null) {
        throw new Error(`Resource benchmark runtime evidence ${phase} master Box state is invalid.`);
      }
    } else if (
      !SAFE_ID_PATTERN.test(String(current.outerBoxName || ''))
      || !SHA256_PATTERN.test(String(current.outerBoxIdentityFingerprint || ''))
    ) {
      throw new Error(`Resource benchmark runtime evidence ${phase} Box identity is invalid.`);
    }
  }
  const baseline = evidence.beforeWarmup;
  for (const phase of phases.slice(1)) {
    const current = evidence[phase];
    for (const field of [
      'variant',
      'topology',
      'outerBoxCount',
      'outerBoxIdentityFingerprint',
      'expectedTargetCount',
      'runningTargetCount',
      'targetIdentityFingerprint',
    ]) {
      if (current[field] !== baseline[field]) {
        throw new Error(`Resource benchmark runtime changed during measurement: ${phase}.${field}.`);
      }
    }
  }
  return true;
}

function exactIsoTimestamp(value, name) {
  const text = String(value || '').trim();
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
    throw new Error(`${name} must be an exact ISO timestamp.`);
  }
  return text;
}

function validateSamples(report, scenario, host) {
  if (!Array.isArray(report.samples)) {
    throw new Error('Resource benchmark samples must be an array.');
  }
  const expectedCount = Math.floor(scenario.durationSeconds / scenario.intervalSeconds);
  if (report.samples.length !== expectedCount) {
    throw new Error(
      `Resource benchmark must contain exactly ${expectedCount} samples; got ${report.samples.length}.`,
    );
  }
  let previousElapsed = 0;
  for (const [index, sample] of report.samples.entries()) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      throw new Error(`Resource benchmark sample ${index} is invalid.`);
    }
    const keys = Object.keys(sample).sort();
    if (canonicalJson(keys) !== canonicalJson(SAMPLE_FIELDS)) {
      throw new Error(`Resource benchmark sample ${index} fields are invalid.`);
    }
    exactIsoTimestamp(sample.timestamp, `Resource benchmark sample ${index} timestamp`);
    for (const field of SAMPLE_FIELDS.filter((name) => name !== 'timestamp')) {
      finiteMetric(sample[field], `Resource benchmark sample ${index}.${field}`);
    }
    if (
      sample.elapsedMs < previousElapsed + (scenario.intervalSeconds * 1_000)
      || sample.cpuBusyPercent < 0
      || sample.cpuBusyPercent > 100
      || sample.memoryUsedBytes < 0
      || sample.memoryAvailableBytes < 0
      || sample.memoryUsedBytes + sample.memoryAvailableBytes !== host.totalMemoryBytes
      || sample.swapUsedBytes < 0
      || sample.load1 < 0
      || sample.load5 < 0
      || sample.load15 < 0
    ) {
      throw new Error(`Resource benchmark sample ${index} resource values are invalid.`);
    }
    for (const field of [
      'processCount',
      'zombieCount',
      'runnableEntities',
      'totalEntities',
    ]) {
      if (!Number.isSafeInteger(sample[field]) || sample[field] < 0) {
        throw new Error(`Resource benchmark sample ${index}.${field} must be a non-negative integer.`);
      }
    }
    if (
      sample.zombieCount > sample.processCount
      || sample.runnableEntities > sample.totalEntities
    ) {
      throw new Error(`Resource benchmark sample ${index} process values are inconsistent.`);
    }
    previousElapsed = sample.elapsedMs;
  }
  const recomputed = summarizeResourceSamples(report.samples);
  if (canonicalJson(recomputed) !== canonicalJson(report.summary)) {
    throw new Error('Resource benchmark summary does not match its raw samples.');
  }
  return recomputed;
}

function validateScenario(scenario) {
  const rebuilt = buildResourceScenario(scenario || {});
  if (rebuilt.fingerprint !== scenario?.fingerprint) {
    throw new Error('Resource benchmark scenario fingerprint is invalid.');
  }
  return rebuilt;
}

function validateHost(host) {
  const rebuilt = buildHostControls(host || {});
  if (rebuilt.fingerprint !== host?.fingerprint) {
    throw new Error('Resource benchmark host fingerprint is invalid.');
  }
  return rebuilt;
}

function validateDeployment(deployment) {
  const variant = String(deployment?.variant || '').trim();
  if (!['master', 'ploinky-proxy'].includes(variant)) {
    throw new Error('Resource benchmark deployment variant is invalid.');
  }
  return {
    variant,
    deploymentId: exactSafeId(deployment?.deploymentId, 'Resource benchmark deployment ID'),
    ploinkySha: exactSha(deployment?.ploinkySha, 'Deployed Ploinky SHA'),
    explorerSha: exactSha(deployment?.explorerSha, 'Deployed Explorer SHA'),
  };
}

export function validateResourceReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Resource benchmark report must be an object.');
  }
  if (report.schemaVersion !== RESOURCE_BENCHMARK_SCHEMA_VERSION) {
    throw new Error(`Resource benchmark report must use schema version ${RESOURCE_BENCHMARK_SCHEMA_VERSION}.`);
  }
  if (report.kind !== 'explorer-resource-benchmark') {
    throw new Error('Resource benchmark report kind is invalid.');
  }
  if (report.status !== 'passed') {
    throw new Error('Only passed resource benchmark reports can be compared.');
  }
  if (normalizeBenchmarkLabel(report.label) !== report.label) {
    throw new Error('Resource benchmark label is invalid.');
  }
  const scenario = validateScenario(report.scenario);
  const host = validateHost(report.environment?.host);
  const deployment = validateDeployment(report.deployment);
  exactIsoTimestamp(report.generatedAt, 'Resource benchmark generatedAt');
  assertRuntimeEvidenceStable(report.runtimeEvidence);
  if (report.runtimeEvidence.beforeWarmup.variant !== deployment.variant) {
    throw new Error('Resource benchmark deployment and runtime variants do not match.');
  }
  const expectedTopology = deployment.variant === 'master' ? 'direct' : 'box';
  if (report.runtimeEvidence.beforeWarmup.topology !== expectedTopology) {
    throw new Error('Resource benchmark topology does not match its deployment variant.');
  }
  if (report.runtimeEvidence.beforeWarmup.expectedTargetCount !== scenario.expectedTargets) {
    throw new Error('Resource benchmark runtime target count does not match its scenario.');
  }
  validateSamples(report, scenario, host);
  for (const { name, statistic } of COMPARISON_METRICS) {
    finiteMetric(report.summary.metrics?.[name]?.[statistic], `Resource summary ${name}.${statistic}`);
  }
  for (const { name } of SLOPE_METRICS) {
    finiteMetric(report.summary.slopesPerMinute?.[name], `Resource summary ${name} slope`);
  }
  return { scenario, host, deployment };
}

function metricComparison(name, unit, statistic, baselineValue, candidateValue) {
  const left = finiteMetric(baselineValue, `Baseline ${name}`);
  const right = finiteMetric(candidateValue, `Candidate ${name}`);
  const delta = right - left;
  return {
    name,
    unit,
    statistic,
    baseline: roundMetric(left, 6),
    candidate: roundMetric(right, 6),
    delta: roundMetric(delta, 6),
    deltaPercent: left !== 0 ? roundMetric((delta / left) * 100, 6) : null,
    ratio: left !== 0 ? roundMetric(right / left, 6) : null,
  };
}

export function compareResourceReports(baseline, candidate) {
  const baselineControls = validateResourceReport(baseline);
  const candidateControls = validateResourceReport(candidate);
  if (baselineControls.deployment.variant !== 'master') {
    throw new Error('The resource benchmark reference report must be a master deployment.');
  }
  if (candidateControls.deployment.variant !== 'ploinky-proxy') {
    throw new Error('The resource benchmark candidate report must be a ploinky-proxy deployment.');
  }
  if (baselineControls.scenario.fingerprint !== candidateControls.scenario.fingerprint) {
    throw new Error('Resource benchmark scenario controls do not match.');
  }
  if (baselineControls.host.fingerprint !== candidateControls.host.fingerprint) {
    throw new Error('Resource benchmark host controls do not match.');
  }
  const metrics = COMPARISON_METRICS.map(({ name, statistic, unit }) => metricComparison(
    name,
    unit,
    statistic,
    baseline.summary.metrics[name][statistic],
    candidate.summary.metrics[name][statistic],
  ));
  const slopes = SLOPE_METRICS.map(({ name, unit }) => metricComparison(
    name,
    unit,
    'linear-slope',
    baseline.summary.slopesPerMinute[name],
    candidate.summary.slopesPerMinute[name],
  ));
  return {
    schemaVersion: RESOURCE_BENCHMARK_SCHEMA_VERSION,
    kind: 'explorer-resource-benchmark-comparison',
    generatedAt: new Date().toISOString(),
    reference: {
      label: baseline.label,
      variant: baselineControls.deployment.variant,
      deploymentId: baselineControls.deployment.deploymentId,
      ploinkySha: baselineControls.deployment.ploinkySha,
      explorerSha: baselineControls.deployment.explorerSha,
    },
    candidate: {
      label: candidate.label,
      variant: candidateControls.deployment.variant,
      deploymentId: candidateControls.deployment.deploymentId,
      ploinkySha: candidateControls.deployment.ploinkySha,
      explorerSha: candidateControls.deployment.explorerSha,
    },
    controls: {
      scenario: baselineControls.scenario,
      host: baselineControls.host,
    },
    metrics,
    slopes,
  };
}
