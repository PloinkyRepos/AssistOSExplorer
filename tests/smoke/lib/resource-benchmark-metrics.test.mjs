import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESOURCE_BENCHMARK_SCHEMA_VERSION,
  assertRuntimeEvidenceStable,
  buildHostControls,
  buildResourceScenario,
  classifyRuntimeEvidence,
  compareResourceReports,
  cpuBusyPercent,
  parseContainerRows,
  parseLoadavg,
  parseMeminfo,
  parseProcStat,
  processStateFromStat,
  summarizeResourceSamples,
  validateResourceReport,
} from './resource-benchmark-metrics.mjs';

const MASTER_SHA = '1'.repeat(40);
const EXPLORER_MASTER_SHA = '2'.repeat(40);
const PROXY_SHA = '3'.repeat(40);
const EXPLORER_PROXY_SHA = '4'.repeat(40);

function container(name, id, labels = {}) {
  return {
    Names: [name],
    Id: id.repeat(64).slice(0, 64),
    Labels: labels,
  };
}

function targetRows(prefix) {
  return Array.from({ length: 16 }, (_, index) => (
    container(`ploinky_agent_${index}`, `${prefix}${index.toString(16)}`)
  ));
}

function runtimeEvidence(variant) {
  const topology = variant === 'master' ? 'direct' : 'box';
  const phase = {
    variant,
    topology,
    outerBoxCount: variant === 'master' ? 0 : 1,
    outerBoxName: variant === 'master' ? null : 'ploinky-box-explorer-123456789abc',
    outerBoxIdentityFingerprint: variant === 'master' ? null : 'a'.repeat(64),
    expectedTargetCount: 16,
    runningTargetCount: 16,
    targetIdentityFingerprint: variant === 'master' ? 'b'.repeat(64) : 'c'.repeat(64),
    exactGraph: true,
  };
  return {
    beforeWarmup: { ...phase },
    afterWarmup: { ...phase },
    afterSampling: { ...phase },
  };
}

function samples(offset = 0) {
  return [
    {
      timestamp: '2026-07-30T00:00:10.000Z',
      elapsedMs: 10_000,
      cpuBusyPercent: 10 + offset,
      memoryUsedBytes: 1_000 + offset,
      memoryAvailableBytes: 3_000 - offset,
      swapUsedBytes: 100 + offset,
      load1: 0.5 + offset,
      load5: 0.4 + offset,
      load15: 0.3 + offset,
      processCount: 100 + offset,
      zombieCount: offset,
      runnableEntities: 2 + offset,
      totalEntities: 200 + offset,
    },
    {
      timestamp: '2026-07-30T00:00:20.000Z',
      elapsedMs: 20_000,
      cpuBusyPercent: 20 + offset,
      memoryUsedBytes: 1_100 + offset,
      memoryAvailableBytes: 2_900 - offset,
      swapUsedBytes: 110 + offset,
      load1: 0.7 + offset,
      load5: 0.5 + offset,
      load15: 0.4 + offset,
      processCount: 101 + offset,
      zombieCount: offset,
      runnableEntities: 3 + offset,
      totalEntities: 201 + offset,
    },
    {
      timestamp: '2026-07-30T00:00:30.000Z',
      elapsedMs: 30_000,
      cpuBusyPercent: 15 + offset,
      memoryUsedBytes: 1_200 + offset,
      memoryAvailableBytes: 2_800 - offset,
      swapUsedBytes: 120 + offset,
      load1: 0.6 + offset,
      load5: 0.6 + offset,
      load15: 0.5 + offset,
      processCount: 102 + offset,
      zombieCount: offset + 1,
      runnableEntities: 2 + offset,
      totalEntities: 202 + offset,
    },
  ];
}

function host() {
  return buildHostControls({
    platform: 'linux',
    architecture: 'x64',
    kernelRelease: '6.8.0-test',
    osId: 'ubuntu',
    osVersionId: '24.04',
    logicalCpuCount: 2,
    cpuModel: 'Test CPU',
    totalMemoryBytes: 4_000,
    containerRuntime: 'podman',
    containerRuntimeVersion: 'podman version 5.0.0',
    nodeVersion: 'v22.0.0',
  });
}

function report(variant, offset = 0) {
  const reportSamples = samples(offset);
  return {
    schemaVersion: RESOURCE_BENCHMARK_SCHEMA_VERSION,
    kind: 'explorer-resource-benchmark',
    generatedAt: '2026-07-30T00:00:00.000Z',
    status: 'passed',
    label: variant,
    deployment: {
      variant,
      deploymentId: `${variant}-deployment`,
      ploinkySha: variant === 'master' ? MASTER_SHA : PROXY_SHA,
      explorerSha: variant === 'master' ? EXPLORER_MASTER_SHA : EXPLORER_PROXY_SHA,
    },
    scenario: buildResourceScenario({
      warmupSeconds: 0,
      durationSeconds: 30,
      intervalSeconds: 10,
      expectedTargets: 16,
    }),
    environment: { host: host() },
    runtimeEvidence: runtimeEvidence(variant),
    samples: reportSamples,
    summary: summarizeResourceSamples(reportSamples),
  };
}

test('Linux proc parsers derive CPU, memory, load, and process state', () => {
  const previous = parseProcStat('cpu  100 0 0 500 0 0 0 0 25 10\n');
  const current = parseProcStat('cpu  150 0 0 550 0 0 0 0 50 20\n');
  assert.equal(cpuBusyPercent(previous, current), 50);

  assert.deepEqual(parseMeminfo([
    'MemTotal:        4000 kB',
    'MemAvailable:    1000 kB',
    'SwapTotal:       2000 kB',
    'SwapFree:         500 kB',
  ].join('\n')), {
    totalMemoryBytes: 4_096_000,
    availableMemoryBytes: 1_024_000,
    memoryUsedBytes: 3_072_000,
    totalSwapBytes: 2_048_000,
    swapUsedBytes: 1_536_000,
  });

  assert.deepEqual(parseLoadavg('1.25 2.50 3.75 4/321 1234\n'), {
    load1: 1.25,
    load5: 2.5,
    load15: 3.75,
    runnableEntities: 4,
    totalEntities: 321,
  });
  assert.equal(processStateFromStat('123 (name with ) spaces) Z 1 2 3'), 'Z');
});

test('scenario fingerprint binds every comparison control', () => {
  const baseline = buildResourceScenario({
    workloadId: 'idle-steady',
    warmupSeconds: 300,
    durationSeconds: 1_800,
    intervalSeconds: 10,
    expectedTargets: 16,
  });
  const same = buildResourceScenario({
    expectedTargets: 16,
    intervalSeconds: 10,
    durationSeconds: 1_800,
    warmupSeconds: 300,
    workloadId: 'idle-steady',
  });
  const changed = buildResourceScenario({
    workloadId: 'idle-steady',
    warmupSeconds: 300,
    durationSeconds: 1_800,
    intervalSeconds: 10,
    expectedTargets: 15,
  });
  assert.equal(baseline.fingerprint, same.fingerprint);
  assert.notEqual(baseline.fingerprint, changed.fingerprint);
  assert.throws(
    () => buildResourceScenario({ durationSeconds: 10, intervalSeconds: 10 }),
    /at least two sampling intervals/,
  );
});

test('resource summaries expose distributions and leak-sensitive slopes', () => {
  const summary = summarizeResourceSamples(samples());
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.metrics.cpuBusyPercent.median, 15);
  assert.equal(summary.metrics.zombieCount.max, 1);
  assert.equal(summary.slopesPerMinute.memoryUsedBytes, 600);
  assert.equal(summary.slopesPerMinute.processCount, 6);
  assert.equal(summary.slopesPerMinute.zombieCount, 3);
});

test('runtime evidence distinguishes direct master from one exact nested Box graph', () => {
  const direct = classifyRuntimeEvidence({
    variant: 'master',
    hostRows: targetRows('a'),
    expectedTargets: 16,
  });
  assert.equal(direct.topology, 'direct');
  assert.equal(direct.runningTargetCount, 16);

  const box = container('ploinky-box-explorer-123456789abc', 'b', {
    'io.assistos.ploinky-box.role': 'box',
  });
  const nested = classifyRuntimeEvidence({
    variant: 'ploinky-proxy',
    hostRows: [box],
    nestedRows: targetRows('c'),
    expectedTargets: 16,
  });
  assert.equal(nested.topology, 'box');
  assert.equal(nested.outerBoxCount, 1);
  assert.equal(nested.runningTargetCount, 16);

  assert.throws(() => classifyRuntimeEvidence({
    variant: 'master',
    hostRows: [box, ...targetRows('d')],
    expectedTargets: 16,
  }), /must not contain a running outer Ploinky Box/);
  assert.throws(() => classifyRuntimeEvidence({
    variant: 'ploinky-proxy',
    hostRows: [box],
    nestedRows: targetRows('e').slice(0, 15),
    expectedTargets: 16,
  }), /expected exactly 16/);
});

test('container inventory accepts array or JSON-line output and rejects malformed rows', () => {
  assert.equal(parseContainerRows(JSON.stringify([container('one', '1')])).length, 1);
  assert.equal(parseContainerRows([
    JSON.stringify(container('one', '1')),
    JSON.stringify(container('two', '2')),
  ].join('\n')).length, 2);
  assert.throws(() => parseContainerRows('not-json'), /invalid JSON inventory/);
});

test('runtime stability binds the exact target and outer Box identities', () => {
  const evidence = runtimeEvidence('ploinky-proxy');
  assert.equal(assertRuntimeEvidenceStable(evidence), true);
  evidence.afterSampling.targetIdentityFingerprint = 'f'.repeat(64);
  assert.throws(
    () => assertRuntimeEvidenceStable(evidence),
    /afterSampling.targetIdentityFingerprint/,
  );
});

test('master-relative comparison reports steady-state and growth deltas', () => {
  const baseline = report('master', 0);
  const candidate = report('ploinky-proxy', 5);
  assert.deepEqual(validateResourceReport(baseline).deployment, {
    variant: 'master',
    deploymentId: 'master-deployment',
    ploinkySha: MASTER_SHA,
    explorerSha: EXPLORER_MASTER_SHA,
  });
  const comparison = compareResourceReports(baseline, candidate);
  assert.equal(comparison.reference.variant, 'master');
  assert.equal(comparison.candidate.variant, 'ploinky-proxy');
  assert.equal(comparison.metrics.find(({ name }) => name === 'processCount').delta, 5);
  assert.equal(comparison.metrics.find(({ name }) => name === 'zombieCount').delta, 5);
});

test('comparison fails closed for wrong reference, host mismatch, and scenario mismatch', () => {
  const baseline = report('master');
  const candidate = report('ploinky-proxy', 1);

  assert.throws(
    () => compareResourceReports(candidate, baseline),
    /reference report must be a master deployment/,
  );

  const hostMismatch = structuredClone(candidate);
  hostMismatch.environment.host.cpuModel = 'Different CPU';
  hostMismatch.environment.host = buildHostControls(hostMismatch.environment.host);
  assert.throws(
    () => compareResourceReports(baseline, hostMismatch),
    /host controls do not match/,
  );

  const scenarioMismatch = structuredClone(candidate);
  scenarioMismatch.scenario = buildResourceScenario({
    warmupSeconds: 1,
    durationSeconds: 30,
    intervalSeconds: 10,
    expectedTargets: 16,
  });
  assert.throws(
    () => compareResourceReports(baseline, scenarioMismatch),
    /scenario controls do not match/,
  );
});

test('report validation recomputes summaries and rejects truncated or widened samples', () => {
  const tamperedSummary = report('master');
  tamperedSummary.summary.metrics.cpuBusyPercent.p95 = 999;
  assert.throws(
    () => validateResourceReport(tamperedSummary),
    /summary does not match its raw samples/,
  );

  const truncated = report('master');
  truncated.samples.pop();
  assert.throws(
    () => validateResourceReport(truncated),
    /must contain exactly 3 samples/,
  );

  const widened = report('master');
  widened.samples[0].commandLine = 'unexpected artifact data';
  assert.throws(
    () => validateResourceReport(widened),
    /sample 0 fields are invalid/,
  );
});

test('report validation rejects fabricated stable-runtime fingerprints', () => {
  const invalid = report('ploinky-proxy');
  invalid.runtimeEvidence.afterWarmup.outerBoxIdentityFingerprint = '';
  assert.throws(
    () => validateResourceReport(invalid),
    /afterWarmup Box identity is invalid/,
  );
});
