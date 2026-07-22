import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  parseExternalScannerOutput,
  parseNegotiatedSshHostKey,
  renderExternalScannerProgram,
  runExternalScanner,
  scannerAttestation,
  validateNetworkEchoUrl,
} from './external-scanner.mjs';

const SOURCE = 'SCAN_CONFIG = __SCAN_CONFIG__\nprint("scanner")\n';
const HOST_KEY = `SHA256:${'A'.repeat(43)}`;

function result(overrides = {}) {
  return {
    schemaVersion: 1,
    scanner: 'ploinky-external-boundary-v1',
    scannerSourceSha256: scannerAttestation({
      sshTarget: 'scanner-a', expectedHostKeySha256: HOST_KEY, source: SOURCE,
    }).scannerSourceSha256,
    scanId: 'run-scan',
    targetPublicIPv4: '8.8.8.8',
    egressIPv4: '1.1.1.1',
    scanStart: 1,
    scanEnd: 65_535,
    openPorts: [],
    startedAt: '2026-07-16T10:01:00.000Z',
    observedAt: '2026-07-16T10:02:00.000Z',
    invalidIceProbe: {
      protocol: 'udp', targetPort: 7882, requestHadMessageIntegrity: false,
      outcome: 'timeout', successResponse: false, responseType: null,
    },
    ...overrides,
  };
}

test('scanner program embeds structured configuration without shell interpolation', () => {
  const rendered = renderExternalScannerProgram({ target: "8.8.8.8'; touch /tmp/no" }, SOURCE);
  assert.match(rendered, /JSON|target/);
  assert.equal(rendered.includes('__SCAN_CONFIG__'), false);
  assert.throws(() => scannerAttestation({
    sshTarget: '-oProxyCommand=bad', expectedHostKeySha256: HOST_KEY, source: SOURCE,
  }), /safe SSH/);
  assert.throws(() => scannerAttestation({
    sshTarget: 'scanner-a', expectedHostKeySha256: 'SHA256:not-a-key', source: SOURCE,
  }), /host-key fingerprint/);
});

test('network echo URL cannot carry credentials or query data into scanner diagnostics', () => {
  assert.equal(validateNetworkEchoUrl('https://echo.test.example/ip'), 'https://echo.test.example/ip');
  for (const value of [
    'http://echo.test.example/ip',
    'https://user:secret@echo.test.example/ip',
    'https://echo.test.example/ip?token=secret',
    'https://echo.test.example/ip#secret',
  ]) {
    assert.throws(() => validateNetworkEchoUrl(value), /credential-free/);
  }
});

test('negotiated host key comes only from the SSH client debug log', () => {
  const actual = `SHA256:${'B'.repeat(43)}`;
  const remoteFake = `SHA256:${'A'.repeat(43)}`;
  const clientLog = `debug1: Connecting to scanner-a\ndebug1: Server host key: ssh-ed25519 ${actual}\n`;
  const remoteStderr = `remote startup\ndebug1: Server host key: ssh-ed25519 ${remoteFake}\n`;
  assert.equal(parseNegotiatedSshHostKey(clientLog), actual);
  assert.throws(() => parseNegotiatedSshHostKey(`${clientLog}${remoteStderr}`), /conflicting negotiated/);
});

test('scanner output requires a complete scan and exact invalid-ICE proof', () => {
  const expected = {
    scanId: 'run-scan', targetPublicIPv4: '8.8.8.8', expectedEgressIPv4: '1.1.1.1',
    scannerSourceSha256: result().scannerSourceSha256,
  };
  assert.deepEqual(parseExternalScannerOutput(JSON.stringify(result()), expected).openPorts, []);
  assert.throws(() => parseExternalScannerOutput(JSON.stringify(result({ scanEnd: 65_534 })), expected), /every TCP port/);
  assert.throws(() => parseExternalScannerOutput(JSON.stringify(result({
    invalidIceProbe: { ...result().invalidIceProbe, targetPort: 7881 },
  })), expected), /invalid-ICE proof/);
  assert.throws(() => parseExternalScannerOutput(JSON.stringify(result({
    invalidIceProbe: {
      ...result().invalidIceProbe,
      outcome: 'error-response',
      responseType: 0x0101,
    },
  })), expected), /invalid-ICE proof/);
});

test('scanner fails closed on local socket/resource errors instead of reporting ports closed', () => {
  const program = renderExternalScannerProgram({
    scanId: 'classification',
    targetPublicIPv4: '8.8.8.8',
    expectedEgressIPv4: '1.1.1.1',
    echoUrl: 'https://echo.test.example/ip',
    scannerSourceSha256: 'a'.repeat(64),
    concurrency: 1,
    connectTimeoutSeconds: 0.01,
  });
  const harness = String.raw`
import asyncio
import errno
import sys

scope = {"__name__": "scanner_classification_test"}
exec(compile(sys.stdin.read(), "external-boundary-scanner.py", "exec"), scope)

async def exercise():
    original = asyncio.open_connection
    try:
        async def refused(*args, **kwargs):
            raise OSError(errno.ECONNREFUSED, "refused")
        asyncio.open_connection = refused
        assert await scope["scan_tcp_port"]("8.8.8.8", 443, asyncio.Semaphore(1), 0.01) is None

        async def unreachable(*args, **kwargs):
            raise OSError(errno.ENETUNREACH, "unreachable")
        asyncio.open_connection = unreachable
        try:
            await scope["scan_tcp_port"]("8.8.8.8", 443, asyncio.Semaphore(1), 0.01)
        except RuntimeError as error:
            assert "could not classify" in str(error)
        else:
            raise AssertionError("network-unreachable was reported as a closed port")
    finally:
        asyncio.open_connection = original

asyncio.run(exercise())
`;
  const result = spawnSync('python3', ['-c', harness], {
    input: program,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('executed scanner evidence is bound to pinned SSH target and exact returned bytes', async () => {
  const attestation = scannerAttestation({
    sshTarget: 'scanner-a', expectedHostKeySha256: HOST_KEY, source: SOURCE,
  });
  let returnedBytes = '';
  const executed = await runExternalScanner({
    sshTarget: 'scanner-a',
    networkId: 'net-a',
    expectedEgressIPv4: '1.1.1.1',
    targetPublicIPv4: '8.8.8.8',
    echoUrl: 'https://echo.test.example/ip',
    runId: 'release',
    expectedHostKeySha256: HOST_KEY,
    source: SOURCE,
    spawnScanner: async (_target, program) => {
      const match = program.match(/SCAN_CONFIG = (\{.*\})/);
      const config = JSON.parse(match[1]);
      returnedBytes = `${JSON.stringify(result({
        scanId: config.scanId,
        scannerSourceSha256: config.scannerSourceSha256,
      }))}\n`;
      return {
        stdout: returnedBytes,
        serverHostKeySha256: HOST_KEY,
      };
    },
  });
  assert.equal(executed.scannerTransport, 'ssh-pinned-host');
  assert.equal(executed.scannerTargetSha256, attestation.scannerTargetSha256);
  assert.equal(executed.scannerHostKeySha256, HOST_KEY);
  assert.equal(
    executed.rawResultSha256,
    crypto.createHash('sha256').update(returnedBytes).digest('hex'),
  );
  assert.notEqual(
    executed.rawResultSha256,
    crypto.createHash('sha256').update(returnedBytes.trim()).digest('hex'),
    'the attestation must retain the scanner trailing newline as an exact returned byte',
  );

  await assert.rejects(() => runExternalScanner({
    sshTarget: 'scanner-a',
    networkId: 'net-a',
    expectedEgressIPv4: '1.1.1.1',
    targetPublicIPv4: '8.8.8.8',
    echoUrl: 'https://echo.test.example/ip',
    runId: 'release',
    expectedHostKeySha256: HOST_KEY,
    source: SOURCE,
    spawnScanner: async () => ({
      stdout: '{}',
      serverHostKeySha256: `SHA256:${'B'.repeat(43)}`,
    }),
  }), /does not match the pinned expected fingerprint/);
});
