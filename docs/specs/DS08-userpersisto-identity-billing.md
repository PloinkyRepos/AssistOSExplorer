# DS08 UserPersisto Identity And Billing

UserPersisto owns workspace identity records, self-registered user access, authentication enrollment state, capability authorization, credits, subscriptions, and billing events. It must use PersiSto as its durable store. Local JSON fallback storage is not allowed.

## Storage Contract

UserPersisto persists these model groups in PersiSto:

- Identity: `user`, `role`, `permission`, `userRole`, `rolePermission`
- Authentication: `authMethod`, `emailAuthCode`, `webauthnChallenge`, `passkeyCredential`, `totpSecret`, `session`
- SSO: `ssoLoginRequest`, `ssoAuthCode`
- Billing and credits: `creditAccount`, `creditLedgerEntry`, `creditReservation`, `subscription`, `billingEvent`
- Operations: `auditEvent`, `agentSetting`, `emailDeliveryLog`

Startup is valid only when the PersiSto client can be loaded, PersiSto is reachable, and `ensureUserPersistoSchema` can register the full schema. The agent must fail fast when storage is unavailable.

## Capability Authorization

Route reachability is not sufficient domain authorization. UserPersisto must expose explicit capability checks through `userpersisto_authorize_capability`.

Default capabilities:

- `admin`: all declared permissions, granted through explicit `rolePermission` records
- `user`: `explorer.access`, `selfregistered.access`
- `selfRegistered`: `selfregistered.access`

Persisted `rolePermission` records may grant additional capabilities. Default roles must not use a global `*` grant; adding a default permission must also grant it to `admin` explicitly. Capability strings may use exact grants or explicitly configured suffix wildcard grants such as `billing.*`. Credit cost checks must use available credits, not total balance, so pending reservations reduce usable credit.

## Credits

Credits are append-only ledger entries plus explicit reservations:

- `purchaseCredits` and `addCredits` add positive ledger entries.
- `reserveCredits` creates a pending reservation when available balance is sufficient.
- `commitCredits` converts a pending reservation into a debit.
- `releaseCredits` frees a pending reservation without a debit.
- `refundCredits` adds a positive refund entry.
- `consumeCredits` remains a direct debit helper for simple callers.

Available balance equals ledger balance minus pending reservations.

## Billing Events

Stripe checkout creation is not enough to mark credits or subscriptions as paid. Stripe webhooks must be verified with `STRIPE_WEBHOOK_SECRET`, recorded as `billingEvent`, and applied idempotently by `providerEventId`.

Supported event behavior:

- `checkout.session.completed` with `mode=payment` and `metadata.creditsAmount` purchases credits.
- `checkout.session.completed` with `mode=subscription` upserts the user's subscription record.
- Replayed processed events return as duplicates and must not apply ledger effects twice.

## Email Delivery Logs

Authentication-code email attempts must create `emailDeliveryLog` records with provider, template, target email, delivery status, and metadata. Email authentication codes are one-time use; successful verification must set `consumedAt`.

## Tests

UserPersisto changes that affect identity, capability authorization, credits, billing, or email-code behavior must include focused tests under `userPersistoAgent/tests`.
