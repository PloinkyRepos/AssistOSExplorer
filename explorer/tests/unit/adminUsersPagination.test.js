import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminSettingsPanel } from '../../web-components/components/admin-settings-panel/admin-settings-panel.js';
import { AdminUsersSettings } from '../../web-components/components/admin-users-settings/admin-users-settings.js';

test('administration page controls can reach and edit users beyond the old 500-user boundary', async () => {
    const users = Array.from({ length: 601 }, (_, index) => ({ id: `user-${index}`, username: `user-${index}`, roles: ['user'] }));
    const panel = new AdminSettingsPanel({ getAttribute: () => null }, () => {});
    const child = new AdminUsersSettings({}, () => {});
    child.renderUsers = () => {};
    child.previousButton = {};
    child.nextButton = {};
    child.pageLabel = {};
    child.dispatch = (_event, detail) => panel.loadUsersPage(detail.start);
    panel.usersComponent = { webSkelPresenter: child };
    const mutations = [];
    panel.request = async (url, options = {}) => {
        if (options.method === 'PATCH') { mutations.push({ url, body: JSON.parse(options.body) }); return { ok: true }; }
        if (options.method === 'DELETE') { users.splice(users.findIndex((user) => url.endsWith(`/${user.id}`)), 1); return { ok: true }; }
        assert.ok(url.startsWith(panel.apiBase), 'administration must only load the provider-backed users API');
        const params = new URL(url, 'http://localhost').searchParams;
        const start = Number(params.get('start'));
        const pageSize = Number(params.get('pageSize'));
        return { users: users.slice(start, start + pageSize), start, pageSize, totalCount: users.length, hasMore: start + pageSize < users.length, availableRoles: ['admin', 'user'] };
    };
    await panel.loadPage();
    assert.equal(child.previousButton.disabled, true);
    assert.equal(child.nextButton.disabled, false);
    for (let page = 1; page <= 6; page += 1) {
        await panel.loadUsersPage(page * 100);
    }
    assert.equal(child.state.users[0].id, 'user-600');
    assert.equal(child.nextButton.disabled, true);
    assert.equal(child.pageLabel.textContent, '601–601 of 601 users');
    await panel.saveUser('user-600', { email: 'updated@example.test' });
    assert.equal(mutations[0].url, `${panel.apiBase}/user-600`);
    assert.deepEqual(mutations[0].body, { email: 'updated@example.test' });
    assert.equal(panel.state.usersStart, 600);
    let requestedStart;
    child.dispatch = (_event, detail) => { requestedStart = detail.start; };
    child.previousPage();
    assert.equal(requestedStart, 500);
    requestedStart = undefined;
    child.nextPage();
    assert.equal(requestedStart, undefined);
    await panel.deleteUser('user-600');
    assert.equal(panel.state.usersStart, 500);
    assert.equal(child.pageLabel.textContent, '501–600 of 600 users');
});

test('administration page failure preserves current page and re-enables the controls', async () => {
    const panel = new AdminSettingsPanel({ getAttribute: () => null }, () => {});
    panel.state.users = [{ id: 'existing' }];
    panel.request = async () => { throw new Error('provider unavailable'); };
    await assert.rejects(panel.loadUsersPage(100), /provider unavailable/);
    assert.equal(panel.state.loading, false);
    assert.equal(panel.state.usersStart, 0);
    assert.equal(panel.state.users[0].id, 'existing');
});

test('saving an email-only account preserves empty optional profile fields while changing its role', async (t) => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ dataset: {}, innerHTML: '' }) };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    const child = new AdminUsersSettings({}, () => {});
    const user = { id: 'USER.2', email: 'member@example.test', username: '', name: '', roles: ['selfRegistered'] };
    const row = child.createUserRow(user);
    const fields = [...row.innerHTML.matchAll(/<input\b[^>]*>/g)].map(([tag]) => ({
        dataset: { field: tag.match(/data-field="([^"]+)"/)[1] },
        value: tag.match(/value="([^"]*)"/)?.[1] || '',
    }));
    assert.equal(fields.find((input) => input.dataset.field === 'username').value, '');
    assert.equal(fields.find((input) => input.dataset.field === 'name').value, '');
    fields.push({ dataset: { field: 'roles' }, value: 'user' });
    row.querySelectorAll = () => fields;
    const mutations = [];
    child.dispatch = (event, detail) => mutations.push({ event, detail });
    await child.submitUserRowAction(row, 'save');
    assert.deepEqual(mutations, [{ event: 'admin-users-save', detail: {
        userId: user.id, body: { username: '', email: user.email, name: '', roles: ['user'] },
    } }]);
});
