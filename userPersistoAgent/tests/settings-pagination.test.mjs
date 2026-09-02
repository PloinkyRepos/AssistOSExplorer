import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../IDE-plugins/userpersisto-settings/userpersisto-settings.js', import.meta.url), 'utf8');
const { UserpersistoSettings } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(/^import[\s\S]*?;\s*/, '')).toString('base64')}`);

test('settings can navigate beyond 100 users and update a role on the last page', async () => {
    const users = Array.from({ length: 201 }, (_, index) => ({ id: `user-${index}`, email: `user${index}@example.test`, roles: ['user'] }));
    const panel = new UserpersistoSettings({}, () => {});
    panel.renderUsers = () => {};
    panel.usersPreviousButton = {};
    panel.usersNextButton = {};
    panel.usersPageLabel = {};
    panel.userSearchInput = { value: '' };
    const calls = [];
    panel.callTool = async (name, args) => {
        calls.push({ name, args });
        if (name === 'userpersisto_user_roles_update') {
            users.find((user) => user.id === args.userId).roles = args.roles;
            return {};
        }
        return { users: users.slice(args.start, args.start + args.pageSize), totalCount: users.length };
    };
    await panel.refreshUsers();
    assert.equal(panel.state.users[0].id, 'user-0');
    assert.equal(panel.usersPreviousButton.disabled, true);
    assert.equal(panel.usersNextButton.disabled, false);
    await panel.nextUsersPage();
    assert.equal(panel.state.users[0].id, 'user-100');
    await panel.nextUsersPage();
    assert.equal(panel.state.users[0].id, 'user-200');
    assert.equal(panel.usersNextButton.disabled, true);
    assert.equal(panel.usersPageLabel.textContent, '201–201 of 201 users');
    await panel.changeUserRole({ value: 'selfRegistered' }, 'user-200');
    assert.deepEqual(panel.state.users[0].roles, ['selfRegistered']);
    assert.equal(panel.state.usersStart, 200);
    panel.userSearchInput.value = 'user200';
    assert.equal(panel.filteredUsers()[0].id, 'user-200');
    await panel.previousUsersPage();
    assert.equal(panel.state.usersStart, 100);
    assert.ok(calls.some((call) => call.name === 'userpersisto_user_roles_update' && call.args.userId === 'user-200'));
});

test('page load failure preserves the previous users and restores navigation', async () => {
    const panel = new UserpersistoSettings({}, () => {});
    panel.state.users = [{ id: 'existing' }];
    panel.state.usersTotal = 101;
    panel.renderUsers = () => {};
    panel.usersNextButton = {};
    panel.callTool = async () => { throw new Error('provider unavailable'); };
    await panel.nextUsersPage();
    assert.equal(panel.state.usersStart, 0);
    assert.equal(panel.state.users[0].id, 'existing');
    assert.equal(panel.state.usersLoading, false);
    assert.equal(panel.usersNextButton.disabled, false);
    assert.equal(panel.state.statusType, 'error');
});
