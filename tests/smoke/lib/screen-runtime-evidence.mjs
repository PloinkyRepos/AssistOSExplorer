import { spawnSync } from 'node:child_process';

import {
  collectLocalScreenV5Evidence,
  sameLocalScreenGeneration,
  validateLocalScreenV5Evidence,
} from './v5-live-box.mjs';

const MANAGED_LABEL = 'io.assistos.ploinky.managed';
const BOX_CONTRACT_LABEL = 'io.assistos.ploinky.runtime-contract';
const DEFAULT_GENERATION_MAX_AGE_MS = 30 * 60_000;

function exactRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function exactDate(value, name) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} must be an ISO timestamp.`);
  return { text: new Date(milliseconds).toISOString(), milliseconds };
}

function exactContainerId(value, name) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${name} must be an exact 64-hex container ID.`);
  return text;
}

function parseLoopbackBaseUrl(baseURL) {
  let parsed;
  try {
    parsed = new URL(String(baseURL || ''));
  } catch (_) {
    throw new Error('Screen-share smoke requires an exact loopback HTTP SMOKE_BASE_URL.');
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Screen-share smoke requires SMOKE_BASE_URL=http://127.0.0.1:<router-port>.');
  }
  return `http://127.0.0.1:${parsed.port || '80'}`;
}

function defaultCommand(command, args, { json = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}: ${String(result.stderr || '').trim()}`);
  }
  if (!json) return String(result.stdout || '');
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

function localLiveKitCandidates(containers) {
  return containers.filter((container) => {
    const name = String(container?.Name || '').replace(/^\//, '');
    const labels = container?.Config?.Labels || {};
    return container?.State?.Running === true
      && labels[MANAGED_LABEL] === '1'
      && /(?:^|_)liveKitServerAgent(?:_|$)/.test(name);
  });
}

export function validateHostLocalScreenEvidence(input, {
  baseURL,
  nowMs = Date.now(),
  generationMaxAgeMs = DEFAULT_GENERATION_MAX_AGE_MS,
} = {}) {
  const evidence = exactRecord(input, 'host-local screen evidence');
  if (evidence.deployment !== 'local') throw new Error('Host-local screen evidence deployment must equal local.');
  const expectedBaseURL = parseLoopbackBaseUrl(baseURL);
  if (evidence.baseURL !== expectedBaseURL) throw new Error('Host-local screen evidence base URL mismatch.');
  if (evidence.outerBoxCount !== 0) throw new Error('Host-local screen evidence must not include an outer Ploinky Box.');

  const capturedAt = exactDate(evidence.capturedAt, 'host-local screen evidence capturedAt');
  const liveKit = exactRecord(evidence.liveKit, 'host-local screen evidence liveKit');
  const startedAt = exactDate(liveKit.startedAt, 'host-local LiveKit State.StartedAt');
  const maxAge = Number(generationMaxAgeMs);
  if (!Number.isSafeInteger(maxAge) || maxAge < 1) {
    throw new Error('Host-local generation max age must be a positive integer.');
  }
  if (capturedAt.milliseconds > nowMs + 30_000 || nowMs - capturedAt.milliseconds > 60_000) {
    throw new Error('Host-local screen evidence is stale or from the future.');
  }
  if (startedAt.milliseconds > nowMs + 30_000 || nowMs - startedAt.milliseconds > maxAge) {
    throw new Error('Host-local LiveKit container is not fresh enough for the smoke gate.');
  }
  if (!/(?:^|_)liveKitServerAgent(?:_|$)/.test(String(liveKit.containerName || ''))) {
    throw new Error('Host-local screen evidence does not identify the LiveKit agent container.');
  }
  if (liveKit.networkMode !== 'host') {
    throw new Error('Host-local LiveKit must own the Podman host network for the fixed UDP media mux.');
  }
  if (liveKit.portBindingCount !== 0) {
    throw new Error('Host-local LiveKit must not publish container ports while using host networking.');
  }

  return Object.freeze({
    deployment: 'local',
    capturedAt: capturedAt.text,
    baseURL: expectedBaseURL,
    outerBoxCount: 0,
    liveKit: Object.freeze({
      containerName: String(liveKit.containerName),
      containerId: exactContainerId(liveKit.containerId, 'host-local LiveKit container ID'),
      startedAt: startedAt.text,
      networkMode: 'host',
      portBindingCount: 0,
    }),
  });
}

export function collectHostLocalScreenEvidence({
  baseURL,
  nowMs = Date.now(),
  generationMaxAgeMs = DEFAULT_GENERATION_MAX_AGE_MS,
  command = defaultCommand,
} = {}) {
  const ids = String(command('podman', [
    'container', 'ls', '--filter', 'status=running', '--quiet', '--no-trunc',
  ]) || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!ids.length) throw new Error('Screen-share smoke found no running Podman containers.');
  const containers = command('podman', ['container', 'inspect', ...ids], { json: true });
  if (!Array.isArray(containers)) throw new Error('Running Podman container inspection must be an array.');

  const outerBoxCount = containers.filter((container) => (
    Boolean(container?.Config?.Labels?.[BOX_CONTRACT_LABEL])
  )).length;
  const candidates = localLiveKitCandidates(containers);
  if (candidates.length !== 1) {
    throw new Error(`Host-local screen smoke requires exactly one managed liveKitServerAgent container; found ${candidates.length}.`);
  }
  const selected = candidates[0];
  return validateHostLocalScreenEvidence({
    deployment: 'local',
    capturedAt: new Date(nowMs).toISOString(),
    baseURL: parseLoopbackBaseUrl(baseURL),
    outerBoxCount,
    liveKit: {
      containerName: String(selected.Name || '').replace(/^\//, ''),
      containerId: selected.Id || selected.ID,
      startedAt: selected?.State?.StartedAt,
      networkMode: String(selected?.HostConfig?.NetworkMode || ''),
      portBindingCount: Object.keys(selected?.HostConfig?.PortBindings || {}).length,
    },
  }, {
    baseURL,
    nowMs,
    generationMaxAgeMs,
  });
}

export function collectScreenRuntimeEvidence({
  deployment,
  ...options
} = {}) {
  if (deployment === 'local') return collectHostLocalScreenEvidence(options);
  if (deployment === 'box') {
    return Object.freeze({
      deployment: 'box',
      box: collectLocalScreenV5Evidence(options),
    });
  }
  throw new Error('SMOKE_DEPLOYMENT_MODE must be local or box when screen sharing is enabled.');
}

export function validateScreenRuntimeEvidence(input, {
  baseURL,
  nowMs = Date.now(),
} = {}) {
  const evidence = exactRecord(input, 'screen runtime evidence');
  if (evidence.deployment === 'local') {
    return validateHostLocalScreenEvidence(evidence, { baseURL, nowMs });
  }
  if (evidence.deployment === 'box') {
    return Object.freeze({
      deployment: 'box',
      box: validateLocalScreenV5Evidence(evidence.box, { baseURL, nowMs }),
    });
  }
  throw new Error('Screen runtime evidence deployment must be local or box.');
}

export function sameScreenRuntimeGeneration(before, after) {
  if (before?.deployment !== after?.deployment) return false;
  if (before.deployment === 'local') {
    return before.liveKit?.containerId === after.liveKit?.containerId
      && before.liveKit?.startedAt === after.liveKit?.startedAt
      && before.baseURL === after.baseURL;
  }
  if (before.deployment === 'box') return sameLocalScreenGeneration(before.box, after.box);
  return false;
}
