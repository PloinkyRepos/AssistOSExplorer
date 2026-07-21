import { expect } from './fixtures.mjs';
import { smokeConfig } from './config.mjs';

function loginForm(page) {
  return page.locator('form[action="/auth/login"], input#username, input[name="username"]').first();
}

export async function signIn(page, account = smokeConfig.primaryUser, returnTo = '/dashboard') {
  await page.goto(returnTo, { waitUntil: 'domcontentloaded' });

  const session = await page.request.get('/dashboard/whoami').then((response) => response.json()).catch(() => null);
  if (!session?.ok && !(await loginForm(page).isVisible({ timeout: 1_000 }).catch(() => false))) {
    const params = new URLSearchParams({
      agent: smokeConfig.authAgent,
      returnTo,
    });
    await page.goto(`/auth/login?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  }

  if (await loginForm(page).isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.locator('input#username, input[name="username"]').first().fill(account.username);
    await page.locator('input#password, input[name="password"]').first().fill(account.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
      page.locator('form[action="/auth/login"] button[type="submit"], button[type="submit"], .auth-btn').first().click(),
    ]);
  }

  await expect(page.locator('body')).not.toContainText(/Invalid username or password|Local auth is not configured/i);
  if (new URL(page.url()).pathname === '/auth/login') {
    throw new Error(`Login did not leave /auth/login for ${account.username}.`);
  }
}

export async function trySignIn(page, account = smokeConfig.primaryUser, returnTo = '/dashboard') {
  try {
    await signIn(page, account, returnTo);
    return true;
  } catch (_) {
    return false;
  }
}
