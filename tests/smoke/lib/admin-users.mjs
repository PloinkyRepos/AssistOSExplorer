import { expect } from '@playwright/test';

import { smokeConfig } from './config.mjs';
import { openExplorer } from './explorer.mjs';

function userRow(dialog, username) {
  return dialog
    .locator('tr[data-user-id]')
    .filter({ has: dialog.getByDisplayValue(username, { exact: true }) });
}

export async function openAdminUsers(page) {
  await openExplorer(page, { account: smokeConfig.primaryUser });
  await page.locator('#accountMenuButton').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();

  const dialog = page.locator('dialog.settings-modal-dialog');
  await expect(dialog).toBeVisible({ timeout: smokeConfig.timeouts.navigation });
  const administrationTab = dialog.getByRole('tab', { name: 'Administration' });
  await expect(administrationTab).toBeVisible({ timeout: smokeConfig.timeouts.navigation });
  await administrationTab.click();

  const form = dialog.locator('admin-users-settings form[data-role="createForm"]');
  await expect(form).toBeVisible({ timeout: smokeConfig.timeouts.navigation });
  await expect(dialog.locator('admin-settings-panel [data-role="status"]')).toContainText(
    /\d+ users? loaded\./i,
    { timeout: smokeConfig.timeouts.navigation }
  );
  return dialog;
}

export async function createUserThroughAdministration(dialog, account, { name }) {
  const form = dialog.locator('admin-users-settings form[data-role="createForm"]');
  await form.locator('input[name="username"]').fill(account.username);
  await form.locator('input[name="password"]').fill(account.password);
  await form.locator('input[name="name"]').fill(name);

  const roles = form.locator('custom-select[data-role="createRolesSelect"]');
  await expect(roles.locator('.current-option')).not.toHaveText('');
  await roles.locator('.custom-select').click();
  await roles.getByRole('option', { name: /^user$/i }).click();
  await form.getByRole('button', { name: 'Add User' }).click();

  const row = userRow(dialog, account.username);
  await expect(row).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
  await expect(row.locator('input[data-field="username"]')).toHaveValue(account.username);
  return row.getAttribute('data-user-id');
}

export async function deleteUserThroughAdministrationIfPresent(dialog, username) {
  const row = userRow(dialog, username);
  if (await row.count() === 0) return false;
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0, { timeout: smokeConfig.timeouts.navigation });
  return true;
}
