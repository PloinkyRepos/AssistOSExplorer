import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requirePublicIpv4 } from './network.mjs';

const SCANNER_PATH = fileURLToPath(new URL('../scripts/external-boundary-scanner.py', import.meta.url));
const CONFIG_MARKER = '__SCAN_CONFIG__';
const SCANNER_TRANSPORT = 'ssh-pinned-host';
const SCANNER_NAME = 'ploinky-external-boundary';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactString(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function exactSha256(value, name) {
  const text = exactString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${name} must be a SHA-256 digest.`);
  return text;
}

function exactSshHostKeySha256(value, name) {
  const text = exactString(value, name);
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(text)) {
    throw new Error(`${name} must be an exact OpenSSH SHA256 host-key fingerprint.`);
  }
  return text;
}

export function scannerSourceSha256(source = fs.readFileSync(SCANNER_PATH, 'utf8')) {
  if (!source.includes(CONFIG_MARKER)) throw new Error('External scanner source has no configuration marker.');
  return sha256(source);
}

function validateSshTarget(value, name) {
  const target = exactString(value, name);
  if (target.startsWith('-') || !/^[A-Za-z0-9_.@:-]+$/.test(target)) {
    throw new Error(`${name} must be a safe SSH config host alias or user@host.`);
  }
  return target;
}

export function validateNetworkEchoUrl(value) {
  let parsed;
  try {
    parsed = new URL(exactString(value, 'SMOKE_NETWORK_ECHO_URL'));
  } catch (_) {
    throw new Error('SMOKE_NETWORK_ECHO_URL must be an exact HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SMOKE_NETWORK_ECHO_URL must be an exact credential-free, query-free HTTPS URL.');
  }
  return parsed.href;
}

export function renderExternalScannerProgram(config, source = fs.readFileSync(SCANNER_PATH, 'utf8')) {
  if (!source.includes(CONFIG_MARKER) || source.indexOf(CONFIG_MARKER) !== source.lastIndexOf(CONFIG_MARKER)) {
    throw new Error('External scanner source must contain exactly one configuration marker.');
  }
  return source.replace(CONFIG_MARKER, JSON.stringify(config));
}

export function parseExternalScannerOutput(output, expected) {
  let payload;
  try {
    payload = JSON.parse(String(output || '').trim());
  } catch (error) {
    throw new Error(`External scanner returned invalid JSON: ${error.message}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('External scanner output must be an object.');
  }
  if (payload.scanner !== SCANNER_NAME) throw new Error('External scanner identity mismatch.');
  if (payload.scanId !== expected.scanId) throw new Error('External scanner scanId mismatch.');
  if (payload.targetPublicIPv4 !== expected.targetPublicIPv4) throw new Error('External scanner target mismatch.');
  if (payload.egressIPv4 !== expected.expectedEgressIPv4) throw new Error('External scanner egress mismatch.');
  if (payload.scannerSourceSha256 !== expected.scannerSourceSha256) throw new Error('External scanner source digest mismatch.');
  if (payload.scanStart !== 1 || payload.scanEnd !== 65_535) throw new Error('External scanner did not scan every TCP port.');
  if (!Array.isArray(payload.openPorts) || payload.openPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error('External scanner openPorts is invalid.');
  }
  const probe = payload.invalidIceProbe;
  if (
    !probe || typeof probe !== 'object' || Array.isArray(probe)
    || probe.protocol !== 'udp'
    || probe.targetPort !== 7882
    || probe.requestHadMessageIntegrity !== false
    || typeof probe.successResponse !== 'boolean'
    || !['timeout', 'error-response', 'success-response'].includes(probe.outcome)
    || (probe.outcome === 'timeout' && probe.responseType !== null)
    || (probe.outcome === 'error-response' && probe.responseType !== 0x0111)
    || (probe.outcome === 'success-response' && probe.responseType !== 0x0101)
    || (probe.successResponse !== (probe.outcome === 'success-response'))
  ) {
    throw new Error('External scanner invalid-ICE proof is malformed.');
  }
  return payload;
}

export function parseNegotiatedSshHostKey(debugLog) {
  const fingerprints = [...String(debugLog || '').matchAll(
    /^debug1: Server host key:\s+\S+\s+(SHA256:[A-Za-z0-9+/]{43})\s*$/gm,
  )].map((match) => match[1]);
  if (!fingerprints.length) {
    throw new Error('Pinned SSH scanner did not report its negotiated server host-key fingerprint.');
  }
  if (new Set(fingerprints).size !== 1) {
    throw new Error('Pinned SSH scanner reported conflicting negotiated server host-key fingerprints.');
  }
  return fingerprints[0];
}

function spawnSshScanner(target, program, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-ssh-debug-'));
    const debugFile = path.join(debugDir, 'client.log');
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      fs.rmSync(debugDir, { recursive: true, force: true });
    };
    const child = spawn('ssh', [
      '-v',
      '-E', debugFile,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=15',
      '-o', 'ControlMaster=no',
      '-o', 'ControlPath=none',
      target,
      'python3', '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const limit = 1024 * 1024;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup();
      reject(new Error(`Pinned SSH scanner ${sha256(target)} timed out.`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > limit) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > limit) child.kill('SIGKILL');
    });
    child.stdin.once('error', () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Pinned SSH scanner ${sha256(target)} closed stdin before receiving the exact scanner program.`));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      cleanup();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || signal) {
        cleanup();
        reject(new Error(`Pinned SSH scanner ${sha256(target)} failed with ${signal || `exit ${code}`} (stderr SHA-256 ${sha256(stderr)}).`));
        return;
      }
      try {
        const serverHostKeySha256 = parseNegotiatedSshHostKey(fs.readFileSync(debugFile, 'utf8'));
        cleanup();
        resolve({ stdout, serverHostKeySha256 });
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
    });
    child.stdin.end(program);
  });
}

export function scannerAttestation({
  sshTarget,
  expectedHostKeySha256,
  source = fs.readFileSync(SCANNER_PATH, 'utf8'),
}) {
  const target = validateSshTarget(sshTarget, 'external scanner SSH target');
  return Object.freeze({
    scannerTransport: SCANNER_TRANSPORT,
    scannerSourceSha256: scannerSourceSha256(source),
    scannerTargetSha256: sha256(target),
    scannerHostKeySha256: exactSshHostKeySha256(
      expectedHostKeySha256,
      'external scanner SSH host-key fingerprint',
    ),
  });
}

export async function runExternalScanner({
  sshTarget,
  networkId,
  expectedEgressIPv4,
  targetPublicIPv4,
  echoUrl,
  runId,
  expectedHostKeySha256,
  source = fs.readFileSync(SCANNER_PATH, 'utf8'),
  spawnScanner = spawnSshScanner,
} = {}) {
  const target = validateSshTarget(sshTarget, `${networkId} scanner SSH target`);
  const attestation = scannerAttestation({
    sshTarget: target,
    expectedHostKeySha256,
    source,
  });
  const scanId = `${exactString(runId, 'external scanner runId')}-${crypto.randomUUID()}`;
  const config = Object.freeze({
    scanId,
    targetPublicIPv4: requirePublicIpv4(targetPublicIPv4, 'external scanner target IPv4'),
    expectedEgressIPv4: requirePublicIpv4(expectedEgressIPv4, 'external scanner expected egress IPv4'),
    echoUrl: validateNetworkEchoUrl(echoUrl),
    scannerSourceSha256: attestation.scannerSourceSha256,
    concurrency: 512,
    connectTimeoutSeconds: 0.75,
  });
  const execution = await spawnScanner(target, renderExternalScannerProgram(config, source));
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    throw new Error('Pinned SSH scanner transport returned no negotiated host-key attestation.');
  }
  const negotiatedHostKeySha256 = exactSshHostKeySha256(
    execution.serverHostKeySha256,
    `${networkId} negotiated scanner host-key fingerprint`,
  );
  if (negotiatedHostKeySha256 !== attestation.scannerHostKeySha256) {
    throw new Error(`${networkId} negotiated scanner host-key fingerprint does not match the pinned expected fingerprint.`);
  }
  const output = String(execution.stdout || '');
  const parsed = parseExternalScannerOutput(output, config);
  return Object.freeze({
    networkId: exactString(networkId, 'external scanner networkId'),
    egressIPv4: parsed.egressIPv4,
    protocol: 'tcp',
    targetPublicIPv4: parsed.targetPublicIPv4,
    scanStart: parsed.scanStart,
    scanEnd: parsed.scanEnd,
    openPorts: Object.freeze([...parsed.openPorts]),
    startedAt: parsed.startedAt,
    observedAt: parsed.observedAt,
    scanner: parsed.scanner,
    scanId: parsed.scanId,
    ...attestation,
    rawResultSha256: sha256(String(output || '')),
    invalidIceProbe: Object.freeze({ ...parsed.invalidIceProbe }),
  });
}

export function buildExternalBoundaryEvidence({ runId, boxEvidence, sources }) {
  if (!Array.isArray(sources) || sources.length !== 2) throw new Error('Exactly two executed external scanner results are required.');
  const observedTimes = sources.map((source) => Date.parse(source.observedAt));
  if (observedTimes.some((value) => !Number.isFinite(value))) throw new Error('External scanner observedAt is invalid.');
  return Object.freeze({
    runId: exactString(runId, 'external scanner runId'),
    containerName: boxEvidence.containerName,
    containerId: boxEvidence.containerId,
    containerStartedAt: boxEvidence.startedAt,
    imageId: boxEvidence.imageId,
    targetPublicIPv4: boxEvidence.publicIPv4,
    observedAt: new Date(Math.max(...observedTimes)).toISOString(),
    sources: Object.freeze(sources),
  });
}
