#!/usr/bin/env node
import {
  createUser,
  updateUser,
  listUsers,
  setUserRole,
  setCurrentUserPreferredAuthMethod,
  getCurrentUserAuthProfile,
  getCurrentUser,
  findCurrentUserFromAuthInfo
} from '../lib/users.mjs';
import { USERPERSISTO_ROLES } from '../lib/roles.mjs';
import { checkAccess } from '../lib/authorization.mjs';
import { startEmailCodeLogin, verifyEmailCode } from '../lib/auth/email-code.mjs';
import {
  startPasskeyRegistration,
  verifyPasskeyRegistration,
  startPasskeyLogin,
  verifyPasskeyLogin
} from '../lib/auth/passkey.mjs';
import { setupTotp, verifyTotp } from '../lib/auth/totp.mjs';
import { getCreditBalance, addCredits, consumeCredits } from '../lib/credits/ledger.mjs';
import { getSubscription, createStripeCheckout } from '../lib/billing/stripe.mjs';
import { getAuditEvents } from '../lib/audit.mjs';
import { getAgentSettings, saveAgentSettings } from '../lib/settings.mjs';
import { getAllowedAuthMethods } from '../lib/settings.mjs';
import { ensureUserPersistoSchema } from '../lib/storage/ensure-schema.mjs';

async function loadInvocationAuth() {
  const candidates = [
    process.env.PLOINKY_INVOCATION_AUTH_MODULE,
    '/Agent/lib/invocation-auth.mjs',
    '../shared/invocation-auth.mjs',
    '../../shared/invocation-auth.mjs'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (_) {}
  }
  return { authInfoFromInvocation: () => null };
}

const { authInfoFromInvocation } = await loadInvocationAuth();

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

async function readEnvelope() {
  let raw = '';
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function unwrapInput(envelope) {
  let current = envelope;
  for (let i = 0; i < 4; i += 1) {
    if (current?.input && typeof current.input === 'object') current = current.input;
    else if (current?.arguments && typeof current.arguments === 'object') current = current.arguments;
    else if (current?.params?.arguments && typeof current.params.arguments === 'object') current = current.params.arguments;
    else break;
  }
  return current && typeof current === 'object' ? current : {};
}

function authInfoFromEnvelope(envelope = {}) {
  const grant = envelope?.metadata?.invocation;
  return grant && typeof grant === 'object'
    ? authInfoFromInvocation(grant, { invocationToken: envelope?.metadata?.invocationToken || '' })
    : null;
}

async function dispatch(toolName, input, authInfo = null) {
  await ensureUserPersistoSchema();
  switch (toolName) {
    case 'userpersisto_get_current_user':
      return getCurrentUser(input.auth || {});
    case 'userpersisto_create_user':
      return { ok: true, user: await createUser(input) };
    case 'userpersisto_update_user':
      return { ok: true, user: await updateUser(input) };
    case 'userpersisto_list_users':
      return listUsers(input);
    case 'userpersisto_set_user_role':
      return { ok: true, user: await setUserRole(input) };
    case 'userpersisto_get_my_auth_profile':
      return { ok: true, ...(await getCurrentUserAuthProfile(authInfo)) };
    case 'userpersisto_set_my_preferred_auth_method':
      return { ok: true, user: await setCurrentUserPreferredAuthMethod(input, authInfo) };
    case 'userpersisto_start_my_passkey_registration':
      return startMyPasskeyRegistration(input, authInfo);
    case 'userpersisto_verify_my_passkey_registration':
      return verifyMyPasskeyRegistration(input, authInfo);
    case 'userpersisto_setup_my_totp':
      return setupMyTotp(input, authInfo);
    case 'userpersisto_verify_my_totp':
      return verifyMyTotp(input, authInfo);
    case 'userpersisto_get_roles':
      return { roles: USERPERSISTO_ROLES };
    case 'userpersisto_check_access':
      return checkAccess(input);
    case 'userpersisto_start_email_code_login':
      return startEmailCodeLogin(input);
    case 'userpersisto_verify_email_code':
      return verifyEmailCode(input);
    case 'userpersisto_start_passkey_registration':
      return startPasskeyRegistration(input);
    case 'userpersisto_verify_passkey_registration':
      return verifyPasskeyRegistration(input);
    case 'userpersisto_start_passkey_login':
      return startPasskeyLogin(input);
    case 'userpersisto_verify_passkey_login':
      return verifyPasskeyLogin(input);
    case 'userpersisto_setup_totp':
      return setupTotp(input);
    case 'userpersisto_verify_totp':
      return verifyTotp(input);
    case 'userpersisto_get_credit_balance':
      return getCreditBalance(input);
    case 'userpersisto_add_credits':
      return addCredits(input);
    case 'userpersisto_consume_credits':
      return consumeCredits(input);
    case 'userpersisto_get_subscription':
      return getSubscription(input);
    case 'userpersisto_create_stripe_checkout':
      return createStripeCheckout(input);
    case 'userpersisto_get_audit_events':
      return getAuditEvents(input);
    case 'userpersisto_get_agent_settings':
      return getAgentSettings();
    case 'userpersisto_save_agent_settings':
      return saveAgentSettings(input);
    default:
      throw new Error(`Unknown UserPersisto tool: ${toolName}`);
  }
}

async function requireCurrentUser(authInfo) {
  const user = await findCurrentUserFromAuthInfo(authInfo);
  if (!user) throw new Error('Authenticated UserPersisto user is required.');
  return user;
}

async function requireAllowedAuthMethod(method) {
  const allowedMethods = await getAllowedAuthMethods();
  if (!allowedMethods.includes(method)) {
    throw new Error(`${method} authentication is not enabled for this workspace.`);
  }
}

async function startMyPasskeyRegistration(input = {}, authInfo = null) {
  await requireAllowedAuthMethod('passkey');
  const user = await requireCurrentUser(authInfo);
  return startPasskeyRegistration({
    origin: input.origin,
    rpId: input.rpId,
    rpName: input.rpName,
    userId: user.id
  });
}

async function verifyMyPasskeyRegistration(input = {}, authInfo = null) {
  await requireAllowedAuthMethod('passkey');
  const user = await requireCurrentUser(authInfo);
  const result = await verifyPasskeyRegistration(input);
  if (result?.credential?.userId !== user.id) {
    throw new Error('Passkey registration does not belong to the authenticated user.');
  }
  return result;
}

async function setupMyTotp(input = {}, authInfo = null) {
  await requireAllowedAuthMethod('totp');
  const user = await requireCurrentUser(authInfo);
  return setupTotp({
    issuer: input.issuer,
    label: input.label || user.email || user.username || user.id,
    userId: user.id
  });
}

async function verifyMyTotp(input = {}, authInfo = null) {
  await requireAllowedAuthMethod('totp');
  const user = await requireCurrentUser(authInfo);
  return verifyTotp({ userId: user.id, code: input.code });
}

try {
  const envelope = await readEnvelope();
  const input = unwrapInput(envelope);
  const authInfo = authInfoFromEnvelope(envelope);
  const result = await dispatch(process.env.TOOL_NAME || input.toolName, input, authInfo);
  writeJson(result);
} catch (error) {
  writeJson({ ok: false, error: error?.message || String(error) });
}
