import { expect } from './fixtures.mjs';
import { smokeConfig } from './config.mjs';

function loginForm(page) {
  return page.locator('form[action="/auth/login"], input#username, input[name="username"]').first();
}

export async function signIn(page, account = smokeConfig.primaryUser, returnTo = '/dashboard') {
  await page.goto(returnTo, { waitUntil: 'domcontentloaded' });

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
