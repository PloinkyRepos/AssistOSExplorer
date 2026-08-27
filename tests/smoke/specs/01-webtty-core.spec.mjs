import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  attachPageDiagnostics,
  expect,
  test,
} from '../lib/fixtures.mjs';
import { readAuthenticatedPrincipal } from '../lib/auth.mjs';
import { smokeConfig } from '../lib/config.mjs';
import { openExplorer } from '../lib/explorer.mjs';

function requireLocalWorkspaceFixture() {
  if (!smokeConfig.workspaceRoot) {
    throw new Error('SMOKE_WORKSPACE_ROOT is required for the WebTTY core release gate.');
  }
  const baseURL = new URL(smokeConfig.baseURL);
  if (baseURL.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseURL.hostname)) {
    throw new Error('The WebTTY core release gate requires a loopback HTTP SMOKE_BASE_URL.');
  }

  const workspaceRoot = fs.realpathSync(smokeConfig.workspaceRoot);
  const fixtureName = `webtty-smoke-${smokeConfig.runId}`;
  const fixtureRoot = path.resolve(workspaceRoot, fixtureName);
  const relativeFixture = path.relative(workspaceRoot, fixtureRoot);
  if (!relativeFixture || relativeFixture.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFixture)) {
    throw new Error('The WebTTY smoke fixture did not resolve beneath SMOKE_WORKSPACE_ROOT.');
  }
  if (fs.existsSync(fixtureRoot)) {
    throw new Error(`The run-scoped WebTTY smoke fixture already exists: ${fixtureName}`);
  }

  const nestedRoot = path.join(fixtureRoot, 'nested-folder');
  fs.mkdirSync(nestedRoot, { recursive: true });
  const hostMarker = `host-${crypto.randomUUID()}`;
  const browserMarker = `browser-${crypto.randomUUID()}`;
  fs.writeFileSync(path.join(nestedRoot, 'host-marker.txt'), `${hostMarker}\n`, { mode: 0o600 });
  return Object.freeze({
    workspaceRoot,
    fixtureRoot,
    fixturePath: `/${fixtureName}`,
    relativeDirectory: `${fixtureName}/nested-folder`,
    nestedRoot,
    hostMarker,
    browserMarker,
  });
}

async function browserMutation(page, pathname, { method = 'POST', body } = {}) {
  return page.evaluate(async ({ requestPath, requestMethod, requestBody }) => {
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('ploinky_browser_csrf='))
      ?.slice('ploinky_browser_csrf='.length) || '';
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Ploinky-Browser-CSRF-Token': csrf,
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    return { status: response.status, payload, text };
  }, { requestPath: pathname, requestMethod: method, requestBody: body });
}

function isSessionCreation(response) {
  const target = new URL(response.url());
  return response.request().method() === 'POST' && target.pathname === '/webtty/sessions';
}

async function readSessionCreation(response) {
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload).toMatchObject({
    ok: true,
    session: {
      id: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/),
    },
  });
  return payload.session;
}

async function waitForConnectedTerminal(page) {
  await expect(page.locator('#status')).toHaveText('Connected', {
    timeout: smokeConfig.timeouts.navigation,
  });
  await expect(page.locator('#terminal .xterm-helper-textarea')).toBeAttached();
}

async function openTerminalFromExplorer(page, directoryPath) {
  const row = page.locator(`tr[data-entry-path="${directoryPath}"]`);
  await expect(row).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
  await row.locator('.action-menu-trigger').click();
  const launcher = row.getByRole('menuitem', { name: 'Open Terminal Here' });
  await expect(launcher).toBeVisible({ timeout: smokeConfig.timeouts.action });

  const context = page.context();
  const popupPromise = context.waitForEvent('page', { timeout: smokeConfig.timeouts.navigation });
  const createPromise = context.waitForEvent('response', {
    predicate: isSessionCreation,
    timeout: smokeConfig.timeouts.navigation,
  });
  await launcher.click();
  const terminalPage = await popupPromise;
  const createResponse = await createPromise;
  await terminalPage.waitForLoadState('load');
  return { terminalPage, session: await readSessionCreation(createResponse) };
}

async function openTerminalDirectly(context, url) {
  const terminalPage = await context.newPage();
  const createPromise = terminalPage.waitForResponse(isSessionCreation, {
    timeout: smokeConfig.timeouts.navigation,
  });
  const navigation = await terminalPage.goto(url, { waitUntil: 'load' });
  expect(navigation?.status()).toBe(200);
  return { terminalPage, session: await readSessionCreation(await createPromise) };
}

test.describe('Ploinky core WebTTY release gate', () => {
  test.skip(!smokeConfig.flags.webttyCore, 'Run with npm run test:webtty.');

  test('local administrator controls the mounted workspace while an ordinary user is denied', async ({ page, browser }, testInfo) => {
    test.setTimeout(Math.max(smokeConfig.timeouts.test, 180_000));
    const fixture = requireLocalWorkspaceFixture();
    const terminals = [];
    let userContext = null;
    try {
      await openExplorer(page);
      const admin = await readAuthenticatedPrincipal(page, smokeConfig.primaryUser);
      expect(admin.canonicalId, 'the gate must exercise the canonical local:admin principal').toBe('local:admin');
      expect(admin.roles).toContain('admin');

      const first = await openTerminalFromExplorer(page, fixture.fixturePath);
      terminals.push(first);
      const firstDiagnostics = attachPageDiagnostics(first.terminalPage, testInfo, 'webtty-first-terminal');
      const firstUrl = new URL(first.terminalPage.url());
      expect(firstUrl.origin).toBe(new URL(smokeConfig.baseURL).origin);
      expect(firstUrl.pathname).toBe('/webtty/');
      expect(firstUrl.searchParams.get('dir')).toBe(fixture.relativeDirectory);
      expect(first.session.cwd).toBe(fixture.relativeDirectory);
      await waitForConnectedTerminal(first.terminalPage);

      const expectedCwd = `/workspace/${fixture.relativeDirectory}`;
      const command = [
        'printf \'__WEBTTY_PWD__%s__\\n\' "$PWD"',
        'printf \'__WEBTTY_HOST__\'',
        'cat -- host-marker.txt',
        'printf \'__WEBTTY_HOST_END__\\n\'',
        `printf '%s\\n' '${fixture.browserMarker}' > browser-marker.txt`,
      ].join('; ') + '\r';
      const input = await browserMutation(
        first.terminalPage,
        `/webtty/sessions/${encodeURIComponent(first.session.id)}/input`,
        { body: { data: command } },
      );
      expect(input).toMatchObject({ status: 200, payload: { ok: true } });
      await expect.poll(() => first.terminalPage.locator('#terminal .xterm-rows').innerText(), {
        message: 'the terminal must report its selected /workspace cwd and read the host marker',
        timeout: smokeConfig.timeouts.navigation,
      }).toContain(`__WEBTTY_PWD__${expectedCwd}__`);
      await expect(first.terminalPage.locator('#terminal .xterm-rows')).toContainText(fixture.hostMarker);
      await expect.poll(() => {
        try {
          return fs.readFileSync(path.join(fixture.nestedRoot, 'browser-marker.txt'), 'utf8').trim();
        } catch {
          return '';
        }
      }, {
        message: 'the terminal-created marker must be visible on the host workspace',
        timeout: smokeConfig.timeouts.navigation,
      }).toBe(fixture.browserMarker);
      expect(firstDiagnostics.actionableEvents(), 'the connected terminal page must have no browser errors').toEqual([]);
      firstDiagnostics.pause();

      const firstClose = await browserMutation(
        first.terminalPage,
        `/webtty/sessions/${encodeURIComponent(first.session.id)}`,
        { method: 'DELETE' },
      );
      expect(firstClose).toMatchObject({ status: 200, payload: { ok: true } });
      await first.terminalPage.close();
      await firstDiagnostics.flush();

      const secondUrl = new URL('/webtty/', smokeConfig.baseURL);
      secondUrl.searchParams.set('dir', fixture.relativeDirectory);
      const second = await openTerminalDirectly(page.context(), secondUrl.toString());
      terminals.push(second);
      const secondDiagnostics = attachPageDiagnostics(second.terminalPage, testInfo, 'webtty-second-terminal');
      await waitForConnectedTerminal(second.terminalPage);
      expect(second.session.cwd).toBe(fixture.relativeDirectory);
      expect(secondDiagnostics.actionableEvents(), 'WebTTY must remain available after normal terminal cleanup').toEqual([]);
      secondDiagnostics.pause();
      const secondClose = await browserMutation(
        second.terminalPage,
        `/webtty/sessions/${encodeURIComponent(second.session.id)}`,
        { method: 'DELETE' },
      );
      expect(secondClose).toMatchObject({ status: 200, payload: { ok: true } });
      await second.terminalPage.close();
      await secondDiagnostics.flush();

      userContext = await browser.newContext({
        baseURL: smokeConfig.baseURL,
        ignoreHTTPSErrors: true,
      });
      const userPage = await userContext.newPage();
      await openExplorer(userPage, { account: smokeConfig.secondaryUser });
      const ordinaryUser = await readAuthenticatedPrincipal(userPage, smokeConfig.secondaryUser);
      expect(ordinaryUser.canonicalId, 'the gate must exercise the canonical local:user principal').toBe('local:user');
      expect(ordinaryUser.roles).not.toContain('admin');
      const userRow = userPage.locator(`tr[data-entry-path="${fixture.fixturePath}"]`);
      await expect(userRow).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
      await userRow.locator('.action-menu-trigger').click();
      await expect(userRow.getByRole('menuitem', { name: 'Open Terminal Here' })).toHaveCount(0);

      const directResponse = await userPage.goto(secondUrl.toString(), { waitUntil: 'load' });
      expect(directResponse?.status()).toBe(403);
      await expect(userPage.locator('body')).toContainText('administrator_required');
      const deniedCreation = await browserMutation(userPage, '/webtty/sessions', {
        body: { dir: fixture.relativeDirectory, cols: 80, rows: 24 },
      });
      expect(deniedCreation).toMatchObject({
        status: 403,
        payload: { ok: false, error: 'administrator_required' },
      });

      await testInfo.attach('webtty-core-evidence.json', {
        body: Buffer.from(JSON.stringify({
          origin: firstUrl.origin,
          relativeDirectory: fixture.relativeDirectory,
          initialCwd: first.session.cwd,
          hostMarkerRead: true,
          hostMarkerWritten: true,
          normalCloseKeptWebttyAvailable: true,
          ordinaryUserMenuItemVisible: false,
          ordinaryUserPageStatus: directResponse.status(),
          ordinaryUserCreationStatus: deniedCreation.status,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await userContext?.close().catch(() => {});
      for (const terminal of terminals.reverse()) {
        if (!terminal.terminalPage.isClosed()) {
          await browserMutation(
            terminal.terminalPage,
            `/webtty/sessions/${encodeURIComponent(terminal.session.id)}`,
            { method: 'DELETE' },
          ).catch(() => {});
          await terminal.terminalPage.close().catch(() => {});
        }
      }
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  });
});
