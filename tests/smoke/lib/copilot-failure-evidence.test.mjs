import assert from 'node:assert/strict';
import test from 'node:test';

import { finishCopilotGate } from './copilot-failure-evidence.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const context = { close: async () => calls.push('cancel-cleanup') };
  const options = {
    primaryError: new Error('original completion failure'),
    traceStarted: true,
    budgets: { summary: 100, screenshot: 100, trace: 100, close: 100, directory: 100 },
    page: {
      context: () => context,
    },
    copilotPage: {
      screenshot: async () => calls.push('screenshot'),
      close: async () => calls.push('close-popup'),
    },
    testInfo: {
      outputPath: (name) => `/tmp/${name}`,
      attach: async (name) => calls.push(`attach:${name}`),
    },
    detachListeners: () => calls.push('detach'),
    stopTrace: async (receivedContext) => {
      assert.equal(receivedContext, context);
      calls.push('trace');
    },
    cleanupDirectory: async () => calls.push('directory'),
    ...overrides,
  };
  return { options, calls };
}

test('failure screenshot and trace are saved while the popup remains open, before directory cleanup', async () => {
  const { options, calls } = fixture();

  await finishCopilotGate(options);

  assert.deepEqual(calls, [
    'detach', 'attach:copilot-failure.json', 'screenshot', 'attach:copilot-failure-screenshot',
    'trace', 'close-popup', 'directory',
  ]);
});

test('directory cleanup failure reports the original completion failure first and retains earlier evidence', async () => {
  const { options, calls } = fixture({ cleanupDirectory: async () => { throw new Error('directory cleanup failed'); } });

  await assert.rejects(finishCopilotGate(options), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /original completion failure/);
    assert.match(error.errors[1].message, /directory cleanup failed/);
    return true;
  });

  assert.ok(calls.indexOf('screenshot') < calls.indexOf('close-popup'));
  assert.ok(calls.indexOf('trace') < calls.indexOf('close-popup'));
});

test('screenshot and popup-close failures cannot prevent a trace attempt or directory cleanup', async () => {
  const { options, calls } = fixture({
    copilotPage: {
      screenshot: async () => { throw new Error('screenshot failed'); },
      close: async () => { throw new Error('popup close failed'); },
    },
  });

  await assert.rejects(finishCopilotGate(options), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    assert.match(error.errors[0].message, /original completion failure/);
    assert.match(error.errors[1].message, /screenshot failed/);
    assert.match(error.errors[2].message, /popup close failed/);
    return true;
  });
  assert.ok(calls.includes('trace'));
  assert.ok(calls.includes('directory'));
});

test('trace failure still permits cleanup and fails an otherwise successful gate', async () => {
  const { options, calls } = fixture({
    primaryError: null,
    stopTrace: async () => { throw new Error('redaction failed'); },
  });

  await assert.rejects(finishCopilotGate(options), /redaction failed/);

  assert.equal(calls.includes('screenshot'), false);
  assert.deepEqual(calls, ['detach', 'close-popup', 'directory']);
});

test('pending directory cleanup is bounded, cancelled, and cannot replace the primary error', async () => {
  let rejectCleanup;
  const { options, calls } = fixture({
    cleanupDirectory: () => new Promise((_, reject) => { rejectCleanup = reject; }),
  });
  options.budgets.directory = 10;

  await assert.rejects(finishCopilotGate(options), (error) => {
    assert.match(error.errors[0].message, /original completion failure/);
    assert.match(error.errors[1].message, /directory cleanup exceeded its 10ms teardown budget/);
    return true;
  });
  assert.ok(calls.includes('cancel-cleanup'));
  rejectCleanup(new Error('late cancellation rejection'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('a pending trace cannot exhaust the independent directory-cleanup budget', async () => {
  const { options, calls } = fixture({ stopTrace: () => new Promise(() => {}) });
  options.budgets.trace = 10;

  await assert.rejects(finishCopilotGate(options), /redacted trace exceeded its 10ms teardown budget/);

  assert.ok(calls.includes('close-popup'));
  assert.ok(calls.includes('directory'));
});
