import { expect } from '@playwright/test';

import { smokeConfig } from './config.mjs';
import { openExplorer } from './explorer.mjs';

function escapeCssAttributeValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function userRow(dialog, username) {
  const escapedUsername = escapeCssAttributeValue(username);
  return dialog.locator(
    `tr[data-user-id]:has(input[data-field="username"][value="${escapedUsername}"])`
  );
}

async function expectDropdownAnchored(trigger, optionsList) {
  const [triggerBox, optionsBox] = await Promise.all([
    trigger.boundingBox(),
    optionsList.boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();

  const tolerance = 2;
  expect(Math.abs(optionsBox.x - triggerBox.x)).toBeLessThanOrEqual(tolerance);
  const opensBelow = Math.abs(optionsBox.y - (triggerBox.y + triggerBox.height + 4)) <= tolerance;
  const opensAbove = Math.abs((optionsBox.y + optionsBox.height + 4) - triggerBox.y) <= tolerance;
  expect(opensBelow || opensAbove).toBe(true);
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

export async function createUserThroughAdministration(dialog, account, { name, role = 'user' }) {
  const form = dialog.locator('admin-users-settings form[data-role="createForm"]');
  await form.locator('input[name="username"]').fill(account.username);
  await form.locator('input[name="password"]').fill(account.password);
  await form.locator('input[name="name"]').fill(name);

  const roles = form.locator('custom-select[data-role="createRolesSelect"]');
  const currentRole = roles.locator('.current-option');
  await expect(currentRole).not.toHaveText('');
  if ((await currentRole.innerText()).trim().toLowerCase() !== role.toLowerCase()) {
    const trigger = roles.locator('.custom-select');
    const optionsList = roles.locator('.custom-select-options-list');
    await trigger.click();
    const roleOption = roles.locator(
      `button.option[data-value="${escapeCssAttributeValue(role)}"]`
    );
    await expect(roleOption).toBeVisible();
    await expectDropdownAnchored(trigger, optionsList);
    await roleOption.click();
  }
  await expect(currentRole).toHaveText(role);
  await form.getByRole('button', { name: 'Add User' }).click();

  const row = userRow(dialog, account.username);
  await expect(row).toHaveCount(1, { timeout: smokeConfig.timeouts.navigation });
  await expect(row.locator('input[data-field="username"]')).toHaveValue(account.username);
  await expect(row.locator('custom-select[data-field="roles"] .current-option')).toHaveText(role);
  return row.getAttribute('data-user-id');
}

export async function deleteUserThroughAdministrationIfPresent(dialog, username) {
  const row = userRow(dialog, username);
  if (await row.count() === 0) return false;
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0, { timeout: smokeConfig.timeouts.navigation });
  return true;
}
