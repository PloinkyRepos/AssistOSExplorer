import { createHash } from 'node:crypto';
import path from 'node:path';

export const UI_BENCHMARK_SCHEMA_VERSION = 2;
export const UI_BENCHMARK_SCENARIO_VERSION = 'explorer-ui-v1';
export const UI_BENCHMARK_ACTIVE_REQUEST_COUNT_LIMIT = 1_000;

const SENSITIVE_TEXT = /\b(authorization|bearer|cookie|csrf|jwt|password|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi;
const AUTHORIZATION_BEARER_TEXT = /\b(authorization)\s*[:=]\s*bearer\s+[^\s,;]+/gi;
const BARE_BEARER_TEXT = /\b(bearer)\s+[A-Za-z0-9._~+/-]+=*/gi;

export function roundMetric(value, digits = 3) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

export function percentile(values, quantile) {
  const sorted = (Array.isArray(values) ? values : [])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const bounded = Math.min(1, Math.max(0, Number(quantile)));
  const index = (sorted.length - 1) * bounded;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

export function summarizeValues(values) {
  const numeric = (Array.isArray(values) ? values : [])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
  if (!numeric.length) {
    return {
      count: 0,
      min: null,
      median: null,
      p95: null,
      max: null,
      mean: null,
    };
  }
  return {
    count: numeric.length,
    min: roundMetric(Math.min(...numeric)),
    median: roundMetric(percentile(numeric, 0.5)),
    p95: roundMetric(percentile(numeric, 0.95)),
    max: roundMetric(Math.max(...numeric)),
    mean: roundMetric(numeric.reduce((sum, value) => sum + value, 0) / numeric.length),
  };
}

export function normalizeBenchmarkBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('UI benchmark base URL must be an absolute HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('UI benchmark base URL must be credential-free and contain no query or hash.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.href.replace(/\/$/, '');
}

export function normalizeBenchmarkPath(value, name) {
  const text = String(value || '').trim();
  if (!text.startsWith('/') || text.includes('\0')) {
    throw new Error(`${name} must be an absolute Explorer path.`);
  }
  const normalized = path.posix.normalize(text);
  if (normalized === '/' || normalized.startsWith('/../') || normalized === '/..') {
    throw new Error(`${name} must select a path below the Explorer root.`);
  }
  return normalized;
}

export function normalizeBenchmarkLabel(value) {
  const label = String(value || '').trim();
  if (!label) throw new Error('UI benchmark label is required.');
  if (label.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error('UI benchmark label must use 1-80 letters, numbers, dots, underscores, or dashes.');
  }
  return label;
}

export function sanitizeError(error) {
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_$.-]/g, '').slice(0, 80) || 'Error';
  const firstLine = String(error?.message || error || 'Unknown benchmark failure').split(/\r?\n/, 1)[0];
  const withoutUrls = firstLine.replace(/https?:\/\/[^\s)]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '<redacted-url>';
    }
  });
  return {
    name,
    message: withoutUrls
      .replace(AUTHORIZATION_BEARER_TEXT, '$1=<redacted>')
      .replace(SENSITIVE_TEXT, '$1=<redacted>')
      .replace(BARE_BEARER_TEXT, '$1 <redacted>')
      .slice(0, 500),
  };
}

export function classifyRequestPath(pathname) {
  const value = String(pathname || '/');
  if (/^\/auth(?:\/|$)/i.test(value) || /^\/dashboard\/whoami(?:\/|$)/i.test(value)) return 'auth';
  if (/^\/(?:base-agent-additional-server\/)?dpuAgent(?:\/|$)/i.test(value)) return 'dpu-agent';
  if (/^\/(?:base-agent-additional-server\/)?gitAgent(?:\/|$)/i.test(value)) return 'git-agent';
  if (/^\/(?:base-agent-additional-server\/)?explorer(?:\/mcp|\/[^/]+\/mcp)(?:\/|$)/i.test(value)) return 'explorer-agent';
  if (/^\/explorer\/mcp(?:\/|$)/i.test(value)) return 'explorer-agent';
  if (/^\/workspace-files(?:\/|$)/i.test(value)) return 'workspace-files';
  if (/^\/explorer(?:\/|$)/i.test(value)) return 'explorer-ui';
  if (/^\/dashboard(?:\/|$)/i.test(value)) return 'dashboard';
  return 'router-other';
}

export function safeRequestTarget(rawUrl, baseUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''), baseUrl);
    const base = new URL(baseUrl);
    const sameOrigin = parsed.origin === base.origin;
    return {
      scope: sameOrigin ? 'router' : 'external',
      pathname: sameOrigin ? (parsed.pathname || '/') : '<external>',
      category: sameOrigin ? classifyRequestPath(parsed.pathname) : 'external',
    };
  } catch {
    return {
      scope: 'invalid',
      pathname: '<invalid-url>',
      category: 'invalid',
    };
  }
}

function summarizeRequestGroup(requests) {
  const records = Array.isArray(requests) ? requests : [];
  const completed = records.filter((request) => Number.isFinite(request.totalMs));
  const ttfb = records.map((request) => request.ttfbMs).filter(Number.isFinite);
  const total = completed.map((request) => request.totalMs);
  const transferBytes = records.reduce((sum, request) => (
    sum + (Number.isFinite(request.transferBytes) ? request.transferBytes : 0)
  ), 0);
  const duplicateKeys = new Map();
  for (const request of records) {
    const key = `${request.method || 'GET'} ${request.pathname || '/'}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  return {
    started: records.length,
    completed: completed.length,
    failed: records.filter((request) => request.failed).length,
    canceled: records.filter((request) => request.canceled).length,
    cacheHits: records.filter((request) => request.cacheHit).length,
    transferBytes,
    ttfbMs: summarizeValues(ttfb),
    totalMs: summarizeValues(total),
    duplicateRequests: Array.from(duplicateKeys.values()).reduce(
      (sum, count) => sum + (count > 1 ? count - 1 : 0),
      0,
    ),
  };
}

export function summarizeRequests(requests) {
  const records = Array.isArray(requests) ? requests : [];
  const byCategory = {};
  for (const request of records) {
    const category = request.category || 'unknown';
    (byCategory[category] ||= []).push(request);
  }
  return {
    ...summarizeRequestGroup(records),
    byCategory: Object.fromEntries(
      Object.entries(byCategory)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, categoryRequests]) => [category, summarizeRequestGroup(categoryRequests)]),
    ),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createScenarioFingerprint(scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    throw new Error('Benchmark scenario descriptor is invalid.');
  }
  const descriptor = Object.fromEntries(
    Object.entries(scenario).filter(([key]) => key !== 'fingerprint'),
  );
  return createHash('sha256').update(canonicalJson(descriptor)).digest('hex');
}

function summarizeObserverStates(states) {
  const observations = Array.isArray(states) ? states : [];
  return {
    attempts: observations.length,
    available: observations.filter((state) => state?.available === true).length,
    unsupported: observations.filter((state) => state?.supported === false).length,
    failed: observations.filter((state) => (
      state?.supported === true && state?.available !== true
    )).length,
    unknown: observations.filter((state) => (
      state?.supported !== true && state?.supported !== false
    )).length,
  };
}

export function summarizeBenchmarkIterations(iterations) {
  const runs = Array.isArray(iterations) ? iterations : [];
  const names = [];
  for (const iteration of runs) {
    for (const step of iteration?.steps || []) {
      if (!names.includes(step.name)) names.push(step.name);
    }
  }
  const steps = names.map((name) => {
    const attempts = runs
      .flatMap((iteration) => iteration?.steps || [])
      .filter((step) => step.name === name);
    const passed = attempts.filter((step) => step.status === 'passed');
    const completedTails = passed.filter((step) => step.networkTail?.complete === true);
    const cutoffTails = passed.filter((step) => (
      step.networkTail?.complete === false && step.networkTail?.status === 'cutoff'
    ));
    return {
      name,
      attempts: attempts.length,
      passed: passed.length,
      failed: attempts.filter((step) => step.status === 'failed').length,
      durationMs: summarizeValues(passed.map((step) => step.durationMs)),
      settledMs: summarizeValues(completedTails.map((step) => step.settledMs)),
      networkTail: {
        complete: completedTails.length,
        cutoff: cutoffTails.length,
        invalid: passed.length - completedTails.length - cutoffTails.length,
        activeRequestsAtCutoff: summarizeValues(
          cutoffTails.map((step) => step.networkTail?.activeRequestsAtCutoff),
        ),
      },
      requests: summarizeValues(passed.map((step) => step.network?.started)),
      transferBytes: summarizeValues(passed.map((step) => step.network?.transferBytes)),
      ttfbP95Ms: summarizeValues(passed.map((step) => step.network?.ttfbMs?.p95)),
      longTaskDurationMs: summarizeValues(
        passed
          .filter((step) => step.browser?.longTasks?.observer?.available === true)
          .map((step) => step.browser.longTasks.totalDurationMs),
      ),
      longTaskObserver: summarizeObserverStates(
        passed.map((step) => step.browser?.longTasks?.observer),
      ),
      taskDurationMs: summarizeValues(passed.map((step) => step.cpu?.taskDurationMs)),
    };
  });
  return {
    status: runs.length > 0 && runs.every((iteration) => iteration.status === 'passed') ? 'passed' : 'failed',
    iterations: runs.length,
    passedIterations: runs.filter((iteration) => iteration.status === 'passed').length,
    failedIterations: runs.filter((iteration) => iteration.status === 'failed').length,
    steps,
  };
}

const SCENARIO_KEYS = Object.freeze([
  'cacheDisabled',
  'directoryPath',
  'filePath',
  'fingerprint',
  'steps',
  'version',
  'viewport',
]);

const SAFE_ENVIRONMENT_TEXT = /^[A-Za-z0-9][A-Za-z0-9._()+ /-]{0,159}$/;
const isSafeEnvironmentText = (value) => (
  typeof value === 'string' && SAFE_ENVIRONMENT_TEXT.test(value)
);

const ENVIRONMENT_CONTROLS = Object.freeze([
  ['browser', isSafeEnvironmentText],
  ['browserVersion', isSafeEnvironmentText],
  ['headless', (value) => typeof value === 'boolean'],
  ['cacheDisabled', (value) => typeof value === 'boolean'],
  ['viewport.width', (value) => Number.isInteger(value) && value > 0],
  ['viewport.height', (value) => Number.isInteger(value) && value > 0],
  ['platform', isSafeEnvironmentText],
  ['architecture', isSafeEnvironmentText],
  ['osRelease', isSafeEnvironmentText],
  ['nodeVersion', isSafeEnvironmentText],
]);

function valueAtPath(object, field) {
  return field.split('.').reduce((value, key) => value?.[key], object);
}

function assertExactKeys(object, expected, name) {
  const actual = object && typeof object === 'object' && !Array.isArray(object)
    ? Object.keys(object).sort()
    : [];
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`Benchmark ${name} descriptor is invalid.`);
  }
}

function validateComparableReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Benchmark report is invalid.');
  }
  if (normalizeBenchmarkLabel(report.label) !== report.label) {
    throw new Error('Benchmark report label is invalid.');
  }
  if (report.kind !== 'explorer-ui-benchmark') {
    throw new Error('Benchmark report kind is invalid.');
  }
  if (report.status !== 'passed' || report.summary?.status !== 'passed') {
    throw new Error('Only passed benchmark reports can be compared.');
  }
  if (!Array.isArray(report.iterations) || report.iterations.length < 1) {
    throw new Error('Benchmark report iterations are invalid.');
  }
  if (
    report.summary?.iterations !== report.iterations.length
    || report.iterations.some((iteration) => iteration?.status !== 'passed')
  ) {
    throw new Error('Benchmark report iteration status is inconsistent.');
  }

  const scenario = report.scenario;
  assertExactKeys(scenario, SCENARIO_KEYS, 'scenario');
  if (
    scenario.version !== UI_BENCHMARK_SCENARIO_VERSION
    || !Array.isArray(scenario.steps)
    || scenario.steps.length < 1
    || scenario.steps.some((step) => (
      typeof step !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(step)
    ))
    || new Set(scenario.steps).size !== scenario.steps.length
    || typeof scenario.cacheDisabled !== 'boolean'
    || !Number.isInteger(scenario.viewport?.width)
    || scenario.viewport.width < 1
    || !Number.isInteger(scenario.viewport?.height)
    || scenario.viewport.height < 1
    || typeof scenario.directoryPath !== 'string'
    || typeof scenario.filePath !== 'string'
    || !/^[0-9a-f]{64}$/.test(scenario.fingerprint)
  ) {
    throw new Error('Benchmark scenario descriptor is invalid.');
  }
  if (scenario.fingerprint !== createScenarioFingerprint(scenario)) {
    throw new Error('Benchmark scenario fingerprint does not match its descriptor.');
  }
  const summaryStepNames = (report.summary?.steps || []).map((step) => step?.name);
  if (canonicalJson(summaryStepNames) !== canonicalJson(scenario.steps)) {
    throw new Error('Benchmark summary steps do not match the scenario descriptor.');
  }

  for (const [field, validator] of ENVIRONMENT_CONTROLS) {
    if (!validator(valueAtPath(report.environment, field))) {
      throw new Error(`Benchmark report is missing required environment control: ${field}.`);
    }
  }
  if (
    scenario.cacheDisabled !== report.environment.cacheDisabled
    || scenario.viewport.width !== report.environment.viewport.width
    || scenario.viewport.height !== report.environment.viewport.height
  ) {
    throw new Error('Benchmark scenario and environment controls are inconsistent.');
  }

  let normalizedTarget;
  try {
    normalizedTarget = normalizeBenchmarkBaseUrl(report.target?.baseURL);
  } catch {
    throw new Error('Benchmark report target control is invalid.');
  }
  if (normalizedTarget !== report.target.baseURL) {
    throw new Error('Benchmark report target control is invalid.');
  }
  return {
    scenarioDescriptor: canonicalJson(Object.fromEntries(
      Object.entries(scenario).filter(([key]) => key !== 'fingerprint'),
    )),
    target: normalizedTarget,
  };
}

export function compareBenchmarkReports(baseline, candidate) {
  if (baseline?.schemaVersion !== UI_BENCHMARK_SCHEMA_VERSION || candidate?.schemaVersion !== UI_BENCHMARK_SCHEMA_VERSION) {
    throw new Error(`Both reports must use UI benchmark schema version ${UI_BENCHMARK_SCHEMA_VERSION}.`);
  }
  const baselineValidity = validateComparableReport(baseline);
  const candidateValidity = validateComparableReport(candidate);
  if (
    baselineValidity.scenarioDescriptor !== candidateValidity.scenarioDescriptor
    || baseline.scenario.fingerprint !== candidate.scenario.fingerprint
  ) {
    throw new Error('Benchmark scenario descriptors do not match; the reports are not directly comparable.');
  }
  if (baselineValidity.target !== candidateValidity.target) {
    throw new Error('Benchmark target controls do not match.');
  }
  for (const [field] of ENVIRONMENT_CONTROLS) {
    if (valueAtPath(baseline.environment, field) !== valueAtPath(candidate.environment, field)) {
      throw new Error(`Benchmark environment controls do not match: ${field}.`);
    }
  }
  if (baseline.summary.iterations !== candidate.summary.iterations) {
    throw new Error('Benchmark iteration controls do not match.');
  }
  const baselineSteps = new Map((baseline.summary?.steps || []).map((step) => [step.name, step]));
  const candidateSteps = new Map((candidate.summary?.steps || []).map((step) => [step.name, step]));
  const names = Array.from(new Set([...baselineSteps.keys(), ...candidateSteps.keys()]));
  const steps = names.map((name) => {
    const left = baselineSteps.get(name);
    const right = candidateSteps.get(name);
    const baselineMs = left?.durationMs?.median ?? null;
    const candidateMs = right?.durationMs?.median ?? null;
    const deltaMs = Number.isFinite(baselineMs) && Number.isFinite(candidateMs)
      ? candidateMs - baselineMs
      : null;
    return {
      name,
      baselineMedianMs: roundMetric(baselineMs),
      candidateMedianMs: roundMetric(candidateMs),
      deltaMs: roundMetric(deltaMs),
      deltaPercent: Number.isFinite(deltaMs) && baselineMs > 0
        ? roundMetric((deltaMs / baselineMs) * 100)
        : null,
      baselinePassed: left?.passed ?? 0,
      candidatePassed: right?.passed ?? 0,
    };
  });
  return {
    schemaVersion: UI_BENCHMARK_SCHEMA_VERSION,
    kind: 'explorer-ui-benchmark-comparison',
    generatedAt: new Date().toISOString(),
    scenario: baseline.scenario,
    controls: {
      target: {
        baseURL: baselineValidity.target,
      },
      environment: {
        browser: baseline.environment.browser,
        browserVersion: baseline.environment.browserVersion,
        headless: baseline.environment.headless,
        cacheDisabled: baseline.environment.cacheDisabled,
        viewport: {
          width: baseline.environment.viewport.width,
          height: baseline.environment.viewport.height,
        },
        platform: baseline.environment.platform,
        architecture: baseline.environment.architecture,
        osRelease: baseline.environment.osRelease,
        nodeVersion: baseline.environment.nodeVersion,
      },
    },
    baseline: {
      label: baseline.label,
      reportStatus: baseline.summary?.status || baseline.status || 'unknown',
      iterations: baseline.summary?.iterations ?? baseline.iterations?.length ?? 0,
    },
    candidate: {
      label: candidate.label,
      reportStatus: candidate.summary?.status || candidate.status || 'unknown',
      iterations: candidate.summary?.iterations ?? candidate.iterations?.length ?? 0,
    },
    steps,
  };
}
