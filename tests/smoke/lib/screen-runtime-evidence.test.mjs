import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectHostLocalScreenEvidence,
  sameScreenRuntimeGeneration,
  validateHostLocalScreenEvidence,
} from './screen-runtime-evidence.mjs';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');
const CONTAINER_ID = 'a'.repeat(64);

function command(commandName, args, options = {}) {
  assert.equal(commandName, 'podman');
  if (args[0] === 'container' && args[1] === 'ls') return `${CONTAINER_ID}\n`;
  assert.deepEqual(args, ['container', 'inspect', CONTAINER_ID]);
  assert.equal(options.json, true);
  return [{
    Id: CONTAINER_ID,
    Name: '/ploinky_webmeetInfra_liveKitServerAgent_fresh_12345678',
    State: {
      Running: true,
      StartedAt: '2026-07-27T11:59:00.000Z',
    },
    Config: {
      Labels: {
        'io.assistos.ploinky.managed': '1',
      },
    },
    HostConfig: {
      NetworkMode: 'host',
      PortBindings: {},
    },
  }];
}

test('host-local screen evidence binds the fresh managed LiveKit generation without a Box', () => {
  const evidence = collectHostLocalScreenEvidence({
    baseURL: 'http://127.0.0.1:8080',
    nowMs: NOW,
    command,
  });
  assert.deepEqual(evidence, {
    deployment: 'local',
    capturedAt: '2026-07-27T12:00:00.000Z',
    baseURL: 'http://127.0.0.1:8080',
    outerBoxCount: 0,
    liveKit: {
      containerName: 'ploinky_webmeetInfra_liveKitServerAgent_fresh_12345678',
      containerId: CONTAINER_ID,
      startedAt: '2026-07-27T11:59:00.000Z',
      networkMode: 'host',
      portBindingCount: 0,
    },
  });
  assert.equal(sameScreenRuntimeGeneration(evidence, evidence), true);
});

test('host-local screen evidence rejects Box overlap and published LiveKit ports', () => {
  const base = {
    deployment: 'local',
    capturedAt: '2026-07-27T12:00:00.000Z',
    baseURL: 'http://127.0.0.1:8080',
    outerBoxCount: 0,
    liveKit: {
      containerName: 'ploinky_webmeetInfra_liveKitServerAgent_fresh_12345678',
      containerId: CONTAINER_ID,
      startedAt: '2026-07-27T11:59:00.000Z',
      networkMode: 'host',
      portBindingCount: 0,
    },
  };
  assert.throws(
    () => validateHostLocalScreenEvidence({ ...base, outerBoxCount: 1 }, {
      baseURL: base.baseURL,
      nowMs: NOW,
    }),
    /must not include an outer Ploinky Box/,
  );
  assert.throws(
    () => validateHostLocalScreenEvidence({
      ...base,
      liveKit: { ...base.liveKit, portBindingCount: 1 },
    }, {
      baseURL: base.baseURL,
      nowMs: NOW,
    }),
    /must not publish container ports/,
  );
});
