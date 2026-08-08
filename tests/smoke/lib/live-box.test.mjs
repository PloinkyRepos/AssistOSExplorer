import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLocalScreenBaseUrl,
  sameLiveBoxGeneration,
  selectLocalScreenContainer,
  validateBoxFreshness,
  validateLiveBoxEvidence,
  validateReadOnlyPloinkySourceMount,
  verifyNetworkLaneCompletion,
} from './live-box.mjs';

const NOW = Date.parse('2026-07-16T10:10:00.000Z');
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;

function container(bindings, overrides = {}) {
  return {
    Id: 'c'.repeat(64),
    Name: '/ploinky-box-screen',
    Image: IMAGE_ID,
    State: { Running: true, StartedAt: '2026-07-16T10:05:00.000Z' },
    Config: { Labels: { 'io.assistos.ploinky-box.role': 'box' } },
    HostConfig: { PortBindings: bindings },
    ...overrides,
  };
}

function exactBindings(port = '8080') {
  return {
    '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: port }],
    '7882/udp': [{ HostIp: '', HostPort: '7882' }],
  };
}

function evidence() {
  return {
    capturedAt: '2026-07-16T10:10:00.000Z',
    imageCreatedAt: '2026-07-16T10:00:00.000Z',
    generationMaxAgeMs: 600_000,
    imageMaxAgeMs: 3_600_000,
    box: {
      containerName: 'ploinky-box-screen',
      containerId: 'c'.repeat(64),
      startedAt: '2026-07-16T10:05:00.000Z',
      running: true,
      semanticLabels: {
        role: 'box',
        pathHash: 'd'.repeat(12),
        imageRef: 'docker.io/assistos/ploinky-box:runtime',
        routerHostPort: '8080',
        mediaHostPort: '7882',
        dependenciesFingerprint: 'e'.repeat(64),
        imagesFingerprint: 'f'.repeat(64),
      },
      imageRef: 'docker.io/assistos/ploinky-box:runtime',
      imageId: IMAGE_ID,
      baseURL: 'http://127.0.0.1:8080',
      publicIPv4: '',
      selectedRouterHostPort: '8080',
      normalizedPortBindings: exactBindings(),
    },
  };
}

test('live Box URL and container discovery require the exact loopback boundary', () => {
  assert.deepEqual(parseLocalScreenBaseUrl('http://127.0.0.1:18080'), {
    baseURL: 'http://127.0.0.1:18080', port: '18080',
  });
  for (const value of ['https://127.0.0.1:8080', 'http://localhost:8080', 'http://0.0.0.0:8080', 'http://127.0.0.1:8080/path']) {
    assert.throws(() => parseLocalScreenBaseUrl(value), /requires SMOKE_BASE_URL|loopback HTTP/);
  }

  const selected = selectLocalScreenContainer([
    container({ '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] }),
    container(exactBindings()),
  ], '8080');
  assert.equal(selected.Id, 'c'.repeat(64));
  assert.throws(() => selectLocalScreenContainer([
    container(exactBindings()), container(exactBindings(), { Id: 'd'.repeat(64) }),
  ], '8080'), /exactly one/);
  assert.throws(() => selectLocalScreenContainer([
    container({ ...exactBindings(), '8081/tcp': [{ HostIp: '127.0.0.1', HostPort: '8081' }] }),
  ], '8080'), /found 0/);
});

test('live Box evidence is exact, fresh, and generation-comparable', () => {
  const validated = validateLiveBoxEvidence(evidence(), {
    baseURL: 'http://127.0.0.1:8080', nowMs: NOW,
  });
  assert.equal(validated.box.imageId, IMAGE_ID);
  assert.equal(sameLiveBoxGeneration(validated, structuredClone(validated)), true);

  const staleGeneration = evidence();
  staleGeneration.box.startedAt = '2026-07-16T09:00:00.000Z';
  assert.throws(() => validateLiveBoxEvidence(staleGeneration, {
    baseURL: 'http://127.0.0.1:8080', nowMs: NOW,
  }), /generation is not fresh/);

  const staleImage = evidence();
  staleImage.imageCreatedAt = '2026-07-16T08:00:00.000Z';
  assert.throws(() => validateLiveBoxEvidence(staleImage, {
    baseURL: 'http://127.0.0.1:8080', nowMs: NOW,
  }), /image is not fresh/);
});

test('live Box source evidence requires the exact verified read-only Ploinky bind', () => {
  const realpathSync = (value) => value.replace('/private', '');
  assert.deepEqual(validateReadOnlyPloinkySourceMount([{
    Type: 'bind',
    Source: '/private/work/ploinky',
    Destination: '/opt/ploinky',
    RW: false,
  }], '/work/ploinky', { realpathSync }), {
    type: 'bind',
    source: '/work/ploinky',
    destination: '/opt/ploinky',
    readWrite: false,
  });
  assert.throws(() => validateReadOnlyPloinkySourceMount([{
    Type: 'bind', Source: '/work/ploinky', Destination: '/opt/ploinky', RW: true,
  }], '/work/ploinky', { realpathSync }), /read-only bind/);
  assert.throws(() => validateReadOnlyPloinkySourceMount([{
    Type: 'bind', Source: '/work/other', Destination: '/opt/ploinky', RW: false,
  }], '/work/ploinky', { realpathSync }), /does not equal/);
});

test('native gates enforce the same fresh image and container generation contract', () => {
  const box = evidence().box;
  assert.equal(validateBoxFreshness({
    capturedAt: '2026-07-16T10:10:00.000Z',
    imageCreatedAt: '2026-07-16T10:00:00.000Z',
    box,
    generationMaxAgeMs: 600_000,
    imageMaxAgeMs: 3_600_000,
  }, { nowMs: NOW }).imageCreatedAt, '2026-07-16T10:00:00.000Z');
  assert.throws(() => validateBoxFreshness({
    capturedAt: '2026-07-16T10:10:00.000Z',
    imageCreatedAt: '2026-07-16T08:00:00.000Z',
    box,
    generationMaxAgeMs: 600_000,
    imageMaxAgeMs: 3_600_000,
  }, { nowMs: NOW }), /image is not fresh/);

  const ancient = { ...box, startedAt: '2026-07-15T10:05:00.000Z' };
  assert.throws(() => validateBoxFreshness({
    capturedAt: '2026-07-16T10:10:00.000Z',
    imageCreatedAt: '2026-07-15T10:00:00.000Z',
    box: ancient,
    generationMaxAgeMs: 10 * 24 * 60 * 60_000,
    imageMaxAgeMs: 10 * 24 * 60 * 60_000,
  }, { nowMs: NOW }), /generation is not fresh/);
});

test('failed network lanes still re-inspect and aggregate post-lane generation failures', () => {
  const beforeBox = evidence().box;
  let reinspected = 0;
  assert.throws(() => verifyNetworkLaneCompletion({
    lane: 'direct-udp',
    laneResult: { status: 1 },
    beforeBox,
    collectAfter() {
      reinspected += 1;
      return { box: { ...beforeBox, containerId: 'd'.repeat(64) } };
    },
  }), (error) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /lane failed with exit 1/);
    assert.match(error.errors[1].message, /generation changed/);
    return true;
  });
  assert.equal(reinspected, 1);
});
