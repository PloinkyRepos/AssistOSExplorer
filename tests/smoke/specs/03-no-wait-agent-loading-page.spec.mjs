import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { smokeConfig } from '../lib/config.mjs';
import { stopAndAttachRedactedTrace } from '../lib/redacted-trace.mjs';

const STARTUP_PROBE_HEADER = 'x-ploinky-agent-startup-probe';
const OPAQUE_GENERATION = /^sha256:[a-f0-9]{64}$/;
const RAW_LIFECYCLE_DETAIL = /\b(?:runId|instanceId|enableGeneration|workerPid|statusFile|markerPath|containerId|containerName)\b|\.ploinky\/|\/Users\/|\/root\/|ploinky_[A-Za-z0-9_.-]+/i;
const EXPECTED_TRANSIENT_503_CONSOLE_ERROR = 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';

function pathnameOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

async function existsAsFile(target) {
  try {
    return (await fs.stat(target)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function releaseLatchAtomically(releaseFile, testInfo) {
  const temporaryFile = `${releaseFile}.tmp-${process.pid}-${testInfo.workerIndex}`;
  let handle;
  try {
    handle = await fs.open(temporaryFile, 'wx', 0o600);
    await handle.writeFile(`${new Date().toISOString()}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryFile, releaseFile);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }
}

function finalStableReadyRun(observations, handoffAtMs) {
  const beforeHandoff = observations
    .filter((entry) => entry.atMs <= handoffAtMs)
    .sort((left, right) => left.atMs - right.atMs);
  const lastReady = [...beforeHandoff].reverse().find((entry) => (
    entry.status === 200
    && entry.payload?.state === 'ready'
    && OPAQUE_GENERATION.test(String(entry.payload?.generation || ''))
  ));
  if (!lastReady) return [];
  let runStart = beforeHandoff.length;
  for (let index = beforeHandoff.length - 1; index >= 0; index -= 1) {
    const entry = beforeHandoff[index];
    if (
      entry.status !== 200
      || entry.payload?.state !== 'ready'
      || entry.payload?.generation !== lastReady.payload.generation
    ) {
      break;
    }
    runStart = index;
  }
  return beforeHandoff.slice(runStart);
}

test('booting no-wait agent shows the Router loading page and opens automatically', async ({ page }, testInfo) => {
  test.skip(!smokeConfig.flags.noWaitAgentLoading, 'Set SMOKE_NO_WAIT_AGENT_LOADING=1 to run the no-wait loading-page gate.');
  test.setTimeout(Math.max(smokeConfig.timeouts.test, 120_000));

  const { blockedMarker, releaseFile, routePath, assetPath } = smokeConfig.noWaitAgentLoading;
  expect(path.isAbsolute(blockedMarker), 'blocked-marker path must be absolute').toBe(true);
  expect(path.isAbsolute(releaseFile), 'release-file path must be absolute').toBe(true);
  expect(path.dirname(releaseFile), 'blocked and release controls must share one fixture directory')
    .toBe(path.dirname(blockedMarker));
  expect(path.basename(blockedMarker), 'the fixture must expose the exact blocked marker')
    .toBe('worker-starting-and-blocked');
  expect(path.basename(releaseFile), 'the fixture must expose the exact release control')
    .toBe('release-readiness');
  expect(await existsAsFile(blockedMarker), 'worker must be causally blocked before browser navigation').toBe(true);
  expect(await existsAsFile(releaseFile), 'release control must not exist before browser assertions').toBe(false);

  const context = page.context();
  const requestedRouteUrl = new URL(routePath, `${smokeConfig.baseURL}/`).href;
  const protocolObservations = [];
  const responseTasks = [];
  const mainDocumentResponses = [];
  const agentAssetRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const unexpectedHttpErrors = [];
  let traceStarted = false;
  let tracePath = '';
  let primaryError = null;
  let traceError = null;

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrors.push({
      text: message.text(),
      url: message.location().url || '',
    });
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    requestFailures.push({
      method: request.method(),
      path: pathnameOf(request.url()),
      failure: request.failure()?.errorText || 'unknown failure',
    });
  });
  page.on('request', (request) => {
    if (pathnameOf(request.url()) !== assetPath) return;
    agentAssetRequests.push({
      atMs: Date.now(),
      startupProbeHeader: request.headers()[STARTUP_PROBE_HEADER] || '',
    });
  });
  page.on('response', (response) => {
    const request = response.request();
    const pathname = pathnameOf(response.url());
    const atMs = Date.now();
    const requestHeaders = request.headers();
    const isProbe = pathname === routePath && requestHeaders[STARTUP_PROBE_HEADER] === '1';
    if (pathname === routePath && request.isNavigationRequest()) {
      mainDocumentResponses.push({
        atMs,
        status: response.status(),
        headers: response.headers(),
      });
    }
    if (response.status() >= 400 && !(pathname === routePath && (request.isNavigationRequest() || isProbe))) {
      unexpectedHttpErrors.push({ path: pathname, status: response.status() });
    }
    if (!isProbe) return;
    const task = response.json()
      .then((payload) => {
        protocolObservations.push({ atMs, status: response.status(), payload });
      })
      .catch((error) => {
        protocolObservations.push({
          atMs,
          status: response.status(),
          payload: null,
          parseError: error.message,
        });
      });
    responseTasks.push(task);
  });

  const flushResponseTasks = async () => {
    await Promise.allSettled([...responseTasks]);
  };

  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;

    const initialResponse = await page.goto(requestedRouteUrl, { waitUntil: 'domcontentloaded' });
    expect(initialResponse, 'initial navigation must receive a Router response').not.toBeNull();
    expect(initialResponse.status(), 'initial main document must remain unavailable while latched').toBe(503);
    expect(initialResponse.headers()['content-type']).toContain('text/html');
    expect(page.url(), 'the loading page must preserve the original agent URL').toBe(requestedRouteUrl);
    await expect(page.locator('[data-ploinky-agent-startup-page="starting"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Starting agent' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(
      'The agent is starting. This page will open automatically when it is ready.',
    );
    const initialDocument = await initialResponse.text();
    expect(initialDocument, 'startup document must contain no raw lifecycle detail')
      .not.toMatch(RAW_LIFECYCLE_DETAIL);
    expect(agentAssetRequests, 'the Router-owned page must not request an agent asset').toEqual([]);

    const apiResponse = await context.request.get(requestedRouteUrl, {
      failOnStatusCode: false,
      headers: {
        accept: 'application/json',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
      },
    });
    expect(apiResponse.status(), 'ordinary JSON request must retain generic inactive behavior').toBe(503);
    expect(apiResponse.headers()['content-type']).toContain('application/json');
    expect(await apiResponse.json()).toEqual({ error: 'TARGET_INACTIVE' });

    await expect.poll(async () => {
      await flushResponseTasks();
      return protocolObservations.filter((entry) => (
        entry.status === 202 && entry.payload?.state === 'starting'
      )).length;
    }, {
      message: 'startup page must observe a 202 starting probe before latch release',
      timeout: smokeConfig.timeouts.navigation,
      intervals: [100],
    }).toBeGreaterThanOrEqual(1);

    const startingObservation = protocolObservations.find((entry) => (
      entry.status === 202 && entry.payload?.state === 'starting'
    ));
    expect(startingObservation.payload).toEqual({
      state: 'starting',
      generation: startingObservation.payload.generation,
      retryAfterMs: 1000,
    });
    expect(startingObservation.payload.generation).toMatch(OPAQUE_GENERATION);
    expect(JSON.stringify(startingObservation.payload), 'probe JSON must contain no raw lifecycle detail')
      .not.toMatch(RAW_LIFECYCLE_DETAIL);
    expect(agentAssetRequests, 'no agent asset may be requested before causal release').toEqual([]);
    expect(await existsAsFile(releaseFile), 'browser may not release before initial assertions').toBe(false);

    await releaseLatchAtomically(releaseFile, testInfo);
    expect(await existsAsFile(releaseFile), 'browser must create the release control').toBe(true);
    expect(await existsAsFile(blockedMarker), 'blocked marker remains immutable evidence').toBe(true);

    await expect(page.locator('#slow-agent-ready')).toBeVisible({
      timeout: Math.max(smokeConfig.timeouts.navigation, 60_000),
    });
    expect(page.url(), 'automatic handoff must keep the original URL').toBe(requestedRouteUrl);
    await flushResponseTasks();

    const activeMainDocument = [...mainDocumentResponses]
      .reverse()
      .find((entry) => entry.status === 200);
    expect(activeMainDocument, 'automatic handoff must load one real 200 main document').toBeTruthy();
    expect(activeMainDocument.headers['x-test-startup-probe-count'], 'startup header must not reach upstream')
      .toBe('0');
    await expect(page.locator('#slow-agent-ready')).toHaveAttribute('data-startup-probe-count', '0');
    await expect(page.locator('html')).toHaveAttribute('data-agent-asset', 'loaded');

    const readyRun = finalStableReadyRun(protocolObservations, activeMainDocument.atMs);
    expect(readyRun.length, 'handoff requires repeated ready observations for one generation')
      .toBeGreaterThanOrEqual(2);
    expect(readyRun[0].payload.generation).toMatch(OPAQUE_GENERATION);
    expect(new Set(readyRun.map((entry) => entry.payload.generation)).size).toBe(1);
    expect(
      readyRun.at(-1).atMs - readyRun[0].atMs,
      'ready generation must remain stable for at least 2500ms before handoff',
    ).toBeGreaterThanOrEqual(2500);

    expect(agentAssetRequests.length, 'real agent page must request its asset after handoff')
      .toBeGreaterThanOrEqual(1);
    expect(
      Math.min(...agentAssetRequests.map((entry) => entry.atMs)),
      'agent asset must not be requested before the real 200 document handoff',
    ).toBeGreaterThanOrEqual(activeMainDocument.atMs);
    expect(agentAssetRequests.every((entry) => entry.startupProbeHeader === ''),
      'agent asset requests must not carry the startup probe header').toBe(true);

    const upstreamStatus = await context.request.get(new URL('/slowAgent/api/status', smokeConfig.baseURL).href, {
      failOnStatusCode: false,
      headers: { accept: 'application/json' },
    });
    expect(upstreamStatus.status()).toBe(200);
    expect(await upstreamStatus.json()).toEqual({ ok: true, startupProbeHeaderCount: 0 });

    for (const observation of protocolObservations) {
      expect(observation.parseError, 'startup probe responses must be valid JSON').toBeUndefined();
      expect(JSON.stringify(observation.payload), 'protocol response must contain no raw lifecycle detail')
        .not.toMatch(RAW_LIFECYCLE_DETAIL);
    }
    const unexpectedProtocolObservations = protocolObservations.filter((observation) => {
      const payload = observation.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;
      if (observation.status === 202 && payload.state === 'starting') {
        return payload.retryAfterMs !== 1000
          || !OPAQUE_GENERATION.test(String(payload.generation || ''))
          || Object.keys(payload).sort().join(',') !== 'generation,retryAfterMs,state';
      }
      if (observation.status === 200 && payload.state === 'ready') {
        return !OPAQUE_GENERATION.test(String(payload.generation || ''))
          || Object.keys(payload).sort().join(',') !== 'generation,state';
      }
      if (observation.status === 503 && payload.state === 'retry') {
        return payload.code !== 'edge_generation_changed'
          || Object.keys(payload).sort().join(',') !== 'code,state';
      }
      return true;
    });
    expect(unexpectedProtocolObservations, 'startup probes must remain inside the reviewed protocol').toEqual([]);
    expect(
      mainDocumentResponses.map((entry) => entry.status),
      'handoff must contain only the required initial 503 and one real 200 document',
    ).toEqual([503, 200]);
    const expectedTransient503ConsoleErrors = 1 + protocolObservations.filter((entry) => entry.status === 503).length;
    expect(consoleErrors, 'Chromium must report only the intentionally observed route 503 responses')
      .toHaveLength(expectedTransient503ConsoleErrors);
    for (const error of consoleErrors) {
      expect(error).toEqual({
        text: EXPECTED_TRANSIENT_503_CONSOLE_ERROR,
        url: requestedRouteUrl,
      });
    }
    expect(pageErrors, 'unhandled page errors').toEqual([]);
    expect(requestFailures, 'failed browser requests').toEqual([]);
    expect(unexpectedHttpErrors, 'unexpected HTTP errors').toEqual([]);

    await testInfo.attach('no-wait-agent-loading-evidence', {
      body: Buffer.from(JSON.stringify({
        initialMainDocumentStatus: 503,
        startingProbeCount: protocolObservations.filter((entry) => entry.status === 202).length,
        readyGeneration: readyRun.at(-1).payload.generation,
        readyWindowMs: readyRun.at(-1).atMs - readyRun[0].atMs,
        activeMainDocumentStatus: activeMainDocument.status,
        upstreamStartupProbeHeaderCount: 0,
        assetRequestsAfterHandoff: agentAssetRequests.length,
      }, null, 2)),
      contentType: 'application/json',
    });
  } catch (error) {
    primaryError = error;
  } finally {
    if (traceStarted) {
      try {
        tracePath = await stopAndAttachRedactedTrace(context, testInfo, 'no-wait-agent-loading');
      } catch (error) {
        traceError = error;
      }
    }
  }

  if (tracePath) {
    try {
      expect((await fs.stat(tracePath)).isFile(), 'redacted trace artifact must exist').toBe(true);
      expect(
        testInfo.attachments.some((attachment) => attachment.name === 'no-wait-agent-loading-redacted-trace'),
        'redacted trace must be attached to the test result',
      ).toBe(true);
    } catch (error) {
      traceError = traceError ? new AggregateError([traceError, error], 'redacted trace verification failed') : error;
    }
  } else if (!traceError) {
    traceError = new Error('Redacted trace path was not produced.');
  }

  if (primaryError && traceError) {
    throw new AggregateError([primaryError, traceError], 'no-wait loading gate and trace evidence both failed');
  }
  if (primaryError) throw primaryError;
  if (traceError) throw traceError;
});
