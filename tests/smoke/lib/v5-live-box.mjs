import { spawnSync } from 'node:child_process';

import {
  buildV5BoxEvidence,
  normalizeOuterPortBindings,
  validateV5BoxEvidence,
} from './v5-box-evidence.mjs';

const RUNTIME_CONTRACT_LABEL = 'io.assistos.ploinky.runtime-contract';
const REQUESTED_IMAGE_LABEL = 'io.assistos.ploinky.requested-image';
const DEFAULT_GENERATION_MAX_AGE_MS = 30 * 60_000;
const DEFAULT_IMAGE_MAX_AGE_MS = 4 * 60 * 60_000;

function exactDate(value, name) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} must be an ISO timestamp.`);
  return { text: new Date(milliseconds).toISOString(), milliseconds };
}

function positiveDuration(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function oneRecord(value, name) {
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
    throw new Error(`${name} must contain exactly one record.`);
  }
  return rows[0];
}

export function validateV5BoxFreshness({
  capturedAt,
  imageCreatedAt,
  box,
  generationMaxAgeMs,
  imageMaxAgeMs,
} = {}, {
  nowMs = Date.now(),
} = {}) {
  if (!box || typeof box !== 'object' || Array.isArray(box)) {
    throw new Error('Runtime-v5 freshness requires exact box evidence.');
  }
  const captured = exactDate(capturedAt, 'runtime-v5 freshness capturedAt');
  const imageCreated = exactDate(imageCreatedAt, 'runtime-v5 freshness imageCreatedAt');
  const started = exactDate(box.startedAt, 'runtime-v5 freshness box startedAt');
  const maxGenerationAge = Math.min(
    positiveDuration(
      generationMaxAgeMs,
      DEFAULT_GENERATION_MAX_AGE_MS,
      'runtime-v5 generation max age',
    ),
    DEFAULT_GENERATION_MAX_AGE_MS,
  );
  const maxImageAge = Math.min(
    positiveDuration(
      imageMaxAgeMs,
      DEFAULT_IMAGE_MAX_AGE_MS,
      'runtime-v5 image max age',
    ),
    DEFAULT_IMAGE_MAX_AGE_MS,
  );
  if (captured.milliseconds > nowMs + 30_000 || nowMs - captured.milliseconds > 60_000) {
    throw new Error('Runtime-v5 freshness evidence is stale or from the future.');
  }
  if (started.milliseconds > nowMs + 30_000 || nowMs - started.milliseconds > maxGenerationAge) {
    throw new Error('Runtime-v5 outer container generation is not fresh enough for the release gate.');
  }
  if (imageCreated.milliseconds > nowMs + 30_000 || nowMs - imageCreated.milliseconds > maxImageAge) {
    throw new Error('Runtime-v5 outer image is not fresh enough for the release gate.');
  }
  if (imageCreated.milliseconds > started.milliseconds + 30_000) {
    throw new Error('Runtime-v5 outer image creation is later than the running container generation.');
  }
  return Object.freeze({
    capturedAt: captured.text,
    imageCreatedAt: imageCreated.text,
    generationMaxAgeMs: maxGenerationAge,
    imageMaxAgeMs: maxImageAge,
  });
}

export function verifyNetworkLaneCompletion({
  lane,
  laneResult,
  beforeBox,
  collectAfter,
} = {}) {
  const failures = [];
  if (laneResult?.error) {
    failures.push(laneResult.error);
  } else if (laneResult?.status !== 0) {
    failures.push(new Error(`WebMeet ${lane} lane failed with exit ${laneResult?.status ?? 'unknown'}.`));
  }
  let after = null;
  try {
    after = collectAfter();
    if (JSON.stringify(after?.box) !== JSON.stringify(beforeBox)) {
      throw new Error(`The exact runtime-v5 outer container generation changed during the ${lane} lane.`);
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(failures, `WebMeet ${lane} lane or post-lane runtime evidence failed.`);
  }
  return after;
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

export function parseLocalScreenBaseUrl(baseURL) {
  let parsed;
  try {
    parsed = new URL(String(baseURL || ''));
  } catch (_) {
    throw new Error('SMOKE_WEBMEET_SCREEN requires an exact loopback HTTP SMOKE_BASE_URL.');
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
    throw new Error('SMOKE_WEBMEET_SCREEN requires SMOKE_BASE_URL=http://127.0.0.1:<selectedRouterHostPort>.');
  }
  const port = parsed.port || '80';
  if (!/^[1-9][0-9]*$/.test(port) || Number(port) > 65_535) {
    throw new Error('SMOKE_WEBMEET_SCREEN loopback URL has an invalid port.');
  }
  return Object.freeze({ baseURL: `http://127.0.0.1:${port}`, port });
}

function exactScreenBindings(port) {
  return normalizeOuterPortBindings({
    '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: port }],
    '7882/udp': [{ HostIp: '0.0.0.0', HostPort: '7882' }],
  });
}

export function selectLocalScreenContainer(containerInspects, port) {
  if (!Array.isArray(containerInspects)) throw new Error('Running outer container inspection must be an array.');
  const expected = JSON.stringify(exactScreenBindings(port));
  const candidates = containerInspects.filter((container) => {
    if (container?.State?.Running !== true) return false;
    try {
      return JSON.stringify(normalizeOuterPortBindings(container?.HostConfig?.PortBindings)) === expected;
    } catch (_) {
      return false;
    }
  });
  if (candidates.length !== 1) {
    throw new Error(`SMOKE_WEBMEET_SCREEN requires exactly one running runtime-v5 outer container with the exact 127.0.0.1:${port}:8080/tcp and 0.0.0.0:7882:7882/udp publications; found ${candidates.length}.`);
  }
  return candidates[0];
}

export function validateLocalScreenV5Evidence(input, {
  baseURL,
  nowMs = Date.now(),
  generationMaxAgeMs,
  imageMaxAgeMs,
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1) {
    throw new Error('Local screen runtime-v5 evidence schemaVersion must equal 1.');
  }
  const local = parseLocalScreenBaseUrl(baseURL);
  const box = validateV5BoxEvidence(input.box, {
    expectedContainerName: input.box?.containerName,
    expectedImageId: input.box?.imageId,
    expectedImageRef: input.box?.requestedImageRef,
    baseURL: local.baseURL,
    publicIPv4: String(input.box?.publicIPv4 || ''),
  });
  if (box.selectedRouterHostPort !== local.port) {
    throw new Error('Local screen runtime-v5 Router publication does not match SMOKE_BASE_URL.');
  }
  const freshness = validateV5BoxFreshness({
    capturedAt: input.capturedAt,
    imageCreatedAt: input.imageCreatedAt,
    box,
    generationMaxAgeMs: generationMaxAgeMs ?? input.generationMaxAgeMs,
    imageMaxAgeMs: imageMaxAgeMs ?? input.imageMaxAgeMs,
  }, { nowMs });
  return Object.freeze({
    schemaVersion: 1,
    ...freshness,
    box,
  });
}

export function collectLocalScreenV5Evidence({
  baseURL,
  expectedContainerName = '',
  expectedImageId = '',
  expectedImageRef = '',
  publicIPv4 = '',
  generationMaxAgeMs = DEFAULT_GENERATION_MAX_AGE_MS,
  imageMaxAgeMs = DEFAULT_IMAGE_MAX_AGE_MS,
  nowMs = Date.now(),
  command = defaultCommand,
} = {}) {
  const local = parseLocalScreenBaseUrl(baseURL);
  const ids = String(command('podman', [
    'container', 'ls', '--filter', 'status=running', '--quiet', '--no-trunc',
  ]) || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!ids.length) throw new Error('SMOKE_WEBMEET_SCREEN found no running Podman containers.');
  const containers = command('podman', ['container', 'inspect', ...ids], { json: true });
  const selected = selectLocalScreenContainer(containers, local.port);
  const containerName = String(selected.Name || '').replace(/^\//, '');
  const labels = selected?.Config?.Labels || {};
  const requestedImageRef = String(labels[REQUESTED_IMAGE_LABEL] || '').trim();
  const runtimeContract = String(labels[RUNTIME_CONTRACT_LABEL] || '').trim();
  if (runtimeContract !== '6') throw new Error('Selected local screen outer container is not Box image contract 6.');
  if (!requestedImageRef) throw new Error('Selected local screen outer container has no requested-image label.');
  const selectedImageId = String(selected.Image || selected.ImageID || '').trim();
  if (expectedContainerName && containerName !== expectedContainerName) {
    throw new Error(`Selected local screen outer container does not equal ${expectedContainerName}.`);
  }
  const requiredImageId = expectedImageId || selectedImageId;
  const requiredImageRef = expectedImageRef || requestedImageRef;
  const imageInspection = command('podman', ['image', 'inspect', requiredImageId], { json: true });
  const image = oneRecord(imageInspection, 'outer image inspection');
  const box = buildV5BoxEvidence({
    containerInspect: [selected],
    imageInspect: imageInspection,
    expectedContainerName: expectedContainerName || containerName,
    expectedImageId: requiredImageId,
    expectedImageRef: requiredImageRef,
    baseURL: local.baseURL,
    publicIPv4: String(publicIPv4 || ''),
  });
  return validateLocalScreenV5Evidence({
    schemaVersion: 1,
    capturedAt: new Date(nowMs).toISOString(),
    imageCreatedAt: image.Created,
    generationMaxAgeMs: positiveDuration(generationMaxAgeMs, DEFAULT_GENERATION_MAX_AGE_MS, 'SMOKE_V5_MAX_GENERATION_AGE_MS'),
    imageMaxAgeMs: positiveDuration(imageMaxAgeMs, DEFAULT_IMAGE_MAX_AGE_MS, 'SMOKE_V5_MAX_IMAGE_AGE_MS'),
    box,
  }, { baseURL: local.baseURL, nowMs });
}

export function sameLocalScreenGeneration(left, right) {
  return Boolean(
    left?.box?.containerId
    && left.box.containerId === right?.box?.containerId
    && left.box.startedAt === right?.box?.startedAt
    && left.box.imageId === right?.box?.imageId
    && JSON.stringify(left.box.normalizedPortBindings) === JSON.stringify(right?.box?.normalizedPortBindings)
  );
}
