import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from '@playwright/test';

test('authentication visits only its final surface and preserves a separate service login', { timeout: 60_000 }, async (t) => {
  const requests = [];
  const localAccount = { username: 'fixture-user', password: 'fixture-password' };
  const providerAccount = { username: 'fixture-user@example.test', password: 'fixture-password' };
  const providerPath = '/base-agent-additional-server/userPersistoAgent/7000/service/auth/';
  const providerAssets = new Map(['index.html', 'main.js', 'auth-api.js', 'auth.css'].map((name) => [
    name,
    fs.readFileSync(new URL(`../../../userPersistoAgent/public/auth/${name}`, import.meta.url)),
  ]));
  let account = localAccount;
  let sso = false;
  let redirectDelay = 0;
  let loginPath = providerPath;
  let loginOrigin = '';
  let needsInitialAdmin = false;
  let returnTo = '';
  const server = http.createServer(async (incoming, response) => {
    const url = new URL(incoming.url, 'http://fixture.invalid');
    requests.push({ method: incoming.method, pathname: url.pathname });
    if (url.pathname === '/auth/token') {
      const authenticated = incoming.headers.cookie?.includes('fixture-session=authenticated');
      response.writeHead(authenticated ? 200 : 401, { 'content-type': 'application/json' });
      response.end(JSON.stringify(authenticated
        ? { user: { id: 'local:fixture-user', username: account.username, roles: ['user'] } }
        : { error: 'unauthenticated' }));
      return;
    }
    if (url.pathname === '/auth/login' && incoming.method === 'GET' && sso) {
      returnTo = url.searchParams.get('returnTo');
      const destination = `${loginOrigin}${loginPath}?requestId=fixture-state&state=fixture-state`;
      if (redirectDelay) {
        response.setHeader('content-type', 'text/html');
        response.end(`<h1>Continue to sign in</h1><script>window.setTimeout(() => window.location.replace(${JSON.stringify(destination)}), ${redirectDelay});</script>`);
      } else {
        response.writeHead(302, { location: destination });
        response.end();
      }
      return;
    }
    if (url.pathname.startsWith(loginPath) && sso) {
      const relativePath = url.pathname.slice(loginPath.length);
      if (relativePath === 'methods' || relativePath === 'setup') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(relativePath === 'methods'
          ? { ok: true, methods: ['password'], defaultMethod: 'password' }
          : { ok: true, needsInitialAdmin, selfRegistrationEnabled: true }));
        return;
      }
      if (relativePath === 'password/login' && incoming.method === 'POST') {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        if (payload.email !== account.username || payload.password !== account.password
          || payload.requestId !== 'fixture-state' || payload.state !== 'fixture-state') {
          response.writeHead(401, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: 'authentication_failed' }));
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: true, code: 'fixture-code', state: payload.state, redirectUri: '/auth/callback' }));
        return;
      }
      const asset = providerAssets.get(relativePath || 'index.html');
      if (asset) {
        response.setHeader('content-type', relativePath.endsWith('.js') ? 'text/javascript'
          : relativePath.endsWith('.css') ? 'text/css' : 'text/html');
        response.end(asset);
        return;
      }
    }
    if (url.pathname === '/auth/callback' && sso) {
      if (url.searchParams.get('state') !== 'fixture-state' || url.searchParams.get('code') !== 'fixture-code') {
        response.writeHead(401).end('Invalid callback');
        return;
      }
      response.writeHead(303, { location: returnTo, 'set-cookie': 'fixture-session=authenticated; Path=/; HttpOnly' });
      response.end();
      return;
    }
    if (url.pathname === '/auth/login' && incoming.method === 'POST') {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      if (form.get('username') !== account.username || form.get('password') !== account.password) {
        response.writeHead(401).end('Invalid username or password');
        return;
      }
      response.writeHead(303, { location: form.get('returnTo'), 'set-cookie': 'fixture-session=authenticated; Path=/; HttpOnly' });
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/html');
    if (url.pathname === '/auth/login') {
      response.end(`<form action="/auth/login" method="post"><input name="username"><input name="password" type="password"><input name="returnTo" type="hidden" value="${url.searchParams.get('returnTo')}"><button type="submit">Sign in</button></form>`);
      return;
    }
    if (url.pathname === '/service/') {
      response.end('<h1>Service</h1><form class="password-panel" action="/service/login" method="post"><input name="username"><input name="email"><input name="password" type="password"><button type="submit">Service login</button></form>');
      return;
    }
    response.writeHead(404).end('Unexpected intermediate surface');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  process.env.SMOKE_BASE_URL = baseURL;
  const { signIn } = await import('./auth.mjs');
  let browser;
  try {
    browser = await chromium.launch();
    for (const mode of ['local', 'immediate SSO', 'delayed frontend SSO']) {
      const useSso = mode !== 'local';
      await t.test(`${mode} sign-in`, async () => {
        sso = useSso;
        redirectDelay = mode === 'delayed frontend SSO' ? 250 : 0;
        account = useSso ? providerAccount : localAccount;
        requests.length = 0;
        const context = await browser.newContext({ baseURL });
        const page = await context.newPage();
        try {
          const target = '/service/?source=smoke#requested-tab';
          const principal = await signIn(page, account, target, { requireConfiguredPrincipal: true });
          assert.equal(principal.canonicalUsername, account.username);
          assert.equal(page.url(), `${baseURL}${target}`);
          assert.equal(requests.filter((entry) => entry.pathname === '/service/').length, 1,
            'the target must not boot before login or be reloaded after login');
          assert.deepEqual(requests.filter((entry) => entry.pathname === '/auth/login').map((entry) => entry.method), useSso ? ['GET'] : ['GET', 'POST']);
          if (useSso) {
            assert.equal(requests.filter((entry) => entry.pathname === `${providerPath}password/login`).length, 1);
            assert.equal(requests.filter((entry) => entry.pathname === `${providerPath}register`).length, 0,
              'sign-in must never submit the adjacent registration form');
          }
          assert.equal(requests.filter((entry) => entry.pathname === '/' || entry.pathname.startsWith('/explorer')).length, 0);
          assert.equal(await page.locator('input[name="username"]').inputValue(), '');
          assert.equal(await page.locator('input[name="password"]').inputValue(), '');

          await signIn(page, account, '/service/?source=second#requested-tab', { requireConfiguredPrincipal: true });
          assert.equal(requests.filter((entry) => entry.pathname === '/service/').length, 2);
          assert.equal(requests.filter((entry) => entry.pathname === '/auth/login').length, useSso ? 1 : 2,
            'an existing Router session must not revisit its login form');
          assert.equal(requests.filter((entry) => entry.pathname === '/service/login').length, 0,
            'Ploinky credentials must never be submitted to the service login');
          assert.equal(await page.locator('input[name="username"]').inputValue(), '');
          assert.equal(await page.locator('input[name="email"]').inputValue(), '');
          assert.equal(await page.locator('input[name="password"]').inputValue(), '');
          await assert.rejects(signIn(page, { ...account, username: 'another-user' }, '/service/', {
            requireConfiguredPrincipal: true,
          }), /does not match the configured account/);
        } finally {
          await context.close();
        }
      });
    }
    for (const scenario of ['initial setup', 'different same-origin path', 'different origin']) {
      for (const delay of [0, 250]) {
        await t.test(`does not submit credentials to ${scenario} after ${delay ? 'delayed frontend' : 'immediate'} SSO`, async () => {
          sso = true;
          redirectDelay = delay;
          account = providerAccount;
          needsInitialAdmin = scenario === 'initial setup';
          loginPath = scenario === 'different same-origin path' ? '/other-service/auth/' : providerPath;
          loginOrigin = scenario === 'different origin' ? baseURL.replace('127.0.0.1', 'localhost') : '';
          requests.length = 0;
          const context = await browser.newContext({ baseURL });
          const page = await context.newPage();
          try {
            const expectedError = scenario === 'initial setup'
              ? /UserPersisto password sign-in is unavailable/
              : scenario === 'different origin'
                ? /Authentication left the configured smoke origin/
                : /Authenticated identity verification failed with HTTP 401/;
            await assert.rejects(signIn(page, account, '/service/', { requireConfiguredPrincipal: true }), expectedError);
            await page.locator('#auth_content form').first().waitFor({ state: 'visible' });
            assert.equal(requests.filter((entry) => entry.method === 'POST').length, 0);
            for (const input of await page.locator('input[name="email"], input[name="password"]').all()) {
              assert.equal(await input.inputValue(), '');
            }
          } finally {
            await context.close();
          }
        });
      }
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
