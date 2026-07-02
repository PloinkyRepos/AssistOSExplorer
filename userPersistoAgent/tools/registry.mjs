import { getProfile, authorizeCapability } from '../lib/authorization.mjs';
import { createUser, updateUser, listUsers, setUserRoles } from '../lib/users.mjs';
import { loginWithPassword, setPassword } from '../lib/auth/password.mjs';
import { startEmailCode, verifyEmailCode } from '../lib/auth/email-code.mjs';
import * as passkey from '../lib/auth/passkey.mjs';
import * as totp from '../lib/auth/totp.mjs';
import * as credits from '../lib/credits.mjs';
import * as billing from '../lib/billing.mjs';
import { getSettings as getAgentSettings, saveSettings as saveAgentSettings } from '../lib/settings.mjs';
import { getStore } from '../lib/store.mjs';

function requireAdmin(context) {
    if (!Array.isArray(context.actorRoles) || !context.actorRoles.includes('admin')) {
        throw new Error('admin role required');
    }
}

function requireActor(context) {
    if (!context.actorUserId) {
        throw new Error('authenticated user required');
    }
    return context.actorUserId;
}

const HANDLERS = {
    userpersisto_profile_get: async (_args, context) => getProfile(requireActor(context)),
    userpersisto_authorize_capability: async (args) => authorizeCapability({
        userId: args.userId,
        capability: args.capability,
        resource: args.resource || ''
    }),
    userpersisto_user_list: async (args, context) => {
        requireAdmin(context);
        return listUsers({ start: args.start || 0, pageSize: args.pageSize || 50 });
    },
    userpersisto_user_create: async (args, context) => {
        requireAdmin(context);
        return createUser({
            email: args.email,
            displayName: args.displayName || '',
            source: 'admin',
            roles: args.roles || ['user'],
            password: args.password || ''
        });
    },
    userpersisto_user_update: async (args, context) => {
        requireAdmin(context);
        return updateUser(args.userId, { displayName: args.displayName, status: args.status });
    },
    userpersisto_user_roles_update: async (args, context) => {
        requireAdmin(context);
        return setUserRoles(args.userId, args.roles, { actorId: context.actorUserId });
    },
    userpersisto_auth_password_login: async (args) => loginWithPassword(args.email, args.password),
    userpersisto_auth_password_set: async (args, context) => {
        const actor = requireActor(context);
        let target = actor;
        if (args.userId && args.userId !== actor) {
            requireAdmin(context);
            target = args.userId;
        }
        await setPassword({ userId: target, newPassword: args.newPassword, actorId: actor });
        return { ok: true };
    },
    userpersisto_auth_email_code_start: async (args) => {
        const started = await startEmailCode({
            email: args.email,
            purpose: args.purpose || 'login',
            correlationId: args.correlationId || '',
            createSelfRegistered: args.createSelfRegistered === true
        });
        return { challengeId: started.challengeId };
    },
    userpersisto_auth_email_code_verify: async (args) => verifyEmailCode({ challengeId: args.challengeId, code: args.code }),
    userpersisto_passkey_registration_options: async (args, context) => passkey.registrationOptions({
        userId: requireActor(context),
        origin: args.origin,
        rpId: args.rpId
    }),
    userpersisto_passkey_registration_verify: async (args, context) => passkey.registrationVerify({
        userId: requireActor(context),
        attestation: args.attestation,
        origin: args.origin
    }),
    userpersisto_passkey_login_options: async (args) => passkey.loginOptions({
        email: args.email,
        origin: args.origin,
        rpId: args.rpId
    }),
    userpersisto_passkey_login_verify: async (args) => passkey.loginVerify({
        email: args.email,
        assertion: args.assertion,
        challengeKey: args.challengeKey,
        origin: args.origin
    }),
    userpersisto_totp_setup_start: async (_args, context) => totp.setupStart({ userId: requireActor(context) }),
    userpersisto_totp_setup_verify: async (args, context) => totp.setupVerify({
        userId: requireActor(context),
        token: args.token
    }),
    userpersisto_totp_login_verify: async (args) => totp.loginVerify({
        email: args.email,
        token: args.token
    }),
    userpersisto_credits_balance: async (args, context) => credits.getBalance(
        args.userId && context.actorRoles?.includes('admin') ? args.userId : requireActor(context)
    ),
    userpersisto_credits_grant: async (args, context) => {
        requireAdmin(context);
        return credits.grant({
            userId: args.userId,
            amount: args.amount,
            reason: args.reason || '',
            actorId: context.actorUserId
        });
    },
    userpersisto_credits_reserve: async (args) => credits.reserve({
        userId: args.userId,
        amount: args.amount,
        reason: args.reason || '',
        referenceId: args.referenceId || ''
    }),
    userpersisto_credits_commit: async (args) => credits.commit({
        userId: args.userId,
        amount: args.amount,
        referenceId: args.referenceId || ''
    }),
    userpersisto_credits_release: async (args) => credits.release({
        userId: args.userId,
        amount: args.amount,
        referenceId: args.referenceId || ''
    }),
    userpersisto_credits_refund: async (args, context) => {
        requireAdmin(context);
        return credits.refund({
            userId: args.userId,
            amount: args.amount,
            reason: args.reason || '',
            referenceId: args.referenceId || '',
            actorId: context.actorUserId
        });
    },
    userpersisto_credits_ledger: async (args, context) => credits.ledger({
        userId: args.userId && context.actorRoles?.includes('admin') ? args.userId : requireActor(context),
        start: args.start || 0,
        pageSize: args.pageSize || 100
    }),
    userpersisto_billing_checkout_create: async (args, context) => billing.createCheckout({
        userId: requireActor(context),
        kind: args.kind,
        quantity: args.quantity || 1
    }),
    userpersisto_billing_stripe_webhook_process: async (args) => billing.processStripeWebhook({
        rawBody: args.rawBody,
        signatureHeader: args.signatureHeader
    }),
    userpersisto_billing_subscription_get: async (args, context) => billing.getSubscription(
        args.userId && context.actorRoles?.includes('admin') ? args.userId : requireActor(context)
    ),
    userpersisto_billing_events_list: async (args, context) => {
        requireAdmin(context);
        return billing.listBillingEvents({ start: args.start || 0, pageSize: args.pageSize || 100 });
    },
    userpersisto_config_get: async (_args, context) => {
        requireAdmin(context);
        return getAgentSettings();
    },
    userpersisto_config_set: async (args, context) => {
        requireAdmin(context);
        await saveAgentSettings(args);
        return getAgentSettings();
    },
    userpersisto_audit_events_list: async (args, context) => {
        requireAdmin(context);
        const store = await getStore();
        return store.select('auditEvent', args.actorId ? { actorId: args.actorId } : {}, {
            sortBy: 'timestamp',
            descending: true,
            start: args.start || 0,
            pageSize: args.pageSize || 100
        });
    }
};

export function registerTools(map) {
    for (const [name, handler] of Object.entries(map || {})) {
        HANDLERS[name] = handler;
    }
}

export function hasTool(name) {
    return typeof HANDLERS[name] === 'function';
}

export async function runTool(name, args = {}, context = {}) {
    const handler = HANDLERS[name];
    if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
    }
    return handler(args, context);
}
