import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-tools-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const IMPLEMENTED = [
    'userpersisto_profile_get',
    'userpersisto_profile_update',
    'userpersisto_authorize_capability',
    'userpersisto_user_list',
    'userpersisto_user_create',
    'userpersisto_user_update',
    'userpersisto_user_roles_update',
    'userpersisto_auth_password_login',
    'userpersisto_auth_password_set',
    'userpersisto_auth_email_code_start',
    'userpersisto_auth_email_code_verify',
    'userpersisto_passkey_registration_options',
    'userpersisto_passkey_registration_verify',
    'userpersisto_passkey_login_options',
    'userpersisto_passkey_login_verify',
    'userpersisto_totp_setup_start',
    'userpersisto_totp_setup_verify',
    'userpersisto_totp_login_verify',
    'userpersisto_credits_balance',
    'userpersisto_credits_ledger',
    'userpersisto_credits_grant',
    'userpersisto_credits_refund',
    'userpersisto_credits_reserve',
    'userpersisto_credits_commit',
    'userpersisto_credits_release',
    'userpersisto_config_get',
    'userpersisto_config_set',
    'userpersisto_auth_policy_get',
    'userpersisto_auth_policy_set',
    'userpersisto_billing_checkout_create',
    'userpersisto_billing_stripe_webhook_process',
    'userpersisto_billing_subscription_get',
    'userpersisto_billing_events_list',
    'userpersisto_audit_events_list'
];

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser, updateUser } = await import('../lib/users.mjs');
const { runTool, hasTool } = await import('../tools/registry.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('document-contract tools dispatch to domain handlers', async () => {
    await ensureSeedData();
    const admin = await createUser({ email: 'root@x.com', displayName: 'Root', roles: ['admin'], password: 'root-pass' });

    const profile = await runTool('userpersisto_profile_get', {}, { actorUserId: admin.id, actorRoles: ['admin'] });
    assert.equal(profile.user.email, 'root@x.com');

    const created = await runTool('userpersisto_user_create', { email: 'via-tool@x.com', displayName: 'VT', roles: ['user'] }, { actorUserId: admin.id, actorRoles: ['admin'] });
    assert.ok(created.id);

    const listed = await runTool('userpersisto_user_list', {}, { actorUserId: admin.id, actorRoles: ['admin'] });
    assert.ok(listed.totalCount >= 2);

    const decision = await runTool('userpersisto_authorize_capability', { userId: created.id, capability: 'explorer.access' }, { actorRoles: ['agent'] });
    assert.equal(decision.allowed, true);

    await assert.rejects(
        () => runTool('userpersisto_user_create', { email: 'nope@x.com' }, { actorUserId: created.id, actorRoles: ['user'] }),
        /admin/i
    );
});

test('implemented mcp-config tool names resolve in the registry', async () => {
    const config = JSON.parse(await readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    const names = config.tools.map((tool) => tool.name);
    for (const name of IMPLEMENTED) {
        assert.ok(names.includes(name), `mcp-config missing ${name}`);
        assert.ok(hasTool(name), `registry missing ${name}`);
    }
});

test('blocked users cannot create a billing checkout', async () => {
    await ensureSeedData();
    const blocked = await createUser({ email: 'blocked-billing@x.com', roles: ['user'] });
    await updateUser(blocked.id, { status: 'blocked' }, { actorId: 'test-admin' });

    await assert.rejects(
        () => runTool('userpersisto_billing_checkout_create', { kind: 'credits' }, { actorUserId: blocked.id }),
        (error) => error?.code === 'invalid_session'
    );
});

test('tools reject special authentication methods until explicitly enabled', async () => {
    await ensureSeedData();
    const admin = await createUser({ email: 'method-admin@x.com', roles: ['admin'] });
    const context = { actorUserId: admin.id, actorRoles: ['admin'] };

    for (const [name, args] of [
        ['userpersisto_auth_email_code_verify', { challengeId: 'unused', code: '000000' }],
        ['userpersisto_passkey_registration_options', { origin: 'http://localhost:7000' }],
        ['userpersisto_totp_setup_start', {}],
    ]) {
        await assert.rejects(
            () => runTool(name, args, context),
            (error) => error?.code === 'auth_method_disabled',
            `${name} should be disabled by the default policy`
        );
    }
});
