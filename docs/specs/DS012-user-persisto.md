---
title: DS012-user-persisto
summary: Defines UserPersisto identity bootstrap, authentication policy, Explorer SSO integration, authorization, and financial journal invariants.
---

# DS012 UserPersisto

## Product boundary

UserPersisto is the durable identity and account authority for Explorer deployments. It owns users, roles, capabilities, authentication state, SSO sessions, credit balances, subscriptions, Stripe event state, payment projections, and audit events. Persisto is its primary database. EmailAgent owns transactional delivery and Stripe remains the external monetary source of truth.

Ploinky remains provider-neutral. Explorer selects UserPersisto through `sso.providerAgent` in its manifest and requires `explorer.access` through `routerAccess.requiredCapability`. Ploinky owns the browser session cookie, callback orchestration, route enforcement, exact-generation checks, and CSRF boundary. UserPersisto owns credential verification, current identity projection, role and capability decisions, and provider-side user administration.

## Installation bootstrap and registration

A new durable store contains roles and capabilities but no user account. The public setup response reports `needsInitialAdmin: true`. Registration requires only an email address and a password; username and display name are optional profile fields.

Registration is serialized inside one UserPersisto process. The first successful registration receives the `admin` role regardless of the configured default registration role. Later registrations receive the configured non-administrator role, which defaults to `user`. Self-registration policy may block later registrations but must never block creation of the initial owner. Concurrent first-registration attempts in one process must produce exactly one initial administrator.

Browser registration is part of an already initiated SSO transaction. UserPersisto must validate and consume a live provider login request before it creates the account and authorization code; an invalid, expired, or mismatched request must not create a user. This prevents an abandoned or forged registration POST from claiming installation ownership outside the intended login flow.

Development bootstrap is disabled by default and must never create a predictable account. It may run only when explicitly enabled and supplied with an explicit password, and only while the user table is empty.

User deletion through the provider administration contract is a reversible deactivation: the account becomes `blocked`. Blocking an administrator or removing its administrator role is rejected when it would leave no other active administrator.

## Authentication policy

The durable authentication policy contains enabled methods, whether later self-registration is allowed, the default registration role, and allowed browser redirect origins. If no policy or environment override exists, only password authentication is enabled. Email code, passkey, and TOTP entry points must reject requests until an administrator explicitly enables the corresponding method.

Email-code login never creates a previously unknown account. User registration is a distinct email-and-password operation. Passwords are hashed and never returned by user, profile, SSO, or administration responses. Public authentication errors must not disclose credential hashes or distinguish sensitive internal failures.

SSO authorization codes and login state are short-lived. Provider authorization codes are single-use. Redirect URIs must be absolute HTTP(S) URLs whose origin is loopback or explicitly allowed by policy. Provider session validation reloads the user, roles, capabilities, and active status from Persisto so blocking an account or changing its roles is enforced on the next remote validation.

## Roles and capabilities

The initial role policy is:

| Role | Capabilities |
| --- | --- |
| `admin` | `explorer.access`, `admin.users.manage`, `admin.agentSettings.manage`, `admin.billing.manage` |
| `user` | `explorer.access` |
| `selfRegistered` | `selfregistered.dashboard.access` |

The configured default registration role must exist and must not grant administrative capabilities. Router access is capability-based rather than a hard-coded role-name exception. Explorer's protected surface requires `explorer.access`; therefore both `admin` and `user` can enter Explorer, while `selfRegistered` cannot unless an administrator changes policy.

Administrative MCP and provider operations re-read the persisted actor and its capabilities. They must not trust caller-supplied role arrays. Profile updates are limited to the authenticated user's username and display name; role and status changes use the administrative path.

Agent tools authorize only the runtime-verified invocation grant. User-supplied top-level context, role, actor, or capability fields are data and never authority. EmailAgent similarly restricts settings to a verified administrator and delivery operations to a verified agent caller.

## Explorer administration and settings

Explorer's existing user-administration router surface supports both local-password deployments and provider-backed SSO deployments. In SSO mode, Ploinky applies the same exact-origin and session-bound CSRF protection, forces current provider-session validation, verifies administrator status, and delegates list, create, update, and deactivate operations through provider-neutral methods. UserPersisto re-authorizes the persisted actor before mutating data.

The UserPersisto settings component is visible to authenticated users for their own username and display name. Authentication policy, users, billing configuration, and provider credentials remain administrator-only. Secrets are stored in the runtime secret store, returned only in masked form, and never embedded as manifest values.

## Credit and payment journal

Credits use an append-only `creditTx` journal and a reconciled `creditAccount` projection. Each stable business reference produces a deterministic transaction identifier. Repeating an identical operation is a no-op that returns the reconciled balance; reusing a reference with different financial data is rejected. Amounts are positive safe integers and a balance or reserved balance may never become negative.

Reservations have a durable lifecycle: `reserved`, then exactly one full `committed` or `released` transition. Commit and release must match the original user, amount, and reference. Partial settlement is not supported by this revision.

Stripe webhook signatures are verified over the raw request body with a five-minute timestamp tolerance. A Stripe event identifier is bound to its payload hash. Paid credit checkouts create one deterministic purchase journal entry only after the event identity matches a checkout previously initiated and journaled by UserPersisto. The checkout snapshots the number of credits before redirecting to Stripe, so later configuration changes cannot alter an in-flight purchase. Identity, amount, and currency conflicts fail before credits are applied; unpaid completion events create no credits. Processed events are idempotent, failed events remain retryable, and reusing an event identifier with a different payload is rejected. `paymentTransaction` is an operational projection of Stripe checkout/payment state; it is not a replacement for Stripe's monetary records.

Checkout creation accepts an explicit client idempotency key or generates one, forwards it to Stripe, and journals the returned checkout identity. Checkout URLs and price identifiers are runtime configuration. Only an active authenticated account may start checkout.

## Durability and deployment constraints

Persisto does not provide a multi-record ACID transaction or a distributed lock. UserPersisto therefore serializes registration, role mutation, ledger mutation, and Stripe event processing in process and calls `forceSave` at durable boundaries. Role changes add requested links before removing obsolete ones, and account projections are rebuilt from the append-only credit journal when they disagree.

These guarantees require one active UserPersisto writer for a persistence volume. Running multiple UserPersisto processes against the same Persisto folder is unsupported until the database supplies cross-process compare-and-set or transactional locking. Operators must back up the Persisto volume, retain Stripe event history, and reconcile the local payment projection against Stripe after storage recovery. This credit journal is application accounting; financial custody, regulated bookkeeping, tax, chargeback, and revenue-recognition requirements remain outside this component.

## Compatibility scope and deliberate deferrals

This revision provides the application-facing identity-provider boundary needed by Explorer and Ploinky; it is not yet a standards-compatible Keycloak replacement. It does not expose OpenID Connect discovery, OAuth 2.0 authorization/token endpoints, SAML, identity federation, social login, password recovery, verified-email workflows, step-up authentication, or a multi-factor enrollment UI. Passkey, email-code, and TOTP domain operations exist but remain opt-in and require product UI work before general availability.

The seeded `admin`, `user`, and `selfRegistered` roles and their capability links are durable. User assignment and registration-role policy are implemented, while arbitrary role/capability definition administration is deferred. Ploinky revalidates provider sessions on its configured cadence (30 seconds by default), except user-administration requests, which force a remote validation. Deployments needing immediate route revocation must lower that interval or add provider-driven revocation.

The initial public owner-claim flow is operationally sensitive. A fresh deployment must expose it only on a trusted network or behind an installation secret until the first account is established. High availability requires a future transactional or single-leader storage design; starting two writers against the same Persisto volume is not a supported scaling strategy.

## Verification contract

Tests must cover an empty installation, concurrent first registration, default and explicitly enabled authentication methods, unknown-user email-code rejection, optional username, last-administrator protection, current persisted capability enforcement, single-use SSO codes, redirect allowlisting, credit boundary values, reservation transitions, concurrent idempotency, Stripe signature failure, unpaid checkout, event payload conflicts, and provider-neutral Ploinky administration delegation.
