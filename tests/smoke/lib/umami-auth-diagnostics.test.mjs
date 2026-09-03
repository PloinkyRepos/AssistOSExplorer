import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';

import { attachPageDiagnostics, expect } from './fixtures.mjs';
import { beginUmamiSignedOutProof, verifyUmamiBrowserAuthorization } from './umami-auth-diagnostics.mjs';

const basePath = '/base-agent-additional-server/umamiAgent/3000';
const verifyPath = `${basePath}/api/auth/verify`;
const denial = { error: { message: 'Unauthorized', code: 'unauthorized', status: 401 } };
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function withSignedOutPage(options, run) {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url === verifyPath) {
      const authorized = request.headers.authorization === 'Bearer fixture-secret-token';
      requests.push({ method: request.method, authorized });
      response.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(authorized
        ? { id: 'fixture-id', username: 'fixture-user', role: 'admin', isAdmin: true, teams: [] }
        : options.body || denial));
      return;
    }
    if (request.url === `${basePath}/rsc`) {
      response.writeHead(200, { 'Content-Type': 'text/x-component', 'Content-Length': '10000' });
      response.write('partial component stream');
      return;
    }
    if (request.url === `${basePath}/login`) {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><title>Authorization fixture</title><script>
        (async () => {
          const method = ${JSON.stringify(options.method || 'POST')};
          await (await fetch(${JSON.stringify(verifyPath)}, { method })).json();
          ${options.extraDenial ? `await (await fetch(${JSON.stringify(verifyPath)}, { method: 'POST' })).json();` : ''}
          ${options.cancelRsc ? `await (await fetch(${JSON.stringify(`${basePath}/rsc`)})).body.cancel();` : ''}
          window.signedOutDone = true;
        })();
      </script>`);
      return;
    }
    response.writeHead(204).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = attachPageDiagnostics(page, {}, 'umami-fixture');
  const proof = beginUmamiSignedOutProof(page, { verifyUrl: `${origin}${verifyPath}`, timeout: 1_000 });
  try {
    await page.goto(`${origin}${basePath}/login`);
    await page.waitForFunction(() => window.signedOutDone === true);
    await run({ page, diagnostics, proof, requests });
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the completed signed-out denial is explicit, retained, and cannot excuse later failures', async () => {
  await withSignedOutPage({}, async ({ page, diagnostics, proof, requests }) => {
    assert.deepEqual(await proof(), { signedOutVerifications: 1, status: 401, completed: true });
    assert.equal(diagnostics.events.filter((event) => event.type === 'error').length, 2);
    assert.deepEqual(diagnostics.actionableEvents(), []);
    assert.deepEqual(requests, [{ method: 'POST', authorized: false }]);
    await page.evaluate(async (path) => (await fetch(path, { method: 'POST' })).json(), verifyPath);
    await expect.poll(() => diagnostics.actionableEvents().length).toBe(2);
    assert.deepEqual(diagnostics.actionableEvents().map(({ kind }) => kind).sort(), ['console', 'response']);
  });
});

test('wrong denial method, substituted body, and extra denials cannot be acknowledged', async () => {
  for (const options of [
    { method: 'GET' },
    { body: { error: { message: 'fixture-private-body-sentinel', code: 'unauthorized', status: 401 } } },
    { extraDenial: true },
  ]) {
    await withSignedOutPage(options, async ({ diagnostics, proof }) => {
      await assert.rejects(proof, (error) => {
        assert.equal(String(error).includes('fixture-private-body-sentinel'), false);
        return true;
      });
      assert.ok(diagnostics.actionableEvents().length >= 2);
    });
  }
});

test('a real cancelled RSC stream remains fatal in the prelogin checkpoint', async () => {
  await withSignedOutPage({ cancelRsc: true }, async ({ diagnostics, proof }) => {
    await expect.poll(() => diagnostics.events.some((event) => event.kind === 'requestfailed')).toBe(true);
    await assert.rejects(proof, /unexpected diagnostic event multiset/);
    assert.ok(diagnostics.actionableEvents().some((event) => event.kind === 'requestfailed'
      && event.failure === 'net::ERR_ABORTED'));
  });
});

test('positive verification consumes the existing browser token without exposing or changing it', async () => {
  await withSignedOutPage({}, async ({ page, proof, requests }) => {
    await proof();
    await page.evaluate(() => localStorage.setItem('umami.auth', JSON.stringify('fixture-secret-token')));
    const verification = await verifyUmamiBrowserAuthorization(page, {
      path: verifyPath,
      expectedUsername: 'fixture-user',
    });
    assert.deepEqual(verification, { hasToken: true, status: 200, validUser: true });
    assert.equal(JSON.stringify(verification).includes('fixture-secret-token'), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('umami.auth') === JSON.stringify('fixture-secret-token')), true);
    assert.deepEqual(requests.at(-1), { method: 'POST', authorized: true });
    const wrongPrincipal = await verifyUmamiBrowserAuthorization(page, {
      path: verifyPath,
      expectedUsername: 'another-user',
    });
    assert.deepEqual(wrongPrincipal, { hasToken: true, status: 200, validUser: false });
    await page.evaluate(() => localStorage.setItem('umami.auth', 'malformed-private-token-sentinel'));
    assert.deepEqual(await verifyUmamiBrowserAuthorization(page, {
      path: verifyPath,
      expectedUsername: 'fixture-user',
    }), { hasToken: false });
  });
});
