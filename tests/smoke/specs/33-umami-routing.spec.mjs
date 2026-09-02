import { signIn } from '../lib/auth.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { expect, test } from '../lib/fixtures.mjs';
import { findSecretLeaks } from '../lib/security.mjs';

const DASHBOARD_PREFIX = '/base-agent-additional-server/umamiAgent/3000/';

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

    const requests = [];
    const documentResponses = [];
    let authenticating = true;
    page.on('request', (request) => {
      const url = new URL(request.url());
      // Router login and the helper's principal check are not Umami requests.
      if (authenticating && url.origin === routerOrigin
        && ((url.pathname === '/auth/login' && ['GET', 'POST'].includes(request.method()))
          || (url.pathname === '/auth/token' && request.method() === 'GET'))) return;
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
      });
    });
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()
        && new URL(response.url()).pathname.startsWith(DASHBOARD_PREFIX)) documentResponses.push(response);
    });

    await signIn(page, smokeConfig.primaryUser, DASHBOARD_PREFIX);
    authenticating = false;
    const response = documentResponses.at(-1);
    expect(response, 'Umami navigation must produce its document response').toBeTruthy();
    expect(response?.status(), 'Umami dashboard HTML response').toBeLessThan(400);
    expect(new URL(page.url()).pathname.startsWith(DASHBOARD_PREFIX)).toBe(true);

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
    }).toMatch(/^\/base-agent-additional-server\/umamiAgent\/3000\//);

    const sameOriginRequests = requests.filter((entry) => new URL(entry.url).origin === routerOrigin);
    expect(sameOriginRequests.length, 'Umami must issue same-origin Router requests').toBeGreaterThan(1);
    expect(
      sameOriginRequests.filter((entry) => ['script', 'stylesheet', 'font', 'image'].includes(entry.resourceType)).length,
      'Umami must load at least one browser asset through the base path',
    ).toBeGreaterThan(0);
    for (const entry of sameOriginRequests) {
      expect(new URL(entry.url).pathname.startsWith(DASHBOARD_PREFIX), `root-relative Umami request leaked: ${entry.url}`).toBe(true);
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
      expect(pathname.startsWith(DASHBOARD_PREFIX), `root-relative Umami DOM URL leaked: ${url}`).toBe(true);
    }

    await attachEvidence(testInfo, 'umami-dashboard-routing', {
      finalUrl: urlEvidence(page.url()),
      api,
      requests: requests.map((entry) => ({ ...urlEvidence(entry.url), method: entry.method, resourceType: entry.resourceType })),
    });
  });

});
