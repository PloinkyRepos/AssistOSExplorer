import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectNoWaitReadiness } from '../../../.github/scripts/check-no-wait-readiness.mjs';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const RUN_STARTED_AT_MS = 1_777_777_777_777;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-no-wait-readiness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeRuntime(directory, name, state, overrides = {}) {
  const statusFile = `${name}.${RUN_ID}.json`;
  fs.writeFileSync(path.join(directory, `${name}.current.json`), JSON.stringify({
    runId: RUN_ID,
    runStartedAtMs: RUN_STARTED_AT_MS,
    waveIndex: 0,
    statusFile,
    ...overrides.marker,
  }));
  if (state === null) return;
  fs.writeFileSync(path.join(directory, statusFile), JSON.stringify({
    containerName: name,
    repoName: 'repo',
    shortAgent: name,
    runId: RUN_ID,
    runStartedAtMs: RUN_STARTED_AT_MS,
    waveIndex: 0,
    state,
    sequencePhase: 'active',
    ...(state === 'failed' ? { error: { message: 'probe failed token=do-not-print' } } : {}),
    ...overrides.status,
  }));
}

test('QA no-wait gate requires every current-run status to be terminal running', (t) => {
  const directory = fixture(t);
  writeRuntime(directory, 'one', 'running');
  writeRuntime(directory, 'two', 'starting');
  assert.deepEqual(inspectNoWaitReadiness({
    directory,
    expectedCount: 2,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  }), {
    state: 'waiting',
    expectedCount: 2,
    observedCount: 2,
    readyCount: 1,
    startingCount: 1,
    failures: [],
  });

  writeRuntime(directory, 'two', 'running');
  assert.equal(inspectNoWaitReadiness({
    directory,
    expectedCount: 2,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  }).state, 'ready');
});

test('QA no-wait gate reports terminal failure independently of process admission', (t) => {
  const directory = fixture(t);
  writeRuntime(directory, 'one', 'running');
  writeRuntime(directory, 'two', 'failed');
  const result = inspectNoWaitReadiness({
    directory,
    expectedCount: 2,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.failures[0].message, 'probe failed token=[redacted]');
});

test('QA no-wait gate waits for the complete marker inventory', (t) => {
  const directory = fixture(t);
  writeRuntime(directory, 'one', 'running');
  const result = inspectNoWaitReadiness({
    directory,
    expectedCount: 2,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  });
  assert.equal(result.state, 'waiting');
  assert.equal(result.observedCount, 1);
});

test('QA no-wait gate rejects stale, mixed, and excess current-run evidence', (t) => {
  const directory = fixture(t);
  writeRuntime(directory, 'one', 'running');
  assert.throws(() => inspectNoWaitReadiness({
    directory,
    expectedCount: 1,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS + 1,
  }), /predates this deployment/);

  writeRuntime(directory, 'two', 'running', {
    marker: {
      runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      statusFile: 'two.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json',
    },
  });
  assert.throws(() => inspectNoWaitReadiness({
    directory,
    expectedCount: 2,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  }), /one deployment run/);
  assert.throws(() => inspectNoWaitReadiness({
    directory,
    expectedCount: 1,
    minimumRunStartedAtMs: RUN_STARTED_AT_MS,
  }), /found 2 current no-wait markers/);
});
