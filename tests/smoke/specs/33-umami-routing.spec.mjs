import { signIn } from '../lib/auth.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { attachPageDiagnostics, expect, test } from '../lib/fixtures.mjs';
import { findSecretLeaks } from '../lib/security.mjs';

const DASHBOARD_PREFIX = '/services/umami/';
const TELEMETRY_PREFIX = '/public-services/umami-telemetry/';
const SANITIZATION_HEADER = 'x-umami-telemetry-sanitization';
const SANITIZATION_EVIDENCE = [
  'client-cookie=absent',
  'client-authorization=absent',
  'client-identity=absent',
  'client-forwarding=absent',
  'client-hop-by-hop=absent',
].join('; ');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required when SMOKE_UMAMI=1.`);
  return value;
}

function urlEvidence(value) {
  const url = new URL(value);
  return {
    origin: url.origin,
    pathname: url.pathname,
    queryKeys: Array.from(url.searchParams.keys()).sort(),
  };
}

function privateOrigin(value, routerOrigin) {
  const url = new URL(value);
  if (url.origin === routerOrigin) return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === 'host.containers.internal'
    || ['3000', '3001', '5432', '7301'].includes(url.port);
}

async function attachEvidence(testInfo, name, value) {
  const payload = JSON.stringify(value, null, 2);
  expect(findSecretLeaks(payload), `secret values leaked into ${name}`).toEqual([]);
  await testInfo.attach(name, {
    body: Buffer.from(payload, 'utf8'),
    contentType: 'application/json',
  });
}

test.describe('Umami Router publication @external', () => {
  test('authenticated dashboard keeps HTML, assets, API, and navigation under its base path', async ({ page }, testInfo) => {
    test.skip(!smokeConfig.flags.umami, 'SMOKE_UMAMI is off.');
    const umamiUsername = required('SMOKE_UMAMI_USERNAME');
    const umamiPassword = required('SMOKE_UMAMI_PASSWORD');
    const routerOrigin = new URL(smokeConfig.baseURL).origin;

    await signIn(page, smokeConfig.primaryUser, '/dashboard');
    const requests = [];
    page.on('request', (request) => requests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    }));

    const response = await page.goto(DASHBOARD_PREFIX, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), 'Umami dashboard HTML response').toBeLessThan(400);
    expect(new URL(page.url()).pathname).toMatch(/^\/services\/umami\//);

    const usernameInput = page.locator('input[name="username"], input[autocomplete="username"]').first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    await expect(usernameInput, 'Umami must retain its defense-in-depth login').toBeVisible();
    await expect(passwordInput).toBeVisible();
    await usernameInput.fill(umamiUsername);
    await passwordInput.fill(umamiPassword);
    await page.locator('form button[type="submit"], button[type="submit"]').first().click();
    await expect(passwordInput, 'Umami login must leave the credential form').toBeHidden({
      timeout: smokeConfig.timeouts.navigation,
    });
    await expect(page.locator('body')).not.toContainText(/invalid password|invalid credentials|login failed/i);

    const api = await page.evaluate(async (path) => {
      const apiResponse = await fetch(path, { cache: 'no-store', credentials: 'include' });
      return {
        status: apiResponse.status,
        contentType: apiResponse.headers.get('content-type') || '',
        bodyLength: (await apiResponse.text()).length,
      };
    }, `${DASHBOARD_PREFIX}api/heartbeat`);
    expect(api.status, 'Umami heartbeat API through Router').toBe(200);
    expect(api.bodyLength).toBeGreaterThan(0);

    const currentPath = new URL(page.url()).pathname;
    const anchors = page.locator('a[href]');
    let navigationIndex = -1;
    for (let index = 0; index < await anchors.count(); index += 1) {
      const href = await anchors.nth(index).getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;
      const resolved = new URL(href, page.url());
      if (resolved.origin !== routerOrigin) continue;
      if (!resolved.pathname.startsWith(DASHBOARD_PREFIX) || resolved.pathname === currentPath) continue;
      if (/\/(?:login|logout)\/?$/i.test(resolved.pathname)) continue;
      navigationIndex = index;
      break;
    }
    expect(navigationIndex, 'Umami must render at least one in-app base-path navigation link').toBeGreaterThanOrEqual(0);
    await anchors.nth(navigationIndex).click();
    await expect.poll(() => new URL(page.url()).pathname, {
      message: 'Umami in-app navigation stays under the configured base path',
      timeout: smokeConfig.timeouts.navigation,
    }).toMatch(/^\/services\/umami\//);

    const sameOriginRequests = requests.filter((entry) => new URL(entry.url).origin === routerOrigin);
    expect(sameOriginRequests.length, 'Umami must issue same-origin Router requests').toBeGreaterThan(1);
    expect(
      sameOriginRequests.filter((entry) => ['script', 'stylesheet', 'font', 'image'].includes(entry.resourceType)).length,
      'Umami must load at least one browser asset through the base path',
    ).toBeGreaterThan(0);
    for (const entry of sameOriginRequests) {
      expect(new URL(entry.url).pathname, `root-relative Umami request leaked: ${entry.url}`).toMatch(/^\/services\/umami\//);
    }
    expect(requests.some((entry) => privateOrigin(entry.url, routerOrigin)), 'Umami must not dial a browser-visible private origin').toBe(false);

    const domUrls = await page.locator('[src], [href], [action]').evaluateAll((elements) => (
      elements.flatMap((element) => ['src', 'href', 'action']
        .map((attribute) => element.getAttribute(attribute))
        .filter(Boolean)
        .map((value) => new URL(value, document.baseURI).href))
    ));
    expect(domUrls.some((url) => privateOrigin(url, routerOrigin)), 'Umami DOM must not expose private origins').toBe(false);
    for (const url of domUrls.filter((value) => new URL(value).origin === routerOrigin)) {
      const pathname = new URL(url).pathname;
      if (pathname === new URL(page.url()).pathname && new URL(url).hash) continue;
      expect(pathname, `root-relative Umami DOM URL leaked: ${url}`).toMatch(/^\/services\/umami\//);
    }

    await attachEvidence(testInfo, 'umami-dashboard-routing', {
      finalUrl: urlEvidence(page.url()),
      api,
      requests: requests.map((entry) => ({ ...urlEvidence(entry.url), method: entry.method, resourceType: entry.resourceType })),
    });
  });

  test('guest tracker and ingestion expose value-free proof that credentials were stripped upstream', async ({ browser }, testInfo) => {
    test.skip(!smokeConfig.flags.umami, 'SMOKE_UMAMI is off.');
    const websiteId = required('SMOKE_UMAMI_WEBSITE_ID');
    expect(websiteId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const routerOrigin = new URL(smokeConfig.baseURL).origin;
    const context = await browser.newContext({
      baseURL: smokeConfig.baseURL,
      ignoreHTTPSErrors: true,
    });
    await context.addCookies([{
      name: 'smoke_identity',
      value: `browser-sentinel-${smokeConfig.runId}`,
      url: routerOrigin,
    }]);
    const page = await context.newPage();
    const diagnostics = attachPageDiagnostics(page, testInfo, 'umami-guest-telemetry');
    try {
      const scriptResponse = await page.goto(`${TELEMETRY_PREFIX}script.js`, { waitUntil: 'domcontentloaded' });
      expect(scriptResponse?.status(), 'real Umami tracker through guest Router service').toBe(200);
      expect(scriptResponse?.headers()['content-type'] || '').toMatch(/javascript/i);
      expect(scriptResponse?.headers()[SANITIZATION_HEADER]).toBe(SANITIZATION_EVIDENCE);
      expect((await scriptResponse?.body())?.length || 0).toBeGreaterThan(0);
      await expect(page.locator('form[action="/auth/login"], input[name="username"]')).toHaveCount(0);

      const ingest = await page.evaluate(async ({ path, id, runId }) => {
        const response = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: {
            authorization: 'Bearer release-gate-sentinel',
            forwarded: 'for=198.51.100.99;host=evil.example;proto=http',
            'x-forwarded-for': '198.51.100.99',
            'x-forwarded-host': 'evil.example',
            'x-forwarded-proto': 'http',
            'x-ploinky-auth-info': 'release-gate-sentinel',
            'x-ploinky-caller': 'release-gate-sentinel',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            type: 'event',
            payload: {
              website: id,
              hostname: window.location.hostname,
              screen: `${window.screen.width}x${window.screen.height}`,
              language: navigator.language,
              title: 'Ploinky Umami release gate',
              url: `${window.location.origin}/release-gate/${runId}`,
              name: 'ploinky_release_gate',
              data: { runId },
            },
          }),
        });
        return {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          allowOrigin: response.headers.get('access-control-allow-origin') || '',
          sanitization: response.headers.get('x-umami-telemetry-sanitization') || '',
          responseBytes: (await response.arrayBuffer()).byteLength,
        };
      }, { path: `${TELEMETRY_PREFIX}api/send`, id: websiteId, runId: smokeConfig.runId });
      expect([200, 201, 202, 204]).toContain(ingest.status);
      expect(ingest.sanitization).toBe(SANITIZATION_EVIDENCE);
      expect(ingest.allowOrigin).toBe(routerOrigin);
      const cookies = await context.cookies(routerOrigin);
      expect(cookies.some((cookie) => cookie.name === 'ploinky_guest')).toBe(true);
      if (smokeConfig.flags.failOnBrowserErrors) {
        expect(diagnostics.actionableEvents(), 'Umami guest telemetry browser diagnostics').toEqual([]);
      }
      await attachEvidence(testInfo, 'umami-telemetry-sanitization', {
        script: {
          status: scriptResponse.status(),
          contentType: scriptResponse.headers()['content-type'] || '',
          sanitization: scriptResponse.headers()[SANITIZATION_HEADER] || '',
        },
        ingest,
        guestSessionCreated: cookies.some((cookie) => cookie.name === 'ploinky_guest'),
      });
    } finally {
      await diagnostics.flush().catch(() => null);
      await context.close().catch(() => null);
    }
  });
});
