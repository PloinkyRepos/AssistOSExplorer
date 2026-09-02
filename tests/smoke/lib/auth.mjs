import { expect } from './fixtures.mjs';
import { smokeConfig } from './config.mjs';
import { getWithoutKeepAlive } from './api-probe.mjs';

function loginForm(page) {
  return page.locator('form[action="/auth/login"], input#username, input[name="username"]').first();
}

export function normalizePrincipalComponent(value, name = 'authenticated principal component') {
  const normalized = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!normalized) throw new Error(`${name} is unavailable.`);
  return normalized;
}

export function validateAuthenticatedPrincipal(user, { expectedUsername } = {}) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('The authenticated identity endpoint returned no user principal.');
  }
  const canonicalId = normalizePrincipalComponent(user.id, 'authenticated principal id');
  const canonicalUsername = normalizePrincipalComponent(user.username, 'authenticated principal username');
  const roles = Array.isArray(user.roles)
    ? user.roles.map((role) => normalizePrincipalComponent(role, 'authenticated principal role'))
    : [];
  if (roles.includes('guest') || canonicalId === 'guest' || canonicalId.startsWith('guest:')) {
    throw new Error('The authenticated identity endpoint returned a guest principal.');
  }
  if (expectedUsername !== undefined && canonicalUsername !== normalizePrincipalComponent(expectedUsername, 'configured account username')) {
    throw new Error('The authenticated principal does not match the configured account username.');
  }
  return Object.freeze({ canonicalId, canonicalUsername, roles: Object.freeze(roles) });
}

export function assertDistinctAuthenticatedPrincipals(left, right) {
  const first = validateAuthenticatedPrincipal({
    id: left?.canonicalId,
    username: left?.canonicalUsername,
    roles: left?.roles,
  });
  const second = validateAuthenticatedPrincipal({
    id: right?.canonicalId,
    username: right?.canonicalUsername,
    roles: right?.roles,
  });
  if (first.canonicalId === second.canonicalId || first.canonicalUsername === second.canonicalUsername) {
    throw new Error('WebMeet release gates require two distinct authenticated principals.');
  }
  return Object.freeze([first, second]);
}

export async function readAuthenticatedPrincipal(page, account) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/auth/token', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { ok: false, status: response.status, user: null };
    const payload = await response.json().catch(() => null);
    return {
      ok: true,
      status: response.status,
      user: payload?.user && typeof payload.user === 'object'
        ? {
            id: payload.user.id,
            username: payload.user.username,
            roles: payload.user.roles,
          }
        : null,
    };
  });
  if (!result?.ok) {
    throw new Error(`Authenticated identity verification failed with HTTP ${Number(result?.status || 0) || 'unknown'}.`);
  }
  return validateAuthenticatedPrincipal(result.user, { expectedUsername: account?.username });
}

export async function hasAuthenticatedSession(request) {
  const response = await getWithoutKeepAlive(request, '/auth/token').catch(() => null);
  return Boolean(response?.ok());
}

export async function signIn(
  page,
  account = smokeConfig.primaryUser,
  returnTo = '/dashboard',
  { requireConfiguredPrincipal = false } = {},
) {
  await page.goto(returnTo, { waitUntil: 'load' });

  const sessionOk = await hasAuthenticatedSession(page.request);
  if (!sessionOk && !(await loginForm(page).isVisible({ timeout: 1_000 }).catch(() => false))) {
    const params = new URLSearchParams({
      agent: smokeConfig.authAgent,
      returnTo,
    });
    await page.goto(`/auth/login?${params.toString()}`, { waitUntil: 'load' });
  }

  if (await loginForm(page).isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.locator('input#username, input[name="username"]').first().fill(account.username);
    await page.locator('input#password, input[name="password"]').first().fill(account.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }).catch(() => null),
      page.locator('form[action="/auth/login"] button[type="submit"], button[type="submit"], .auth-btn').first().click(),
    ]);
  }

  await page.waitForLoadState('load');
  await expect(page.locator('body')).not.toContainText(/Invalid username or password|Local auth is not configured/i);
  if (new URL(page.url()).pathname === '/auth/login') {
    throw new Error(`Login did not leave /auth/login for ${account.username}.`);
  }
  return readAuthenticatedPrincipal(page, requireConfiguredPrincipal ? account : undefined);
}

export async function trySignIn(page, account = smokeConfig.primaryUser, returnTo = '/dashboard') {
  try {
    await signIn(page, account, returnTo);
    return true;
  } catch (_) {
    return false;
  }
}
