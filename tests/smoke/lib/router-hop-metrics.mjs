import { summarizeValues } from './ui-benchmark-metrics.mjs';

export const ROUTER_HOP_SCHEMA_VERSION = 1;
export const ROUTER_HOP_SAMPLE_COUNT = 20;
export const ROUTER_HOP_CONCURRENCY = 8;

export const ROUTER_HOP_BOUNDARIES = Object.freeze([
  'host-router-login',
  'box-router-login',
  'explorer-nested-health',
  'explorer-box-health',
  'explorer-router-health',
  'dpu-nested-health',
  'dpu-box-health',
  'dpu-router-health',
  'git-nested-health',
  'git-box-health',
  'git-router-health',
]);

const SAMPLE_KEYS = Object.freeze([
  'errorCode',
  'status',
  'totalMs',
  'ttfbMs',
]);

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_ARTIFACT_TEXT = /(?:authorization|bearer|cookie|csrf|jwt|password|secret|token|api[-_]?key|https?:\/\/|[?&][^=\s]+=[^&\s]*)/i;

function assertExactKeys(value, expected, label) {
  const actual = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`Router-hop ${label} shape is invalid.`);
  }
}

function normalizeMetric(value) {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeStatus(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 599 ? numeric : 0;
}

function normalizeErrorCode(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).toUpperCase();
  return SAFE_ERROR_CODE.test(normalized) ? normalized : 'REQUEST_FAILED';
}

export function normalizeProbeSample(sample) {
  assertExactKeys(sample, SAMPLE_KEYS, 'sample');
  const status = normalizeStatus(sample.status);
  const ttfbMs = normalizeMetric(sample.ttfbMs);
  const totalMs = normalizeMetric(sample.totalMs);
  const errorCode = normalizeErrorCode(sample.errorCode);
  if (totalMs !== null && ttfbMs !== null && totalMs < ttfbMs) {
    throw new Error('Router-hop sample total time is smaller than TTFB.');
  }
  if (status === 0 && !errorCode) {
    throw new Error('Router-hop failed sample requires an error code.');
  }
  if (status !== 0 && errorCode) {
    throw new Error('Router-hop HTTP sample must not carry an error code.');
  }
  return Object.freeze({ status, ttfbMs, totalMs, errorCode });
}

function countValues(values) {
  return Object.fromEntries(
    [...new Set(values)].sort().map((value) => [
      String(value),
      values.filter((candidate) => candidate === value).length,
    ]),
  );
}

export function summarizeProbeSamples(samples, expectedCount = ROUTER_HOP_SAMPLE_COUNT) {
  if (!Array.isArray(samples) || samples.length !== expectedCount) {
    throw new Error(`Router-hop sample set must contain exactly ${expectedCount} samples.`);
  }
  const normalized = samples.map(normalizeProbeSample);
  const successful = normalized.filter((sample) => sample.status >= 200 && sample.status < 400);
  return Object.freeze({
    attempts: normalized.length,
    succeeded: successful.length,
    failed: normalized.length - successful.length,
    statusCounts: countValues(normalized.map((sample) => sample.status)),
    errorCodeCounts: countValues(
      normalized.map((sample) => sample.errorCode).filter(Boolean),
    ),
    ttfbMs: summarizeValues(successful.map((sample) => sample.ttfbMs)),
    totalMs: summarizeValues(successful.map((sample) => sample.totalMs)),
  });
}

export async function runBoundedSamples(operation, count, concurrency) {
  const sampleCount = Number(count);
  const workerCount = Number(concurrency);
  if (
    typeof operation !== 'function'
    || !Number.isSafeInteger(sampleCount)
    || sampleCount < 1
    || sampleCount > 1_000
    || !Number.isSafeInteger(workerCount)
    || workerCount < 1
    || workerCount > sampleCount
  ) {
    throw new Error('Router-hop sample controls are invalid.');
  }
  const results = new Array(sampleCount);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= sampleCount) return;
      results[index] = normalizeProbeSample(await operation(index));
    }
  });
  await Promise.all(workers);
  return results;
}

function validateIdentifier(value, label, pattern) {
  const normalized = String(value || '');
  if (!pattern.test(normalized)) {
    throw new Error(`Router-hop ${label} is invalid.`);
  }
  return normalized;
}

function assertArtifactSafe(artifact) {
  const serialized = JSON.stringify(artifact);
  if (FORBIDDEN_ARTIFACT_TEXT.test(serialized)) {
    throw new Error('Router-hop artifact contains forbidden request or credential material.');
  }
}

export function createRouterHopArtifact({
  label,
  deploymentId,
  ploinkySha,
  explorerSha,
  browser,
  boundarySamples,
  generatedAt = new Date().toISOString(),
  sequentialSamples = ROUTER_HOP_SAMPLE_COUNT,
  concurrentSamples = ROUTER_HOP_SAMPLE_COUNT,
  concurrency = ROUTER_HOP_CONCURRENCY,
} = {}) {
  const safeLabel = validateIdentifier(label, 'label', /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  const safeDeploymentId = validateIdentifier(
    deploymentId,
    'deployment identifier',
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  );
  const safePloinkySha = validateIdentifier(ploinkySha, 'Ploinky SHA', /^[0-9a-f]{40}$/);
  const safeExplorerSha = validateIdentifier(explorerSha, 'Explorer SHA', /^[0-9a-f]{40}$/);
  const safeGeneratedAt = validateIdentifier(
    generatedAt,
    'timestamp',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  );
  assertExactKeys(boundarySamples, ROUTER_HOP_BOUNDARIES, 'boundary set');
  const boundaries = Object.fromEntries(ROUTER_HOP_BOUNDARIES.map((name) => {
    const modes = boundarySamples[name];
    assertExactKeys(modes, ['concurrent', 'sequential'], `${name} modes`);
    return [name, {
      sequential: summarizeProbeSamples(modes.sequential, sequentialSamples),
      concurrent: summarizeProbeSamples(modes.concurrent, concurrentSamples),
    }];
  }));
  const artifact = {
    schemaVersion: ROUTER_HOP_SCHEMA_VERSION,
    kind: 'explorer-router-hop-probe',
    status: Object.values(boundaries).every((modes) => (
      modes.sequential.failed === 0 && modes.concurrent.failed === 0
    )) ? 'passed' : 'failed',
    generatedAt: safeGeneratedAt,
    label: safeLabel,
    deployment: {
      id: safeDeploymentId,
      ploinkySha: safePloinkySha,
      explorerSha: safeExplorerSha,
    },
    environment: {
      browser: validateIdentifier(browser, 'browser', /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/),
    },
    controls: {
      sequentialSamples,
      concurrentSamples,
      concurrency,
    },
    boundaries,
  };
  assertArtifactSafe(artifact);
  return Object.freeze(artifact);
}
