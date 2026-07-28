import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBoxEvidence,
  normalizeOuterPortBindings,
  validateExternalTcpNegativeEvidence,
  validateBoxEvidence,
} from './box-evidence.mjs';

const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const CONTAINER_ID = 'c'.repeat(64);
const IMAGE_REF = 'docker.io/assistos/ploinky-box:runtime';
const CONTAINER = 'ploinky-box-release-audit';
const STARTED_AT = '2026-07-16T10:00:00.000Z';
const HOST_KEY_A = `SHA256:${'A'.repeat(43)}`;
const HOST_KEY_B = `SHA256:${'B'.repeat(43)}`;

function containerInspect(bindings = {
  '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }],
  '7882/udp': [{ HostIp: '', HostPort: '7882' }],
}) {
  return [{
    Id: CONTAINER_ID,
    Name: `/${CONTAINER}`,
    Image: IMAGE_ID.slice('sha256:'.length),
    State: { Running: true, StartedAt: STARTED_AT },
    Config: {
      Labels: {
        'io.assistos.ploinky-box.role': 'box',
        'io.assistos.ploinky-box.path-hash': 'd'.repeat(64),
        'io.assistos.ploinky-box.image-ref': IMAGE_REF,
        'io.assistos.ploinky-box.router-host-port': '18080',
      },
    },
    HostConfig: { PortBindings: bindings },
  }];
}

function imageInspect() {
  return [{
    Id: IMAGE_ID.slice('sha256:'.length),
    Config: {
      Labels: {},
      User: 'podman',
      WorkingDir: '/workspace',
      Entrypoint: ['/usr/local/bin/ploinky-box-entrypoint'],
    },
  }];
}

function expected() {
  return {
    expectedContainerName: CONTAINER,
    expectedImageId: IMAGE_ID,
    expectedImageRef: IMAGE_REF,
    baseURL: 'https://explorer.test.example',
    publicIPv4: '8.8.8.8',
  };
}

test('box evidence binds the exact running semantic image and normalizes only empty wildcard HostIp', () => {
  const evidence = buildBoxEvidence({
    containerInspect: containerInspect(),
    imageInspect: imageInspect(),
    ...expected(),
  });
  assert.deepEqual(evidence.normalizedPortBindings, normalizeOuterPortBindings({
    '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }],
    '7882/udp': [{ HostIp: '0.0.0.0', HostPort: '7882' }],
  }));
  assert.equal(validateBoxEvidence(evidence, expected()).imageId, IMAGE_ID);
});

test('box evidence rejects a third publication, wrong semantic ownership, and wrong image id', () => {
  assert.throws(() => buildBoxEvidence({
    containerInspect: containerInspect({
      '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }],
      '7882/udp': [{ HostIp: '0.0.0.0', HostPort: '7882' }],
      '8081/tcp': [{ HostIp: '127.0.0.1', HostPort: '8081' }],
    }),
    imageInspect: imageInspect(),
    ...expected(),
  }), /exact two-publication|must equal/);

  const wrongOwnership = containerInspect();
  wrongOwnership[0].Config.Labels['io.assistos.ploinky-box.role'] = 'workspace';
  assert.throws(() => buildBoxEvidence({
    containerInspect: wrongOwnership,
    imageInspect: imageInspect(),
    ...expected(),
  }), /role label/);

  const unexpectedLabel = containerInspect();
  unexpectedLabel[0].Config.Labels['io.podman.compose.project'] = 'unexpected';
  assert.throws(() => buildBoxEvidence({
    containerInspect: unexpectedLabel,
    imageInspect: imageInspect(),
    ...expected(),
  }), /Box labels must be exactly/);

  assert.throws(() => buildBoxEvidence({
    containerInspect: containerInspect(),
    imageInspect: imageInspect(),
    ...expected(),
    expectedImageId: `sha256:${'b'.repeat(64)}`,
  }), /image ID/);

  assert.throws(() => buildBoxEvidence({
    containerInspect: containerInspect({
      '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }],
      '7882/udp': [{ HostIp: '::', HostPort: '7882' }],
    }),
    imageInspect: imageInspect(),
    ...expected(),
  }), /must equal/);
});

function tcpEvidence(overrides = {}) {
  return {
    runId: 'tcp-scan-123',
    containerName: CONTAINER,
    containerId: CONTAINER_ID,
    containerStartedAt: STARTED_AT,
    imageId: IMAGE_ID,
    targetPublicIPv4: '8.8.8.8',
    observedAt: '2026-07-16T10:05:00.000Z',
    sources: [
      {
        networkId: 'net-a', egressIPv4: '1.1.1.1', protocol: 'tcp',
        targetPublicIPv4: '8.8.8.8', scanStart: 1, scanEnd: 65_535,
        openPorts: [], startedAt: '2026-07-16T10:03:30.000Z', observedAt: '2026-07-16T10:04:30.000Z',
        scanner: 'ploinky-external-boundary', scanId: 'scan-a', scannerTransport: 'ssh-pinned-host',
        scannerSourceSha256: '1'.repeat(64), scannerTargetSha256: 'a'.repeat(64), rawResultSha256: 'c'.repeat(64),
        scannerHostKeySha256: HOST_KEY_A,
        invalidIceProbe: {
          protocol: 'udp', targetPort: 7882, requestHadMessageIntegrity: false,
          outcome: 'timeout', successResponse: false, responseType: null,
        },
      },
      {
        networkId: 'net-b', egressIPv4: '9.9.9.9', protocol: 'tcp',
        targetPublicIPv4: '8.8.8.8', scanStart: 1, scanEnd: 65_535,
        openPorts: [], startedAt: '2026-07-16T10:03:45.000Z', observedAt: '2026-07-16T10:04:45.000Z',
        scanner: 'ploinky-external-boundary', scanId: 'scan-b', scannerTransport: 'ssh-pinned-host',
        scannerSourceSha256: '1'.repeat(64), scannerTargetSha256: 'b'.repeat(64), rawResultSha256: 'd'.repeat(64),
        scannerHostKeySha256: HOST_KEY_B,
        invalidIceProbe: {
          protocol: 'udp', targetPort: 7882, requestHadMessageIntegrity: false,
          outcome: 'error-response', successResponse: false, responseType: 273,
        },
      },
    ],
    ...overrides,
  };
}

function tcpContext() {
  return {
    runId: 'tcp-scan-123',
    boxEvidence: buildBoxEvidence({
      containerInspect: containerInspect(),
      imageInspect: imageInspect(),
      ...expected(),
    }),
    networkSources: [
      {
        networkId: 'net-a', egressIPv4: '1.1.1.1', scannerSourceSha256: '1'.repeat(64),
        scannerTargetSha256: 'a'.repeat(64), scannerHostKeySha256: HOST_KEY_A,
      },
      {
        networkId: 'net-b', egressIPv4: '9.9.9.9', scannerSourceSha256: '1'.repeat(64),
        scannerTargetSha256: 'b'.repeat(64), scannerHostKeySha256: HOST_KEY_B,
      },
    ],
    nowMs: Date.parse('2026-07-16T10:06:00.000Z'),
  };
}

test('external TCP-negative evidence is generation-, nonce-, target-, and two-network-bound', () => {
  const validated = validateExternalTcpNegativeEvidence(tcpEvidence(), tcpContext());
  assert.equal(validated.sources.length, 2);
  assert.deepEqual(validated.sources.flatMap((source) => source.openPorts), []);

  assert.throws(() => validateExternalTcpNegativeEvidence(tcpEvidence({ runId: 'old-run' }), tcpContext()), /runId/);
  assert.throws(() => validateExternalTcpNegativeEvidence(tcpEvidence({ containerId: 'd'.repeat(64) }), tcpContext()), /container ID/);
  assert.throws(() => validateExternalTcpNegativeEvidence(tcpEvidence({ containerStartedAt: '2026-07-16T09:00:00.000Z' }), tcpContext()), /container start/);
  assert.throws(() => validateExternalTcpNegativeEvidence(tcpEvidence({ observedAt: '2026-07-16T09:59:59.000Z' }), tcpContext()), /predates/);
  const openPort = tcpEvidence();
  openPort.sources[1].openPorts = [443];
  assert.throws(() => validateExternalTcpNegativeEvidence(openPort, tcpContext()), /found an inbound TCP port/);
  const partialScan = tcpEvidence();
  partialScan.sources[0].scanEnd = 65_534;
  assert.throws(() => validateExternalTcpNegativeEvidence(partialScan, tcpContext()), /every TCP port/);
  const oldSource = tcpEvidence();
  oldSource.sources[0].startedAt = '2026-07-16T09:59:58.000Z';
  oldSource.sources[0].observedAt = '2026-07-16T09:59:59.000Z';
  assert.throws(() => validateExternalTcpNegativeEvidence(oldSource, tcpContext()), /source net-a scan predates/);
  const duplicateScan = tcpEvidence();
  duplicateScan.sources[1].scanId = 'scan-a';
  assert.throws(() => validateExternalTcpNegativeEvidence(duplicateScan, tcpContext()), /scan ids must be distinct/);
  const successfulInvalidIce = tcpEvidence();
  successfulInvalidIce.sources[0].invalidIceProbe.outcome = 'success-response';
  successfulInvalidIce.sources[0].invalidIceProbe.successResponse = true;
  assert.throws(() => validateExternalTcpNegativeEvidence(successfulInvalidIce, tcpContext()), /invalid ICE fails/);
});
