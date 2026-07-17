import assert from 'node:assert/strict';
import test from 'node:test';

import { createReleaseGateFailureCollector } from './release-gate-failures.mjs';

test('required artifact failures remain visible and redact configured secrets', async () => {
  const collector = createReleaseGateFailureCollector({
    env: { SMOKE_PASSWORD: 'release-gate-password' },
  });
  await collector.required('trace capture', async () => {
    throw new Error('failed with release-gate-password');
  });
  assert.equal(collector.failures.length, 1);
  assert.equal(collector.failures[0].stack.includes('release-gate-password'), false);
  assert.match(collector.failures[0].stack, /REDACTED:SMOKE_PASSWORD/);
  assert.throws(() => collector.throwIfAny({ label: 'screen gate' }), (error) => (
    error instanceof AggregateError
      && error.errors.length === 1
      && /required evidence\/cleanup failure/.test(error.message)
  ));
});

test('primary failures are preserved when evidence succeeds or aggregated when it fails', async () => {
  const primary = new Error('primary failure');
  const clean = createReleaseGateFailureCollector({ env: {} });
  assert.throws(() => clean.throwIfAny({ primaryError: primary }), (error) => (
    error !== primary && /primary failure/.test(error.message)
  ));

  const failed = createReleaseGateFailureCollector({ env: {} });
  await failed.required('screenshot', async () => { throw new Error('closed page'); });
  assert.throws(() => failed.throwIfAny({ primaryError: primary }), (error) => (
    error instanceof AggregateError
      && error.errors[0] !== primary
      && /primary failure/.test(error.errors[0].message)
      && error.errors.length === 2
  ));
});

test('primary failures are redacted before reaching the Playwright report', () => {
  const collector = createReleaseGateFailureCollector({ env: { API_TOKEN: 'primary-report-secret' } });
  assert.throws(() => collector.throwIfAny({
    primaryError: new Error('request failed with primary-report-secret'),
  }), (error) => !error.stack.includes('primary-report-secret') && /REDACTED:API_TOKEN/.test(error.stack));
});
