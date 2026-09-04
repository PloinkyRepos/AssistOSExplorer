import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ensureSeedData } from '../lib/bootstrap.mjs';
import { createUser, updateUser, getUserById, getUserRoles } from '../lib/users.mjs';
import { verifyPassword } from '../lib/auth/password.mjs';
import { resetStoreForTests } from '../lib/store.mjs';
import { startService } from '../service/index.mjs';

// The provider administration bridge must keep addressing blocked accounts. Only the SSO
// projection (sso-user, sso-consume-code) requires an active account.
test('provider administration updates a blocked account without an internal error and keeps it blocked', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'userpersisto-admin-runtime-'));
    process.env.PERSISTENCE_FOLDER = folder;
    process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
    process.env.USERPERSISTO_RUNTIME_SECRET = 'test-admin-runtime-secret';
    let server;
    try {
        await ensureSeedData();
        const admin = await createUser({ email: 'admin@example.test', roles: ['admin'], password: 'admin-password-1' });
        const target = await createUser({ email: 'blocked@example.test', roles: ['selfRegistered'], password: 'old-password-1' });
        await updateUser(target.id, { status: 'blocked' }, { actorId: admin.id });
        server = startService({ port: 0, host: '127.0.0.1' });
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const bridge = async (path, body) => {
            const response = await fetch(`${base}/service/runtime/${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-userpersisto-runtime-secret': process.env.USERPERSISTO_RUNTIME_SECRET },
                body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
        };
        const roleOnly = await bridge('sso-admin-user-update', { actorUserId: admin.id, userId: target.id, roles: ['user'] });
        assert.equal(roleOnly.status, 200, JSON.stringify(roleOnly.body));
        assert.deepEqual(roleOnly.body.user.roles, ['user']);
        assert.equal(roleOnly.body.user.status, 'blocked', 'a role change never reactivates a blocked account');
        assert.equal(roleOnly.body.user.username, '');
        assert.equal(roleOnly.body.user.passwordHash, undefined);
        assert.deepEqual(await getUserRoles(target.id), ['user']);
        const password = await bridge('sso-admin-user-update', { actorUserId: admin.id, userId: target.id, password: 'new-password-12' });
        assert.equal(password.status, 200, JSON.stringify(password.body));
        assert.equal(password.body.user.status, 'blocked');
        assert.equal(verifyPassword('new-password-12', (await getUserById(target.id)).passwordHash), true);
        const projection = await bridge('sso-user', { userId: target.id });
        assert.equal(projection.status, 403);
        assert.equal(projection.body.error, 'user_not_active');
        const missing = await bridge('sso-admin-user-update', { actorUserId: admin.id, userId: 'USER.missing', roles: ['user'] });
        assert.equal(missing.status, 404);
        assert.equal(missing.body.error, 'user_not_found');
        const reactivated = await bridge('sso-admin-user-update', { actorUserId: admin.id, userId: target.id, status: 'active' });
        assert.equal(reactivated.status, 200);
        assert.equal(reactivated.body.user.status, 'active');
        assert.equal((await bridge('sso-user', { userId: target.id })).status, 200);
        const asMember = await bridge('sso-admin-user-update', { actorUserId: target.id, userId: admin.id, roles: ['user'] });
        assert.equal(asMember.status, 403);
        assert.equal(asMember.body.error, 'admin_required');
    } finally {
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        await resetStoreForTests();
        delete process.env.USERPERSISTO_RUNTIME_SECRET;
        await rm(folder, { recursive: true, force: true });
    }
});
