#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ROUTER_HOP_CONCURRENCY,
  ROUTER_HOP_SAMPLE_COUNT,
  createRouterHopArtifact,
  runBoundedSamples,
} from '../lib/router-hop-metrics.mjs';
import {
  normalizeBenchmarkBaseUrl,
  normalizeBenchmarkLabel,
  sanitizeError,
} from '../lib/ui-benchmark-metrics.mjs';

const execFileAsync = promisify(execFile);
const smokeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(smokeRoot));
const SAFE_SHA = /^[0-9a-f]{40}$/;
const SAFE_BOX_ID = /^[0-9a-f]{64}$/;
const SAFE_DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const AGENTS = Object.freeze([
  { key: 'explorer', boundary: 'explorer', publicPath: '/explorer/health' },
  { key: 'dpuAgent', boundary: 'dpu', publicPath: '/dpuAgent/health' },
  { key: 'gitAgent', boundary: 'git', publicPath: '/gitAgent/health' },
]);

const ROUTE_METADATA_SCRIPT = [
  "const {loadApiRoutes}=await import('/opt/ploinky/cli/server/routerHandlers.js');",
  "const routes=loadApiRoutes();",
  "const selected={};",
  "for(const key of ['explorer','dpuAgent','gitAgent']){",
  "const route=routes[key];",
  "const hostPort=Number(route?.hostPort||0);",
  "const container=String(route?.container||'');",
  "if(!Number.isInteger(hostPort)||hostPort<1||hostPort>65535||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container))process.exit(21);",
  "selected[key]={hostPort,container};",
  "}",
  "process.stdout.write(JSON.stringify(selected));",
].join('');

const HTTP_SAMPLE_SCRIPT = String.raw`
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const port = Number(process.argv[1]);
const requestPath = String(process.argv[2]);
const count = Number(process.argv[3]);
const concurrency = Number(process.argv[4]);
function sample() {
  return new Promise((resolve) => {
    const started = performance.now();
    let ttfbMs = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      agent: false,
    }, (response) => {
      ttfbMs = performance.now() - started;
      response.on('data', () => {});
      response.on('end', () => finish({
        status: Number(response.statusCode || 0),
        ttfbMs,
        totalMs: performance.now() - started,
        errorCode: null,
      }));
      response.on('error', () => finish({
        status: 0,
        ttfbMs: null,
        totalMs: null,
        errorCode: 'RESPONSE_FAILED',
      }));
    });
    request.setTimeout(10000, () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', (error) => finish({
      status: 0,
      ttfbMs: null,
      totalMs: null,
      errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'REQUEST_FAILED',
    }));
  });
}
async function main() {
  const output = new Array(count);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      if (index >= count) return;
      output[index] = await sample();
    }
  }));
  process.stdout.write(JSON.stringify(output));
}
main().catch(() => process.exit(22));
`;

function required(value, label, pattern) {
  const normalized = String(value || '').trim();
  if (!pattern.test(normalized)) throw new Error(`Router-hop ${label} is invalid.`);
  return normalized;
}

function positiveInteger(value, fallback, label, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new Error(`Router-hop ${label} must be an integer from 1 to ${maximum}.`);
  }
  return numeric;
}

function loadConfig() {
  const baseURL = normalizeBenchmarkBaseUrl(
    process.env.ROUTER_HOP_BASE_URL || 'http://127.0.0.1:8080',
  );
  const parsedBase = new URL(baseURL);
  if (parsedBase.pathname !== '/' || parsedBase.hostname !== '127.0.0.1') {
    throw new Error('Router-hop base URL must use the loopback Router root.');
  }
  const sequentialSamples = positiveInteger(
    process.env.ROUTER_HOP_SEQUENTIAL_SAMPLES,
    ROUTER_HOP_SAMPLE_COUNT,
    'sequential sample count',
    1_000,
  );
  const concurrentSamples = positiveInteger(
    process.env.ROUTER_HOP_CONCURRENT_SAMPLES,
    ROUTER_HOP_SAMPLE_COUNT,
    'concurrent sample count',
    1_000,
  );
  const concurrency = positiveInteger(
    process.env.ROUTER_HOP_CONCURRENCY,
    ROUTER_HOP_CONCURRENCY,
    'concurrency',
    concurrentSamples,
  );
  const label = normalizeBenchmarkLabel(process.env.ROUTER_HOP_LABEL || 'ploinky-proxy-hop');
  const runId = `${label}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`;
  return {
    baseURL,
    hostname: parsedBase.hostname,
    port: Number(parsedBase.port || 80),
    label,
    boxId: required(process.env.ROUTER_HOP_BOX_ID, 'Box ID', SAFE_BOX_ID),
    deploymentId: required(
      process.env.ROUTER_HOP_DEPLOYMENT_ID,
      'deployment identifier',
      SAFE_DEPLOYMENT_ID,
    ),
    ploinkySha: required(process.env.ROUTER_HOP_PLOINKY_SHA, 'Ploinky SHA', SAFE_SHA),
    explorerSha: required(process.env.ROUTER_HOP_EXPLORER_SHA, 'Explorer SHA', SAFE_SHA),
    artifactRoot: path.resolve(
      process.env.ROUTER_HOP_ARTIFACT_DIR
        || path.join(repoRoot, '.ploinky', 'test-artifacts', 'router-hop', runId),
    ),
    sequentialSamples,
    concurrentSamples,
    concurrency,
    username: String(
      process.env.UI_BENCHMARK_USERNAME
        || process.env.SMOKE_USERNAME
        || 'admin',
    ),
    password: String(
      process.env.UI_BENCHMARK_PASSWORD
        || process.env.SMOKE_PASSWORD
        || 'admin',
    ),
  };
}

async function execJson(command, args, timeout = 120_000) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(String(stdout || ''));
  } catch (cause) {
    const error = new Error('Router-hop subprocess failed.');
    error.code = 'SUBPROCESS_FAILED';
    error.cause = cause;
    throw error;
  }
}

function boxExecArgs(boxId, argv) {
  return [
    'container',
    'exec',
    '--user',
    'podman',
    '--workdir',
    '/workspace',
    boxId,
    ...argv,
  ];
}

async function readRouteMetadata(boxId) {
  const selected = await execJson('podman', boxExecArgs(boxId, [
    '/usr/local/bin/node',
    '--input-type=module',
    '-e',
    ROUTE_METADATA_SCRIPT,
  ]));
  const metadata = {};
  for (const agent of AGENTS) {
    const route = selected?.[agent.key];
    const hostPort = Number(route?.hostPort || 0);
    const container = String(route?.container || '');
    if (
      !Number.isInteger(hostPort)
      || hostPort < 1
      || hostPort > 65535
      || !SAFE_CONTAINER_NAME.test(container)
    ) {
      throw new Error('Router-hop allowlisted route metadata is unavailable.');
    }
    metadata[agent.key] = Object.freeze({ hostPort, container });
  }
  return Object.freeze(metadata);
}

function httpSample({ hostname, port, requestPath }) {
  return new Promise((resolve) => {
    const started = performance.now();
    let ttfbMs = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get({
      hostname,
      port,
      path: requestPath,
      agent: false,
    }, (response) => {
      ttfbMs = performance.now() - started;
      response.on('data', () => {});
      response.on('end', () => finish({
        status: Number(response.statusCode || 0),
        ttfbMs,
        totalMs: performance.now() - started,
        errorCode: null,
      }));
      response.on('error', () => finish({
        status: 0,
        ttfbMs: null,
        totalMs: null,
        errorCode: 'RESPONSE_FAILED',
      }));
    });
    request.setTimeout(10_000, () => {
      request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', (error) => finish({
      status: 0,
      ttfbMs: null,
      totalMs: null,
      errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'REQUEST_FAILED',
    }));
  });
}

async function localSamples(target, count, concurrency) {
  return runBoundedSamples(
    () => httpSample(target),
    count,
    concurrency,
  );
}

async function boxSamples(boxId, port, requestPath, count, concurrency) {
  return execJson('podman', boxExecArgs(boxId, [
    '/usr/local/bin/node',
    '-e',
    HTTP_SAMPLE_SCRIPT,
    String(port),
    requestPath,
    String(count),
    String(concurrency),
  ]), Math.max(120_000, count * 12_000));
}

async function nestedSamples(boxId, container, count, concurrency) {
  return execJson('podman', boxExecArgs(boxId, [
    'podman',
    'container',
    'exec',
    container,
    'node',
    '-e',
    HTTP_SAMPLE_SCRIPT,
    '7000',
    '/health',
    String(count),
    String(concurrency),
  ]), Math.max(120_000, count * 12_000));
}

async function browserSamples(page, requestPath, count, concurrency) {
  return page.evaluate(async ({ requestPath: selectedPath, count: total, concurrency: workers }) => {
    const output = new Array(total);
    let next = 0;
    const sample = async () => {
      const started = performance.now();
      try {
        const response = await fetch(selectedPath, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const ttfbMs = performance.now() - started;
        await response.arrayBuffer();
        return {
          status: Number(response.status || 0),
          ttfbMs,
          totalMs: performance.now() - started,
          errorCode: null,
        };
      } catch {
        return {
          status: 0,
          ttfbMs: null,
          totalMs: null,
          errorCode: 'FETCH_FAILED',
        };
      }
    };
    await Promise.all(Array.from({ length: workers }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= total) return;
        output[index] = await sample();
      }
    }));
    return output;
  }, { requestPath, count, concurrency });
}

async function collectAuthenticatedRouterSamples(browser, config, boundarySamples) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  try {
    const response = await page.goto(`${config.baseURL}/explorer/index.html`, { waitUntil: 'load' });
    if (!response || response.status() >= 400) {
      throw new Error('Router-hop authentication entry route failed.');
    }
    await page.locator('input#username, input[name="username"]').first().fill(config.username);
    await page.locator('input#password, input[name="password"]').first().fill(config.password);
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.locator(
      'form[action="/auth/login"] button[type="submit"], button[type="submit"], .auth-btn',
    ).first().click();
    await navigation;
    await page.locator('#page_content').waitFor({ state: 'visible' });

    for (const agent of AGENTS) {
      const boundaryName = `${agent.boundary}-router-health`;
      boundarySamples[boundaryName] = {
        sequential: await browserSamples(
          page,
          agent.publicPath,
          config.sequentialSamples,
          1,
        ),
        concurrent: await browserSamples(
          page,
          agent.publicPath,
          config.concurrentSamples,
          config.concurrency,
        ),
      };
    }
  } finally {
    await context.close();
  }
}

async function collectProbe(config) {
  const routeMetadata = await readRouteMetadata(config.boxId);
  const boundarySamples = {};
  boundarySamples['host-router-login'] = {
    sequential: await localSamples({
      hostname: config.hostname,
      port: config.port,
      requestPath: '/auth/login',
    }, config.sequentialSamples, 1),
    concurrent: await localSamples({
      hostname: config.hostname,
      port: config.port,
      requestPath: '/auth/login',
    }, config.concurrentSamples, config.concurrency),
  };
  boundarySamples['box-router-login'] = {
    sequential: await boxSamples(
      config.boxId,
      8080,
      '/auth/login',
      config.sequentialSamples,
      1,
    ),
    concurrent: await boxSamples(
      config.boxId,
      8080,
      '/auth/login',
      config.concurrentSamples,
      config.concurrency,
    ),
  };

  for (const agent of AGENTS) {
    const route = routeMetadata[agent.key];
    boundarySamples[`${agent.boundary}-nested-health`] = {
      sequential: await nestedSamples(
        config.boxId,
        route.container,
        config.sequentialSamples,
        1,
      ),
      concurrent: await nestedSamples(
        config.boxId,
        route.container,
        config.concurrentSamples,
        config.concurrency,
      ),
    };
    boundarySamples[`${agent.boundary}-box-health`] = {
      sequential: await boxSamples(
        config.boxId,
        route.hostPort,
        '/health',
        config.sequentialSamples,
        1,
      ),
      concurrent: await boxSamples(
        config.boxId,
        route.hostPort,
        '/health',
        config.concurrentSamples,
        config.concurrency,
      ),
    };
  }

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  try {
    await collectAuthenticatedRouterSamples(browser, config, boundarySamples);
  } finally {
    await browser.close();
  }

  return createRouterHopArtifact({
    label: config.label,
    deploymentId: config.deploymentId,
    ploinkySha: config.ploinkySha,
    explorerSha: config.explorerSha,
    browser: `chromium ${browserVersion}`,
    boundarySamples,
    sequentialSamples: config.sequentialSamples,
    concurrentSamples: config.concurrentSamples,
    concurrency: config.concurrency,
  });
}

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.artifactRoot, { recursive: true, mode: 0o700 });
  const artifact = await collectProbe(config);
  const resultPath = path.join(config.artifactRoot, 'result.json');
  fs.writeFileSync(resultPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(`Router-hop probe: ${artifact.status}`);
  console.log(`Router-hop artifact: ${resultPath}`);
  if (artifact.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = sanitizeError(error);
    console.error(`${safe.name}: ${safe.message}`);
    process.exitCode = 1;
  });
}
