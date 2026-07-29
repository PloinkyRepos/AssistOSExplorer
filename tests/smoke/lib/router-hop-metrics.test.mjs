import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTER_HOP_BOUNDARIES,
  createRouterHopArtifact,
  normalizeProbeSample,
  runBoundedSamples,
  summarizeProbeSamples,
} from './router-hop-metrics.mjs';

const successSample = () => ({
  status: 200,
  ttfbMs: 10,
  totalMs: 12,
  errorCode: null,
});

function completeBoundaries(sample = successSample) {
  return Object.fromEntries(ROUTER_HOP_BOUNDARIES.map((name) => [
    name,
    {
      sequential: Array.from({ length: 20 }, sample),
      concurrent: Array.from({ length: 20 }, sample),
    },
  ]));
}

test('summarizes only fixed-shape numeric samples', () => {
  const summary = summarizeProbeSamples([
    successSample(),
    { status: 204, ttfbMs: 20, totalMs: 25, errorCode: null },
    { status: 0, ttfbMs: null, totalMs: null, errorCode: 'ETIMEDOUT' },
  ], 3);
  assert.equal(summary.attempts, 3);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.statusCounts, { 0: 1, 200: 1, 204: 1 });
  assert.deepEqual(summary.errorCodeCounts, { ETIMEDOUT: 1 });
  assert.equal(summary.ttfbMs.median, 15);
  assert.equal(summary.totalMs.median, 18.5);

  assert.throws(() => normalizeProbeSample({
    ...successSample(),
    headers: { authorization: 'forbidden' },
  }), /shape is invalid/);
  assert.throws(() => normalizeProbeSample({
    status: 200,
    ttfbMs: 20,
    totalMs: 10,
    errorCode: null,
  }), /smaller than TTFB/);
});

test('bounded sampling honors exact count and concurrency', async () => {
  let active = 0;
  let maximumActive = 0;
  const samples = await runBoundedSamples(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return successSample();
  }, 20, 8);
  assert.equal(samples.length, 20);
  assert.equal(maximumActive, 8);
  await assert.rejects(() => runBoundedSamples(async () => successSample(), 20, 21));
});

test('artifact includes every allowlisted boundary and rejects unsafe metadata', () => {
  const artifact = createRouterHopArtifact({
    label: 'proxy-hop-1',
    deploymentId: 'ploinky-box-test-123',
    ploinkySha: '1'.repeat(40),
    explorerSha: '2'.repeat(40),
    browser: 'chromium 148.0.0.0',
    boundarySamples: completeBoundaries(),
    generatedAt: '2026-07-29T12:00:00.000Z',
  });
  assert.equal(artifact.status, 'passed');
  assert.deepEqual(Object.keys(artifact.boundaries), ROUTER_HOP_BOUNDARIES);
  assert.doesNotMatch(JSON.stringify(artifact), /authorization|cookie|password|https?:\/\//i);

  const unsafeBrowserValue = 'chromium token=value';
  assert.throws(() => createRouterHopArtifact({
    label: 'proxy-hop-1',
    deploymentId: 'ploinky-box-test-123',
    ploinkySha: '1'.repeat(40),
    explorerSha: '2'.repeat(40),
    browser: unsafeBrowserValue,
    boundarySamples: completeBoundaries(),
    generatedAt: '2026-07-29T12:00:00.000Z',
  }), (error) => (
    /invalid|forbidden request or credential material/.test(error.message)
    && !error.message.includes(unsafeBrowserValue)
  ));

  const missing = completeBoundaries();
  delete missing['git-router-health'];
  assert.throws(() => createRouterHopArtifact({
    label: 'proxy-hop-1',
    deploymentId: 'ploinky-box-test-123',
    ploinkySha: '1'.repeat(40),
    explorerSha: '2'.repeat(40),
    browser: 'chromium',
    boundarySamples: missing,
  }), /boundary set shape is invalid/);
});
