#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  RESOURCE_BENCHMARK_SCHEMA_VERSION,
  assertRuntimeEvidenceStable,
  buildHostControls,
  buildResourceScenario,
  classifyRuntimeEvidence,
  cpuBusyPercent,
  parseContainerRows,
  parseLoadavg,
  parseMeminfo,
  parseProcStat,
  processStateFromStat,
  summarizeResourceSamples,
  validateResourceReport,
} from '../lib/resource-benchmark-metrics.mjs';
import {
  normalizeBenchmarkLabel,
  sanitizeError,
} from '../lib/ui-benchmark-metrics.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BOX_ROLE_LABEL = 'io.assistos.ploinky-box.role=box';

function printHelp() {
  console.log(`Explorer deployment resource benchmark

Usage:
  npm run benchmark:resources -- \\
    --label master \\
    --variant master \\
    --deployment-id <id> \\
    --ploinky-sha <40-hex-sha> \\
    --explorer-sha <40-hex-sha>

Options:
  --label <name>             Report label
  --variant <name>           master or ploinky-proxy
  --deployment-id <id>       Stable non-secret deployment identifier
  --ploinky-sha <sha>        Exact deployed Ploinky commit
  --explorer-sha <sha>       Exact deployed Explorer commit
  --workload-id <id>         Comparable workload name (default: idle-steady)
  --warmup-seconds <n>       Stabilization time (default: 300)
  --duration-seconds <n>     Measurement time (default: 1800)
  --interval-seconds <n>     Sampling interval (default: 10)
  --expected-targets <n>     Exact running Ploinky target count (default: 16)
  --artifact-dir <path>      Output directory
  --runtime <name>           Container runtime executable (default: podman)

The runner is Linux-only and reads low-overhead whole-host counters from /proc.
It queries the container runtime only before warmup, after warmup, and after
sampling so the benchmark itself does not add recurring Podman load.`);
}

function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const valued = new Set([
    '--label',
    '--variant',
    '--deployment-id',
    '--ploinky-sha',
    '--explorer-sha',
    '--workload-id',
    '--warmup-seconds',
    '--duration-seconds',
    '--interval-seconds',
    '--expected-targets',
    '--artifact-dir',
    '--runtime',
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!valued.has(option)) throw new Error(`Unknown resource benchmark option: ${option}`);
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Missing value for ${option}.`);
    }
    result[option.slice(2)] = argv[index + 1];
    index += 1;
  }
  return { help: false, ...result };
}

function exactSafeId(value, name) {
  const text = String(value || '').trim();
  if (!SAFE_ID_PATTERN.test(text)) {
    throw new Error(`${name} must use 1-80 letters, numbers, dots, underscores, or dashes.`);
  }
  return text;
}

function exactSha(value, name) {
  const text = String(value || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(text)) throw new Error(`${name} must be an exact 40-hex Git SHA.`);
  return text;
}

function integer(value, fallback, name, { minimum = 0 } = {}) {
  const selected = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(selected) || selected < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return selected;
}

function resolveConfig(raw) {
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const label = normalizeBenchmarkLabel(raw.label || process.env.RESOURCE_BENCHMARK_LABEL);
  const variant = String(raw.variant || process.env.RESOURCE_BENCHMARK_VARIANT || '').trim();
  if (!['master', 'ploinky-proxy'].includes(variant)) {
    throw new Error('Resource benchmark variant must be master or ploinky-proxy.');
  }
  const runtime = exactSafeId(
    raw.runtime || process.env.RESOURCE_BENCHMARK_RUNTIME || 'podman',
    'Resource benchmark container runtime',
  );
  if (runtime !== 'podman') {
    throw new Error('The Explorer deployment resource benchmark currently requires Podman.');
  }
  const scenario = buildResourceScenario({
    workloadId: raw['workload-id'] || process.env.RESOURCE_BENCHMARK_WORKLOAD_ID || 'idle-steady',
    warmupSeconds: integer(
      raw['warmup-seconds'] || process.env.RESOURCE_BENCHMARK_WARMUP_SECONDS,
      300,
      'Resource benchmark warmup seconds',
    ),
    durationSeconds: integer(
      raw['duration-seconds'] || process.env.RESOURCE_BENCHMARK_DURATION_SECONDS,
      1_800,
      'Resource benchmark duration seconds',
      { minimum: 1 },
    ),
    intervalSeconds: integer(
      raw['interval-seconds'] || process.env.RESOURCE_BENCHMARK_INTERVAL_SECONDS,
      10,
      'Resource benchmark interval seconds',
      { minimum: 1 },
    ),
    expectedTargets: integer(
      raw['expected-targets'] || process.env.RESOURCE_BENCHMARK_EXPECTED_TARGETS,
      16,
      'Expected running target count',
      { minimum: 1 },
    ),
  });
  return {
    label,
    variant,
    runtime,
    deploymentId: exactSafeId(
      raw['deployment-id'] || process.env.RESOURCE_BENCHMARK_DEPLOYMENT_ID,
      'Resource benchmark deployment ID',
    ),
    ploinkySha: exactSha(
      raw['ploinky-sha'] || process.env.RESOURCE_BENCHMARK_PLOINKY_SHA,
      'Deployed Ploinky SHA',
    ),
    explorerSha: exactSha(
      raw['explorer-sha'] || process.env.RESOURCE_BENCHMARK_EXPLORER_SHA,
      'Deployed Explorer SHA',
    ),
    artifactDirectory: path.resolve(
      raw['artifact-dir']
        || process.env.RESOURCE_BENCHMARK_ARTIFACT_DIR
        || path.join(repositoryRoot, '.ploinky', 'test-artifacts', 'resource-benchmark', runId),
    ),
    scenario,
  };
}

function runRuntime(runtime, args) {
  const result = spawnSync(runtime, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1_024 * 1_024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(
      result.error?.message || result.stderr || result.stdout || `exit ${result.status}`,
    ).trim().split(/\r?\n/, 1)[0];
    throw new Error(`Container runtime command failed: ${detail.slice(0, 500)}`);
  }
  return result.stdout;
}

function containerName(row) {
  return String(
    Array.isArray(row?.Names) ? row.Names[0] : (row?.Names || row?.Name || ''),
  ).replace(/^\//, '');
}

function collectRuntimeEvidence(config) {
  const hostRows = parseContainerRows(runRuntime(config.runtime, [
    'ps',
    '--no-trunc',
    '--format',
    'json',
  ]));
  let nestedRows = null;
  if (config.variant === 'ploinky-proxy') {
    const boxes = parseContainerRows(runRuntime(config.runtime, [
      'ps',
      '--no-trunc',
      '--filter',
      `label=${BOX_ROLE_LABEL}`,
      '--format',
      'json',
    ]));
    if (boxes.length !== 1) {
      throw new Error('Ploinky-proxy benchmark requires exactly one running outer Box.');
    }
    const boxName = containerName(boxes[0]);
    if (!boxName) throw new Error('Running outer Box inventory is missing its name.');
    nestedRows = parseContainerRows(runRuntime(config.runtime, [
      'exec',
      boxName,
      'podman',
      'ps',
      '--no-trunc',
      '--format',
      'json',
    ]));
  }
  return classifyRuntimeEvidence({
    variant: config.variant,
    hostRows,
    nestedRows,
    expectedTargets: config.scenario.expectedTargets,
  });
}

function parseOsRelease() {
  const values = {};
  for (const line of fs.readFileSync('/etc/os-release', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return values;
}

function cpuModel() {
  const source = fs.readFileSync('/proc/cpuinfo', 'utf8');
  const match = /^(?:model name|Hardware)\s*:\s*(.+)$/m.exec(source);
  return match?.[1]?.trim() || 'unknown';
}

function collectHostControls(config) {
  const memory = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
  const release = parseOsRelease();
  const runtimeVersion = runRuntime(config.runtime, ['--version']).trim();
  return buildHostControls({
    platform: process.platform,
    architecture: process.arch,
    kernelRelease: os.release(),
    osId: release.ID || 'unknown',
    osVersionId: release.VERSION_ID || 'unknown',
    logicalCpuCount: os.cpus().length,
    cpuModel: cpuModel(),
    totalMemoryBytes: memory.totalMemoryBytes,
    containerRuntime: config.runtime,
    containerRuntimeVersion: runtimeVersion,
    nodeVersion: process.version,
  });
}

function processInventory() {
  let processCount = 0;
  let zombieCount = 0;
  for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9]+$/.test(entry.name)) continue;
    try {
      const state = processStateFromStat(fs.readFileSync(`/proc/${entry.name}/stat`, 'utf8'));
      processCount += 1;
      if (state === 'Z') zombieCount += 1;
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw error;
    }
  }
  return { processCount, zombieCount };
}

function collectSample(previousCpu, startedAt) {
  const currentCpu = parseProcStat(fs.readFileSync('/proc/stat', 'utf8'));
  const memory = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
  const load = parseLoadavg(fs.readFileSync('/proc/loadavg', 'utf8'));
  const processes = processInventory();
  return {
    cpu: currentCpu,
    sample: {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      cpuBusyPercent: cpuBusyPercent(previousCpu, currentCpu),
      memoryUsedBytes: memory.memoryUsedBytes,
      memoryAvailableBytes: memory.availableMemoryBytes,
      swapUsedBytes: memory.swapUsedBytes,
      load1: load.load1,
      load5: load.load5,
      load15: load.load15,
      runnableEntities: load.runnableEntities,
      totalEntities: load.totalEntities,
      processCount: processes.processCount,
      zombieCount: processes.zombieCount,
    },
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collectSamples(scenario) {
  const intervalMs = scenario.intervalSeconds * 1_000;
  const sampleCount = Math.floor(scenario.durationSeconds / scenario.intervalSeconds);
  const samples = [];
  const startedAt = Date.now();
  let previousCpu = parseProcStat(fs.readFileSync('/proc/stat', 'utf8'));
  const progressEvery = Math.max(1, Math.floor(60 / scenario.intervalSeconds));
  for (let index = 0; index < sampleCount; index += 1) {
    await sleep(intervalMs);
    const result = collectSample(previousCpu, startedAt);
    previousCpu = result.cpu;
    samples.push(result.sample);
    if ((index + 1) % progressEvery === 0 || index + 1 === sampleCount) {
      console.log(
        `Resource samples: ${index + 1}/${sampleCount}; `
        + `CPU ${result.sample.cpuBusyPercent}%; `
        + `processes ${result.sample.processCount}; zombies ${result.sample.zombieCount}`,
      );
    }
  }
  return samples;
}

function writeReport(directory, report) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(directory, 'result.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);
  return outputPath;
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help) {
    printHelp();
    return;
  }
  if (process.platform !== 'linux') {
    throw new Error('Explorer resource benchmarks must run on the Linux deployment host.');
  }
  const config = resolveConfig(raw);
  console.log(`Explorer resource benchmark: ${config.label}`);
  console.log(`Variant: ${config.variant}; workload: ${config.scenario.workloadId}`);
  console.log(
    `Warmup ${config.scenario.warmupSeconds}s; sample `
    + `${config.scenario.durationSeconds}s every ${config.scenario.intervalSeconds}s`,
  );

  const environment = { host: collectHostControls(config) };
  const beforeWarmup = collectRuntimeEvidence(config);
  if (config.scenario.warmupSeconds > 0) {
    console.log(`Waiting ${config.scenario.warmupSeconds}s for the admitted graph to stabilize...`);
    await sleep(config.scenario.warmupSeconds * 1_000);
  }
  const afterWarmup = collectRuntimeEvidence(config);
  const samples = await collectSamples(config.scenario);
  const afterSampling = collectRuntimeEvidence(config);
  const runtimeEvidence = { beforeWarmup, afterWarmup, afterSampling };
  assertRuntimeEvidenceStable(runtimeEvidence);

  const report = {
    schemaVersion: RESOURCE_BENCHMARK_SCHEMA_VERSION,
    kind: 'explorer-resource-benchmark',
    generatedAt: new Date().toISOString(),
    status: 'passed',
    label: config.label,
    deployment: {
      variant: config.variant,
      deploymentId: config.deploymentId,
      ploinkySha: config.ploinkySha,
      explorerSha: config.explorerSha,
    },
    scenario: config.scenario,
    environment,
    runtimeEvidence,
    samples,
    summary: summarizeResourceSamples(samples),
  };
  validateResourceReport(report);
  const outputPath = writeReport(config.artifactDirectory, report);
  console.log(`Resource benchmark artifact: ${outputPath}`);
}

try {
  await main();
} catch (error) {
  const safe = sanitizeError(error);
  console.error(`${safe.name}: ${safe.message}`);
  process.exitCode = 1;
}
