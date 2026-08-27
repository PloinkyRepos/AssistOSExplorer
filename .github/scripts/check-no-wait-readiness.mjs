#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STATUS_BYTES = 256 * 1024;
const TERMINAL_STATES = new Set(['running', 'failed']);
const VALID_STATES = new Set(['starting', ...TERMINAL_STATES]);
const VALID_PHASES = new Set(['waiting-barrier', 'active']);

function exactNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be one exact non-negative integer`);
  }
  return number;
}

function readJsonObject(directory, name, { optional = false } = {}) {
  const target = path.join(directory, name);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`no-wait state '${name}' is not one regular file`);
  }
  if (stat.size > MAX_STATUS_BYTES) {
    throw new Error(`no-wait state '${name}' exceeds ${MAX_STATUS_BYTES} bytes`);
  }
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`no-wait state '${name}' is not one JSON object`);
  }
  return value;
}

function sanitizeDiagnostic(value) {
  return String(value || 'unknown failure')
    .replace(/\s+/g, ' ')
    .replace(/((?:token|secret|password|authorization|cookie)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .slice(0, 2_000);
}

function validateMarker(directory, markerName, minimumRunStartedAtMs) {
  const containerName = markerName.slice(0, -'.current.json'.length);
  if (!containerName || path.basename(containerName) !== containerName) {
    throw new Error(`invalid no-wait marker name '${markerName}'`);
  }
  const marker = readJsonObject(directory, markerName);
  const runId = String(marker.runId || '').trim().toLowerCase();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`no-wait marker '${markerName}' has no exact run id`);
  }
  const runStartedAtMs = exactNonNegativeInteger(
    marker.runStartedAtMs,
    `no-wait marker '${markerName}' run start`,
  );
  if (runStartedAtMs < minimumRunStartedAtMs) {
    throw new Error(`no-wait marker '${markerName}' predates this deployment`);
  }
  const waveIndex = exactNonNegativeInteger(
    marker.waveIndex,
    `no-wait marker '${markerName}' wave index`,
  );
  const statusFile = String(marker.statusFile || '');
  const expectedStatusFile = `${containerName}.${runId}.json`;
  if (statusFile !== expectedStatusFile || path.basename(statusFile) !== statusFile) {
    throw new Error(`no-wait marker '${markerName}' names a foreign status file`);
  }
  return { containerName, runId, runStartedAtMs, waveIndex, statusFile };
}

function validateStatus(directory, marker) {
  const status = readJsonObject(directory, marker.statusFile, { optional: true });
  if (!status) return { state: 'starting', label: marker.containerName };
  if (String(status.containerName || '') !== marker.containerName
    || String(status.runId || '').trim().toLowerCase() !== marker.runId
    || status.runStartedAtMs !== marker.runStartedAtMs
    || status.waveIndex !== marker.waveIndex) {
    throw new Error(`no-wait status '${marker.statusFile}' does not match its current-run marker`);
  }
  const state = String(status.state || '');
  const phase = String(status.sequencePhase || '');
  if (!VALID_STATES.has(state) || !VALID_PHASES.has(phase)) {
    throw new Error(`no-wait status '${marker.statusFile}' has an invalid state or phase`);
  }
  if (state === 'running' && phase !== 'active') {
    throw new Error(`no-wait status '${marker.statusFile}' reports running outside its active phase`);
  }
  return {
    state,
    label: `${String(status.repoName || '-').trim()}/${String(status.shortAgent || marker.containerName).trim()}`,
    message: state === 'failed' ? sanitizeDiagnostic(status?.error?.message) : '',
  };
}

export function inspectNoWaitReadiness({
  directory,
  expectedCount,
  minimumRunStartedAtMs,
} = {}) {
  const exactExpectedCount = exactNonNegativeInteger(expectedCount, 'expected no-wait count');
  const exactMinimumRunStartedAtMs = exactNonNegativeInteger(
    minimumRunStartedAtMs,
    'deployment start',
  );
  const root = fs.lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('no-wait state root is not one real directory');
  }
  const markerNames = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.current.json'))
    .sort();
  if (markerNames.length > exactExpectedCount) {
    throw new Error(`found ${markerNames.length} current no-wait markers; expected ${exactExpectedCount}`);
  }
  if (markerNames.length < exactExpectedCount) {
    return {
      state: 'waiting',
      expectedCount: exactExpectedCount,
      observedCount: markerNames.length,
      readyCount: 0,
      startingCount: markerNames.length,
      failures: [],
    };
  }

  const markers = markerNames.map((name) => validateMarker(
    directory,
    name,
    exactMinimumRunStartedAtMs,
  ));
  const runIds = new Set(markers.map((marker) => marker.runId));
  const runStarts = new Set(markers.map((marker) => marker.runStartedAtMs));
  if (runIds.size !== 1 || runStarts.size !== 1) {
    throw new Error('current no-wait markers do not belong to one deployment run');
  }

  const statuses = markers.map((marker) => validateStatus(directory, marker));
  const failures = statuses.filter(({ state }) => state === 'failed');
  const readyCount = statuses.filter(({ state }) => state === 'running').length;
  const startingCount = statuses.length - readyCount - failures.length;
  return {
    state: failures.length ? 'failed' : (readyCount === exactExpectedCount ? 'ready' : 'waiting'),
    expectedCount: exactExpectedCount,
    observedCount: markerNames.length,
    readyCount,
    startingCount,
    failures,
  };
}

function formatSummary(result) {
  const summary = `[deploy-qa] no-wait readiness ${result.readyCount}/${result.expectedCount}`
    + ` ready, ${result.startingCount} starting, ${result.failures.length} failed`;
  const failures = result.failures.map(
    ({ label, message }) => `[deploy-qa] no-wait failure ${label}: ${message}`,
  );
  return [summary, ...failures].join('\n');
}

function main() {
  const [directory, expectedCount, minimumRunStartedAtMs] = process.argv.slice(2);
  try {
    const result = inspectNoWaitReadiness({
      directory,
      expectedCount,
      minimumRunStartedAtMs,
    });
    process.stdout.write(`${formatSummary(result)}\n`);
    if (result.state === 'ready') return;
    process.exitCode = result.state === 'failed' ? 2 : 1;
  } catch (error) {
    process.stderr.write(`[deploy-qa] invalid no-wait readiness evidence: ${sanitizeDiagnostic(error?.message)}\n`);
    process.exitCode = 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
