import { expect } from './fixtures.mjs';
import { signIn } from './auth.mjs';
import { smokeConfig } from './config.mjs';

export async function openDashboard(page, account = smokeConfig.primaryUser) {
  await signIn(page, account, '/dashboard');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/API Route not found|Unexpected token/i);
}

export function explorerUrl(
  hash = '',
  { qaAcceptance = smokeConfig.flags.qaAcceptance } = {},
) {
  const suffix = hash ? `#${String(hash).replace(/^#/, '')}` : '';
  const pathname = qaAcceptance ? '/' : '/explorer/index.html';
  return `${pathname}${suffix}`;
}

export async function navigateToExplorer(
  page,
  {
    account = smokeConfig.primaryUser,
    hash = '',
  } = {},
  signInFn = signIn,
) {
  await signInFn(page, account, explorerUrl(hash));
}

export async function openExplorer(page, options = {}) {
  const {
    account = smokeConfig.primaryUser,
    hash = '',
  } = options;
  await navigateToExplorer(page, { account, hash });
  await expect(page.locator('#page_content')).toBeVisible();
  await page.waitForFunction(() => {
    return Boolean(window.webSkel && document.querySelector('#page_content')?.children.length);
  }, null, { timeout: smokeConfig.timeouts.navigation });
  await expect(page.locator('#before_webskel_loader')).toHaveCount(0);
}

export async function assertExplorerDirectory(page, expectedPath) {
  const normalizedPath = `/${String(expectedPath || '').split('/').filter(Boolean).join('/')}`;
  const expectedBreadcrumbs = [
    '/',
    ...normalizedPath.split('/').filter(Boolean).map((segment) => `${segment} /`),
  ];

  await expect.poll(async () => page.locator('file-exp').evaluate((element) => (
    element.webSkelPresenter?.state?.path || null
  )), {
    timeout: smokeConfig.timeouts.navigation,
    message: `Explorer should activate directory ${normalizedPath}`,
  }).toBe(normalizedPath);
  await expect(page.locator('#breadcrumbs')).toBeVisible();
  await expect.poll(async () => page.locator('#breadcrumbs button').allTextContents(), {
    timeout: smokeConfig.timeouts.navigation,
    message: `Explorer breadcrumbs should visibly represent ${normalizedPath}`,
  }).toEqual(expectedBreadcrumbs);
}

export async function assertExplorerHealthy(page) {
  await expect(page.locator('#page_content')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Explorer failed to load|API Route not found/i);
}
