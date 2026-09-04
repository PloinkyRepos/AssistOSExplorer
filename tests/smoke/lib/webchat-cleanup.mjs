import {
  acknowledgeExactPageDiagnostics,
  assertPageDiagnosticsClean,
  checkpointPageDiagnostics,
  expect,
} from './fixtures.mjs';
import {smokeConfig} from './config.mjs';
import {createRedactor} from './security.mjs';

export const WEBCHAT_FIXTURE_DOCUMENT = '/webchat/assets/webchat.css';

export function observeWebchatCleanup(page, directory, {
  baseURL = smokeConfig.baseURL,
  agent = smokeConfig.webchatAgent,
  timeout = smokeConfig.timeouts.navigation,
} = {}) {
  const origin = new URL(baseURL).origin;
  const requests = new Map();
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || !['/webchat/stream', '/webchat/control'].includes(url.pathname)) return;
    requests.set(request, {request, url, response: null, terminal: null, settle: null});
  };
  const onResponse = (response) => {
    const entry = requests.get(response.request());
    if (entry) entry.response = response;
  };
  const finish = (request, kind) => {
    const entry = requests.get(request);
    if (!entry) return;
    entry.terminal = {kind, failure: request.failure()?.errorText || ''};
    entry.settle?.(entry.terminal);
  };
  const onFinished = (request) => finish(request, 'finished');
  const onFailed = (request) => finish(request, 'failed');
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);

  async function quiesce() {
    assertPageDiagnosticsClean(page, 'WebChat must be error-free before upload cleanup');
    const current = new URL(page.url());
    expect(current.origin).toBe(origin);
    const isChat = ['/webchat', '/webchat/'].includes(current.pathname);
    if (isChat) {
      expect(current.searchParams.get('agent')).toBe(agent);
      expect(current.searchParams.get('workspace-dir')).toBe(directory);
    } else {
      expect(current.pathname).toBe(WEBCHAT_FIXTURE_DOCUMENT);
    }
    const active = [...requests.values()].filter((entry) => !entry.terminal);
    expect(active.filter((entry) => entry.url.pathname === '/webchat/control'),
      'all WebChat cancellation controls must finish before navigation').toHaveLength(0);
    const streams = active.filter((entry) => entry.url.pathname === '/webchat/stream');
    expect(streams, 'cleanup must identify the sole live WebChat stream').toHaveLength(isChat ? 1 : 0);
    const stream = streams[0];
    if (stream) {
      expect(stream.request.method()).toBe('GET');
      expect(stream.request.resourceType()).toBe('eventsource');
      expect(stream.request.frame()).toBe(page.mainFrame());
      expect(stream.request.redirectedFrom()).toBeNull();
      expect(stream.url.searchParams.get('agent')).toBe(agent);
      expect(stream.url.searchParams.get('workspace-dir')).toBe(directory);
      expect(stream.url.searchParams.get('tabId')).toBeTruthy();
      expect(stream.url.searchParams.get('pageInstanceId')).toBeTruthy();
      expect(stream.response?.status()).toBe(200);
      expect(stream.response.headers()['content-type']).toMatch(/^text\/event-stream(?:;|$)/i);
    }

    const checkpoint = checkpointPageDiagnostics(page, 'intentional upload WebChat navigation');
    let timer;
    const terminated = stream ? new Promise((resolve, reject) => {
      stream.settle = resolve;
      timer = setTimeout(() => reject(new Error('The captured WebChat stream did not terminate during cleanup.')), timeout);
    }) : Promise.resolve(null);
    try {
      const [response, terminal] = await Promise.all([
        page.goto(WEBCHAT_FIXTURE_DOCUMENT, {waitUntil: 'load'}),
        terminated,
      ]);
      expect(response?.status(), 'the inert cleanup document must load successfully').toBe(200);
      expect(new URL(page.url()).origin).toBe(origin);
      expect(new URL(page.url()).pathname).toBe(WEBCHAT_FIXTURE_DOCUMENT);
      const expected = [];
      if (terminal?.kind === 'failed') {
        expect(terminal.failure, 'only the captured stream navigation abort is expected').toBe('net::ERR_ABORTED');
        expected.push({
          kind: 'requestfailed', type: 'error', url: createRedactor()(stream.request.url()),
          method: 'GET', failure: 'net::ERR_ABORTED',
        });
      }
      acknowledgeExactPageDiagnostics(page, checkpoint, expected);
      assertPageDiagnosticsClean(page, 'WebChat cleanup must introduce no unrelated browser errors');
    } finally {
      clearTimeout(timer);
      if (stream) stream.settle = null;
    }
  }

  return {
    quiesce,
    dispose() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    },
  };
}
