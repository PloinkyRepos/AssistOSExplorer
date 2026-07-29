import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UI_BENCHMARK_SCHEMA_VERSION,
  UI_BENCHMARK_ACTIVE_REQUEST_COUNT_LIMIT,
  classifyRequestPath,
  compareBenchmarkReports,
  createScenarioFingerprint,
  normalizeBenchmarkBaseUrl,
  normalizeBenchmarkLabel,
  normalizeBenchmarkPath,
  percentile,
  roundMetric,
  safeRequestTarget,
  sanitizeError,
  summarizeBenchmarkIterations,
  summarizeRequests,
  summarizeValues,
} from './ui-benchmark-metrics.mjs';
import {
  NETWORK_TAIL_DEADLINE_MS,
  NetworkRecorder,
  finalizeStepNetworkSummaries,
  summarizeBrowserWindow,
} from '../scripts/run-ui-benchmark.mjs';

test('normalizes credential-free benchmark inputs', () => {
  assert.equal(normalizeBenchmarkBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(normalizeBenchmarkLabel('master.default-1'), 'master.default-1');
  assert.equal(normalizeBenchmarkPath('/.ploinky/repos', 'directory'), '/.ploinky/repos');
  assert.throws(() => normalizeBenchmarkBaseUrl('https://user:pass@example.test/'));
  assert.throws(() => normalizeBenchmarkBaseUrl('https://example.test/?token=value'));
  assert.throws(() => normalizeBenchmarkLabel('../master'));
  assert.throws(() => normalizeBenchmarkPath('../outside', 'directory'));
});

test('classifies only sanitized request paths', () => {
  assert.equal(classifyRequestPath('/explorer/mcp'), 'explorer-agent');
  assert.equal(classifyRequestPath('/dpuAgent/mcp'), 'dpu-agent');
  assert.equal(classifyRequestPath('/gitAgent/mcp'), 'git-agent');
  assert.equal(classifyRequestPath('/workspace-files/.ploinky/repos/example/file.js'), 'workspace-files');
  assert.equal(classifyRequestPath('/explorer/assets/app.js'), 'explorer-ui');
  assert.deepEqual(
    safeRequestTarget('http://127.0.0.1:8080/dpuAgent/mcp?token=do-not-record', 'http://127.0.0.1:8080'),
    { scope: 'router', pathname: '/dpuAgent/mcp', category: 'dpu-agent' },
  );
  assert.deepEqual(
    safeRequestTarget('https://external.test/private/opaque-token?key=do-not-record', 'http://127.0.0.1:8080'),
    { scope: 'external', pathname: '<external>', category: 'external' },
  );
});

test('summarizes request latency, cache, duplicates, and categories', () => {
  const requests = [
    {
      method: 'POST',
      pathname: '/explorer/mcp',
      category: 'explorer-agent',
      ttfbMs: 10,
      totalMs: 20,
      transferBytes: 100,
      cacheHit: false,
      failed: false,
      canceled: false,
    },
    {
      method: 'POST',
      pathname: '/explorer/mcp',
      category: 'explorer-agent',
      ttfbMs: 30,
      totalMs: 50,
      transferBytes: 200,
      cacheHit: true,
      failed: false,
      canceled: false,
    },
    {
      method: 'POST',
      pathname: '/dpuAgent/mcp',
      category: 'dpu-agent',
      ttfbMs: null,
      totalMs: null,
      transferBytes: 0,
      cacheHit: false,
      failed: true,
      canceled: true,
    },
  ];
  const summary = summarizeRequests(requests);
  assert.equal(summary.started, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.canceled, 1);
  assert.equal(summary.cacheHits, 1);
  assert.equal(summary.transferBytes, 300);
  assert.equal(summary.duplicateRequests, 1);
  assert.equal(summary.ttfbMs.median, 20);
  assert.equal(summary.byCategory['dpu-agent'].started, 1);
});

test('uses interpolated percentiles and iteration medians', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([null, undefined, '', 100], 0.5), 100);
  assert.equal(roundMetric(null), null);
  assert.equal(summarizeValues([null, undefined, '']).count, 0);
  const summary = summarizeBenchmarkIterations([
    {
      status: 'passed',
      steps: [{
        name: 'open-file',
        status: 'passed',
        durationMs: 100,
        settledMs: 120,
        networkTail: { status: 'complete', complete: true },
        network: { started: 2, transferBytes: 10, ttfbMs: { p95: 20 } },
        browser: {
          longTasks: {
            observer: { supported: true, available: true },
            totalDurationMs: 0,
          },
        },
        cpu: { taskDurationMs: 5 },
      }],
    },
    {
      status: 'passed',
      steps: [{
        name: 'open-file',
        status: 'passed',
        durationMs: 300,
        settledMs: 320,
        networkTail: {
          status: 'cutoff',
          complete: false,
          activeRequestsAtCutoff: 2,
        },
        network: { started: 4, transferBytes: 30, ttfbMs: { p95: 40 } },
        browser: {
          longTasks: {
            observer: { supported: true, available: false },
            totalDurationMs: null,
          },
        },
        cpu: { taskDurationMs: 15 },
      }],
    },
  ]);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.steps[0].durationMs.median, 200);
  assert.equal(summary.steps[0].settledMs.median, 120);
  assert.equal(summary.steps[0].networkTail.complete, 1);
  assert.equal(summary.steps[0].networkTail.cutoff, 1);
  assert.equal(summary.steps[0].networkTail.activeRequestsAtCutoff.median, 2);
  assert.equal(summary.steps[0].requests.median, 3);
  assert.equal(summary.steps[0].longTaskDurationMs.count, 1);
  assert.equal(summary.steps[0].longTaskObserver.available, 1);
  assert.equal(summary.steps[0].longTaskObserver.failed, 1);
});

function comparableReport(label, median) {
  const descriptor = {
    version: 'explorer-ui-v1',
    steps: ['open-file'],
    cacheDisabled: true,
    viewport: { width: 1440, height: 1000 },
    directoryPath: '/.ploinky',
    filePath: '/.env',
  };
  return {
    schemaVersion: UI_BENCHMARK_SCHEMA_VERSION,
    kind: 'explorer-ui-benchmark',
    label,
    status: 'passed',
    target: { baseURL: 'http://127.0.0.1:8080' },
    environment: {
      platform: 'darwin',
      architecture: 'arm64',
      osRelease: '25.5.0',
      nodeVersion: 'v25.8.0',
      browser: 'chromium',
      browserVersion: '148.0.7778.96',
      headless: true,
      cacheDisabled: true,
      viewport: { width: 1440, height: 1000 },
    },
    scenario: {
      ...descriptor,
      fingerprint: createScenarioFingerprint(descriptor),
    },
    iterations: [
      { status: 'passed' },
      { status: 'passed' },
      { status: 'passed' },
    ],
    summary: {
      status: 'passed',
      iterations: 3,
      steps: [{ name: 'open-file', passed: 3, durationMs: { median } }],
    },
  };
}

function captureError(callback) {
  let caught = null;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  return caught;
}

test('compares only fully matching scenario and environment controls', () => {
  const report = (label, median) => ({
    ...comparableReport(label, median),
  });
  const comparison = compareBenchmarkReports(report('master', 200), report('ploinky-proxy', 150));
  assert.equal(comparison.steps[0].deltaMs, -50);
  assert.equal(comparison.steps[0].deltaPercent, -25);
  const missingComparison = compareBenchmarkReports(report('master', null), report('proxy', null));
  assert.equal(missingComparison.steps[0].baselineMedianMs, null);
  assert.equal(missingComparison.steps[0].candidateMedianMs, null);
  assert.equal(missingComparison.steps[0].deltaMs, null);

  const tamperedBaseline = report('master', 200);
  const tamperedCandidate = report('proxy', 150);
  tamperedBaseline.scenario.filePath = '/credential-material';
  tamperedCandidate.scenario.filePath = '/credential-material';
  const tamperError = captureError(() => compareBenchmarkReports(
    tamperedBaseline,
    tamperedCandidate,
  ));
  assert.match(tamperError.message, /fingerprint does not match/);
  assert.doesNotMatch(tamperError.message, /credential-material/);

  const environmentMutations = [
    ['browser', 'firefox'],
    ['browserVersion', 'credential=do-not-echo'],
    ['headless', false],
    ['cacheDisabled', false],
    ['viewport.width', 1280],
    ['viewport.height', 720],
    ['platform', 'linux'],
    ['architecture', 'x64'],
    ['osRelease', 'different'],
    ['nodeVersion', 'v24.0.0'],
  ];
  for (const [field, value] of environmentMutations) {
    const candidate = report('proxy', 150);
    const keys = field.split('.');
    const target = keys.slice(0, -1).reduce((object, key) => object[key], candidate.environment);
    target[keys.at(-1)] = value;
    const mismatch = captureError(() => compareBenchmarkReports(report('master', 200), candidate));
    assert.match(mismatch.message, /controls do not match|controls are inconsistent|required environment control/);
    assert.doesNotMatch(mismatch.message, /do-not-echo/);
  }
});

test('keeps credential-shaped error material out of artifacts', () => {
  const sanitized = sanitizeError(new Error(
    'request failed at https://example.test/path?token=visible password=hunter2 authorization: Bearer opaque-value',
  ));
  assert.equal(sanitized.name, 'Error');
  assert.doesNotMatch(sanitized.message, /visible|hunter2|opaque-value/);
  assert.doesNotMatch(sanitized.message, /\?token=/);
});

test('distinguishes complete network tails from bounded cutoff tails', async () => {
  assert.equal(NETWORK_TAIL_DEADLINE_MS, 1_500);
  const completeRecorder = new NetworkRecorder(null, 'http://127.0.0.1:8080');
  completeRecorder.beginStep('open-file');
  const complete = await completeRecorder.waitForStepNetworkTail('open-file', 100, 1);
  assert.deepEqual(complete, {
    status: 'complete',
    complete: true,
    deadlineMs: 100,
    quietPeriodMs: 1,
    activeRequestsAtCutoff: null,
    activeRequestsAtCutoffCapped: false,
  });
  completeRecorder.endStep();
  completeRecorder.requestStarted({
    requestId: 'after-tail',
    timestamp: 1,
    request: { method: 'GET', url: 'http://127.0.0.1:8080/explorer/index.html' },
    type: 'Fetch',
  });
  assert.equal(completeRecorder.requestsForStep('open-file').length, 0);
  assert.equal(completeRecorder.export().requests[0].step, 'background');

  const cutoffRecorder = new NetworkRecorder(null, 'http://127.0.0.1:8080');
  cutoffRecorder.beginStep('open-file');
  for (let index = 0; index <= UI_BENCHMARK_ACTIVE_REQUEST_COUNT_LIMIT; index += 1) {
    cutoffRecorder.requestStarted({
      requestId: `request-${index}`,
      timestamp: index + 1,
      request: { method: 'GET', url: 'http://127.0.0.1:8080/explorer/index.html' },
      type: 'Fetch',
    });
  }
  const cutoff = await cutoffRecorder.waitForStepNetworkTail('open-file', 1, 1);
  assert.equal(cutoff.status, 'cutoff');
  assert.equal(cutoff.complete, false);
  assert.equal(cutoff.activeRequestsAtCutoff, UI_BENCHMARK_ACTIVE_REQUEST_COUNT_LIMIT);
  assert.equal(cutoff.activeRequestsAtCutoffCapped, true);
});

test('rebuilds immutable step summaries from the final exported waterfall', () => {
  const recorder = new NetworkRecorder(null, 'http://127.0.0.1:8080');
  recorder.beginStep('open-file');
  recorder.requestStarted({
    requestId: 'request-1',
    timestamp: 1,
    request: { method: 'GET', url: 'http://127.0.0.1:8080/explorer/index.html' },
    type: 'Fetch',
  });
  const earlySummary = summarizeRequests(recorder.requestsForStep('open-file'));
  assert.equal(earlySummary.completed, 0);

  recorder.responseReceived({
    requestId: 'request-1',
    timestamp: 1.01,
    response: { status: 200 },
  });
  recorder.requestFinished({
    requestId: 'request-1',
    timestamp: 1.02,
    encodedDataLength: 123,
  });
  const waterfall = recorder.export();
  const finalized = finalizeStepNetworkSummaries([{
    name: 'open-file',
    network: earlySummary,
  }], waterfall.requests);
  assert.deepEqual(finalized[0].network, summarizeRequests(
    waterfall.requests.filter((request) => request.step === 'open-file'),
  ));
  assert.equal(finalized[0].network.completed, 1);
  assert.equal(finalized[0].network.transferBytes, 123);

  recorder.records[0].transferBytes = 999_999;
  assert.equal(waterfall.requests[0].transferBytes, 123);
  assert.equal(finalized[0].network.transferBytes, 123);
});

test('represents unavailable performance observers differently from genuine zero work', () => {
  const before = {
    timeOrigin: 1,
    now: 10,
    longTasks: [],
    eventTimings: [],
  };
  const observation = (longTask) => summarizeBrowserWindow(before, {
    timeOrigin: 1,
    now: 20,
    longTasks: [],
    eventTimings: [],
    performanceObservers: {
      longTask,
      eventTiming: { supported: true, available: true },
    },
  }).longTasks;

  const unsupported = observation({ supported: false, available: false });
  assert.equal(unsupported.observer.supported, false);
  assert.equal(unsupported.count, null);
  assert.equal(unsupported.totalBlockingTimeMs, null);

  const failed = observation({ supported: true, available: false });
  assert.equal(failed.observer.supported, true);
  assert.equal(failed.observer.available, false);
  assert.equal(failed.count, null);

  const genuineZero = observation({ supported: true, available: true });
  assert.equal(genuineZero.observer.available, true);
  assert.equal(genuineZero.count, 0);
  assert.equal(genuineZero.totalDurationMs, 0);
  assert.equal(genuineZero.totalBlockingTimeMs, 0);
});
