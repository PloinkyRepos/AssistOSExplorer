import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { chromium } from '@playwright/test';

test('authentication visits only its final surface and preserves a separate service login', { timeout: 30_000 }, async () => {
  const requests = [];
  const account = { username: 'fixture-user', password: 'fixture-password' };
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
      response.end('<h1>Service</h1><form action="/service/login" method="post"><input name="username"><input name="password" type="password"><button type="submit">Service login</button></form>');
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
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const principal = await signIn(page, account, '/service/', { requireConfiguredPrincipal: true });
    assert.equal(principal.canonicalUsername, account.username);
    assert.equal(new URL(page.url()).pathname, '/service/');
    assert.equal(requests.filter((entry) => entry.pathname === '/service/').length, 1,
      'the target must not boot before login or be reloaded after login');
    assert.deepEqual(requests.filter((entry) => entry.pathname === '/auth/login').map((entry) => entry.method), ['GET', 'POST']);
    assert.equal(requests.filter((entry) => entry.pathname === '/' || entry.pathname.startsWith('/explorer')).length, 0);
    assert.equal(await page.locator('input[name="username"]').inputValue(), '');
    assert.equal(await page.locator('input[name="password"]').inputValue(), '');

    await signIn(page, account, '/service/', { requireConfiguredPrincipal: true });
    assert.equal(requests.filter((entry) => entry.pathname === '/service/').length, 2);
    assert.equal(requests.filter((entry) => entry.pathname === '/auth/login').length, 2,
      'an existing Router session must not revisit its login form');
    assert.equal(requests.filter((entry) => entry.pathname === '/service/login').length, 0,
      'Ploinky credentials must never be submitted to the service login');
    assert.equal(await page.locator('input[name="username"]').inputValue(), '');
    assert.equal(await page.locator('input[name="password"]').inputValue(), '');
    await assert.rejects(signIn(page, { ...account, username: 'another-user' }, '/service/', {
      requireConfiguredPrincipal: true,
    }), /does not match the configured account/);
    await context.close();
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
