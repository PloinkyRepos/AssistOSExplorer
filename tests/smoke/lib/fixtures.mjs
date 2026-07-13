import fs from 'node:fs';
import path from 'node:path';

import { expect, test as base } from '@playwright/test';

import { smokeConfig } from './config.mjs';
import { createRedactor, findDiagnosticLeaks, redactDiagnosticValue } from './security.mjs';

const ignoredUrlPatterns = [
  /\/favicon\.ico(?:$|\?)/i,
  /\.map(?:$|\?)/i,
  /^data:/i,
  /^blob:/i,
];

const ignoredConsolePatterns = [
  /ResizeObserver loop limit exceeded/i,
  /Failed to load resource.*favicon\.ico/i,
  /source map/i,
];

function shouldIgnoreUrl(url) {
  return ignoredUrlPatterns.some((pattern) => pattern.test(String(url || '')));
}

function shouldIgnoreRequestFailure(url, method, failure) {
  if (shouldIgnoreUrl(url)) return true;
  if (failure !== 'net::ERR_ABORTED' || String(method || '').toUpperCase() !== 'POST') return false;
  try {
    const pathname = new URL(url).pathname;
    return pathname === '/dashboard/run'
      || pathname === '/webchat/input'
      || pathname === '/mcp'
      || pathname.endsWith('/mcp');
  } catch (_) {
    return false;
  }
}

function shouldIgnoreConsole(event) {
  const text = `${event.type || ''} ${event.text || ''}`;
  return ignoredConsolePatterns.some((pattern) => pattern.test(text));
}

export function installRtcProbe(context) {
  return context.addInitScript(() => {
    const NativeRTCPeerConnection = window.RTCPeerConnection;
    if (!NativeRTCPeerConnection || window.__e2ePeerConnectionProbeInstalled) return;
    window.__e2ePeerConnectionProbeInstalled = true;
    window.__e2ePeerConnections = [];
    window.RTCPeerConnection = function patchedRTCPeerConnection(...args) {
      const pc = new NativeRTCPeerConnection(...args);
      window.__e2ePeerConnections.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;
  });
}

export function attachPageDiagnostics(page, testInfo, label = 'page') {
  const redact = createRedactor();
  const events = [];

  function record(event) {
    events.push(redactDiagnosticValue(event, redact));
  }

  page.on('console', (message) => {
    record({
      kind: 'console',
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });

  page.on('pageerror', (error) => {
    record({
      kind: 'pageerror',
      type: 'error',
      text: error?.stack || error?.message || String(error),
    });
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const method = request.method();
    const failure = request.failure()?.errorText || '';
    if (shouldIgnoreRequestFailure(url, method, failure)) return;
    record({
      kind: 'requestfailed',
      type: 'error',
      url,
      method,
      failure,
    });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status < 400 || shouldIgnoreUrl(url)) return;
    record({
      kind: 'response',
      type: 'error',
      status,
      url,
      method: response.request().method(),
    });
  });

  async function flush() {
    const outDir = testInfo.outputPath('diagnostics');
    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, `${label}.browser-events.json`);
    const safeEvents = redactDiagnosticValue(events, redact);
    const payload = JSON.stringify(safeEvents, null, 2);
    const leaks = findDiagnosticLeaks(payload);
    if (leaks.length > 0) {
      throw new Error(`Refusing to persist unsafe ${label} browser diagnostics (${leaks.join(', ')})`);
    }
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, payload, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    events.splice(0, events.length, ...safeEvents);
    return events;
  }

  function actionableEvents() {
    return events.filter((event) => (
      event.type === 'error'
      && !shouldIgnoreConsole(event)
    ));
  }

  return { events, flush, actionableEvents };
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await installRtcProbe(context);
    await context.grantPermissions(['camera', 'microphone'], { origin: smokeConfig.baseURL }).catch(() => null);
    await use(context);
  },

  page: async ({ page }, use, testInfo) => {
    const diagnostics = attachPageDiagnostics(page, testInfo, 'primary');
    await use(page);
    await diagnostics.flush();
    if (smokeConfig.flags.failOnBrowserErrors && testInfo.status === testInfo.expectedStatus) {
      expect(diagnostics.actionableEvents(), 'browser console, page, or network errors').toEqual([]);
    }
  },
});

export { expect };
