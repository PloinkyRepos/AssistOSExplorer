# DS08 - UserPersisto Identity And Billing

## Purpose

`userPersistoAgent` is the workspace authority for users, roles, capabilities, authentication methods, SSO login handoff, credits, Stripe billing, and audit events. It is also the Ploinky SSO provider for this workspace.

## Core Content

UserPersisto uses embedded Persisto as its only durable store. `PERSISTENCE_FOLDER` is required, defaults to `/data/persisto` in the agent profile, and must point at durable agent data. There is no JSON fallback store. Startup must fail fast when Persisto cannot be loaded, the persistence folder cannot be prepared, or the schema cannot be registered.

The Persisto schema contains exactly these document types and unique index fields:

| Type | Unique index |
|---|---|
| `user` | `email` |
| `role` | `name` |
| `permission` | `capability` |
| `userRole` | `key` |
| `rolePermission` | `key` |
| `authMethod` | `key` |
| `authChallenge` | `challengeId` |
| `creditAccount` | `userId` |
| `creditTx` | `txId` |
| `subscription` | `providerRef` |
| `billingEvent` | `stripeEventId` |
| `emailLog` | `logId` |
| `auditEvent` | `auditId` |
| `ssoLoginRequest` | `providerState` |
| `ssoAuthCode` | `code` |

The schema also declares groupings for `userRoles.userId`, `rolePerms.roleId`, `authMethods.userId`, `creditHistory.userId`, `subscriptions.userId`, and `auditTrail.actorId`. Code that looks up records by non-id keys must use the generated indexed methods such as `getCreditAccountByUserId`, `getBillingEventByStripeEventId`, and `getSubscriptionByProviderRef`; generated `get<Type>(id)` and `has<Type>(id)` methods validate object-id prefixes and are not valid substitutes for these indexes.

The seeded authorization model uses persisted `role`, `permission`, `userRole`, and `rolePermission` records. Seeded roles are `admin`, `user`, and `selfRegistered`. Seeded capabilities are:

| Capability | Seeded roles |
|---|---|
| `explorer.access` | `admin`, `user` |
| `admin.users.manage` | `admin` |
| `admin.agentSettings.manage` | `admin` |
| `admin.billing.manage` | `admin` |
| `selfregistered.dashboard.access` | `selfRegistered` |

Route authentication is not sufficient domain authorization. Sensitive tools must still check the authenticated actor or explicit admin role before mutating users, settings, billing, or audit state. `userpersisto_authorize_capability` returns capability decisions from the persisted role-permission graph and does not grant capabilities from a hardcoded wildcard.

The implemented MCP tool contract is:

| Area | Tools |
|---|---|
| Profile and authorization | `userpersisto_profile_get`, `userpersisto_authorize_capability` |
| Users and roles | `userpersisto_user_list`, `userpersisto_user_create`, `userpersisto_user_update`, `userpersisto_user_roles_update` |
| Password and email code | `userpersisto_auth_password_login`, `userpersisto_auth_password_set`, `userpersisto_auth_email_code_start`, `userpersisto_auth_email_code_verify` |
| Passkeys | `userpersisto_passkey_registration_options`, `userpersisto_passkey_registration_verify`, `userpersisto_passkey_login_options`, `userpersisto_passkey_login_verify` |
| TOTP | `userpersisto_totp_setup_start`, `userpersisto_totp_setup_verify`, `userpersisto_totp_login_verify` |
| Credits | `userpersisto_credits_balance`, `userpersisto_credits_ledger`, `userpersisto_credits_grant`, `userpersisto_credits_refund`, `userpersisto_credits_reserve`, `userpersisto_credits_commit`, `userpersisto_credits_release` |
| Agent configuration | `userpersisto_config_get`, `userpersisto_config_set` |
| Billing | `userpersisto_billing_checkout_create`, `userpersisto_billing_subscription_get`, `userpersisto_billing_stripe_webhook_process`, `userpersisto_billing_events_list` |
| Audit | `userpersisto_audit_events_list` |

Four authentication strategies are implemented: password, email code, passkey, and TOTP. In development, `USERPERSISTO_DEV_BOOTSTRAP=true` enables password-first behavior and creates `admin@dev.local` with password `admin` only when the user table is empty. That environment flag is prohibited in production. The dev profile enables `password,emailCode,passkey,totp`; other profiles may set `USERPERSISTO_AUTH_METHODS`. When no explicit method list is configured, dev bootstrap falls back to `password,emailCode`, while non-dev falls back to `emailCode,password`.

Email-code auth stores only a hashed challenge, bounded attempts, expiry, and an `emailLog` entry with `toEmailHash`. Raw auth codes must not appear in tool responses, HTTP responses, or `emailLog`. The only permitted plaintext-code exposure is a dev-console warning when `USERPERSISTO_DEV_BOOTSTRAP === "true"` and delivery through `emailAgent` fails.

Passkey registration and verification are authenticated-user MCP operations. Passkey login is an internal login strategy used by the auth service. TOTP setup is also authenticated-user MCP-only: setup start returns a secret and otpauth URL to the already authenticated user, setup verify enables the method, and login verify accepts email plus token through the auth service.

UserPersisto is the SSO provider. Runtime clients create a login request through `/service/runtime/sso-login-request` using `USERPERSISTO_RUNTIME_SECRET`, then send the browser to the guest auth service. The login app carries `requestId`/`providerState` as the provider login request identifier and preserves OAuth-style `state` only for the final router callback. A successful auth strategy issues a one-time `ssoAuthCode`; the browser is redirected to the request's `redirectUri` with `code` and `state`; the router consumes the code through `/service/runtime/sso-consume-code`. SSO auth codes are single-use and expire.

The credit system uses immutable `creditTx` records plus denormalized `creditAccount` totals. `creditAccount.balance` means available credits after reservations, not lifetime total purchased. The invariant is:

```text
balance = sum(grant + purchase + refund + release) - sum(reserve)
reservedBalance = sum(reserve) - sum(spend) - sum(release)
```

`reserve` moves credits from available balance to reserved balance. `commit` records a `spend` against reserved balance. `release` returns reserved credits to available balance. Grant and refund are admin operations; reserve, commit, and release are internal billable-operation primitives. Credit account lookup must use `getCreditAccountByUserId`.

Stripe checkout creation supports `kind = "credits"` and `kind = "subscription"`. Checkout stores the user id in `client_reference_id` and metadata. Webhook processing must use the raw HTTP body, verify `stripe-signature` with `STRIPE_WEBHOOK_SECRET`, reject stale or malformed signatures, and record each Stripe event exactly once by `billingEvent.stripeEventId`. Duplicate events return duplicate status and do not apply ledger or subscription changes again. Credit purchase events are `checkout.session.completed` with `metadata.kind = "credits"` and convert `metadata.units * USERPERSISTO_CREDITS_PER_UNIT` into a `purchase` credit transaction. Subscription events with type prefix `customer.subscription.` upsert subscriptions by `providerRef`.

Billing and Stripe settings are stored in `/data/settings.enc.json` unless `USERPERSISTO_SETTINGS_FILE` overrides it. `USERPERSISTO_SETTINGS_KEY` is a generated secret and is required for settings encryption, email-code hashing, and TOTP secret encryption. Secret settings (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) use AES-256-GCM storage and are shown through prefix/suffix masking. Plain settings (`STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_CREDITS`, `STRIPE_PRICE_SUBSCRIPTION`, `USERPERSISTO_CREDITS_PER_UNIT`) are stored as strings. Empty values keep existing values unchanged, and the `remove` list explicitly deletes settings.

## Decisions & Questions

### Question #1: Why is embedded Persisto the only supported store?

Response:
UserPersisto is the authority for security-sensitive identity, auth, credit, billing, and audit state. A fallback store would create a second persistence contract and make failures ambiguous. The branch therefore fails fast instead of silently switching storage backends.

### Question #2: Why does the SSO login app use `requestId` instead of treating `state` as the provider lookup key?

Response:
The provider login request is persisted as `ssoLoginRequest.providerState` and exposed to the browser as `requestId`/`providerState`. OAuth-style `state` is caller-owned callback correlation and is returned unchanged at the end of the flow. Keeping these separate prevents a caller-visible callback state from becoming the database lookup key.

### Question #3: Why is TOTP setup authenticated-MCP-only?

Response:
TOTP setup returns enrollment material that belongs only to an already authenticated user. The public login service only verifies an existing TOTP method. Enrollment is therefore exposed through authenticated MCP tools rather than through the guest login page.

### Question #4: Why are credit reservations amount-based rather than reservation-record based?

Response:
This branch implements credits as immutable `creditTx` entries plus denormalized account totals. The commit and release tools accept `userId`, `amount`, and optional `referenceId`; the reference id links the operation to an external billable action but is not a persisted reservation object id.
