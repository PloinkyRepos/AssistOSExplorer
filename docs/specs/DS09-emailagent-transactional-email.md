# DS09 - EmailAgent Transactional Email

## Purpose

`emailAgent` owns transactional email delivery for the workspace. Its first implemented provider is Mailjet, and its primary consumer on this branch is `userPersistoAgent` for authentication-code email delivery.

## Core Content

EmailAgent is an MCP-only utility agent with no browser HTTP surface. It stores provider configuration under `/data/settings.enc.json` unless `EMAILAGENT_SETTINGS_FILE` overrides the location. `EMAILAGENT_SETTINGS_KEY` is a generated secret and is required before settings can be encrypted or decrypted.

The implemented MCP tool contract contains seven document tools:

| Tool | Tag | Contract |
|---|---|---|
| `email_config_get` | `admin` | Return masked Mailjet configuration. |
| `email_config_set` | `admin` | Store Mailjet configuration, keeping empty secret values unchanged and deleting keys listed in `remove`. |
| `email_provider_status` | `admin` | Report whether the required Mailjet settings are present. |
| `email_send_text` | `internal` | Send text and optional HTML email through Mailjet. |
| `email_send_template` | `internal` | Send a Mailjet template email. |
| `email_send_test` | `admin` | Send a fixed test email through the configured Mailjet account. |
| `email_send_auth_code` | `internal` | Send a six-digit auth code without returning the code. |

The Mailjet v1 provider adapter uses `https://api.mailjet.com/v3.1/send`, Basic auth from `MAILJET_API_KEY` and `MAILJET_API_SECRET`, and a `From` identity from `MAILJET_FROM_EMAIL` plus optional `MAILJET_FROM_NAME`. `email_send_template` requires a positive numeric template id. `email_send_auth_code` uses `EMAIL_AUTH_CODE_TEMPLATE_ID` when present and otherwise sends a plain text fallback.

Settings storage uses AES-256-GCM for secret keys and plain string storage for non-secret keys:

| Key | Storage |
|---|---|
| `MAILJET_API_KEY` | encrypted secret |
| `MAILJET_API_SECRET` | encrypted secret |
| `MAILJET_FROM_EMAIL` | plain string |
| `MAILJET_FROM_NAME` | plain string |
| `EMAIL_AUTH_CODE_TEMPLATE_ID` | plain string |

Secret values returned by `email_config_get` must be masked with only a prefix and suffix visible. Empty setting values mean "keep the existing value"; explicit removal uses the `remove` array.

EmailAgent must not log, persist, or return raw authentication codes. `email_send_auth_code` returns provider delivery metadata only (`providerMessageId` and `correlationId`). The durable auth-code delivery log for this branch is UserPersisto's `emailLog`, which stores `toEmailHash`, template name, delivery result, provider message id, and correlation id without the raw recipient address or raw code. If EmailAgent later adds its own delivery persistence, it must follow the same redacted shape and must not store raw codes.

Agent-to-agent calls from UserPersisto use Ploinky's `AgentMcpClient` and the router's Agent-Assertion flow. EmailAgent must remain reachable as a target agent through normal Ploinky MCP routing; it must not add separate shared-secret or direct-port authentication paths for callers.

## Decisions & Questions

### Question #1: Why keep EmailAgent as a separate MCP utility agent?

Response:
UserPersisto owns auth state and redacted audit records, while EmailAgent owns provider credentials and delivery mechanics. Keeping those concerns separate prevents auth code generation from needing Mailjet-specific logic and lets other agents reuse transactional email without reading UserPersisto internals.

### Question #2: Why does EmailAgent not return the auth code it sends?

Response:
The caller already generated the code and must verify only the stored hash. Returning the raw code from the delivery tool would widen the exposure surface and make tool transcripts or agent logs a credential leak risk.

### Question #3: Where does redacted delivery logging live today?

Response:
This branch records auth-code delivery attempts in UserPersisto because the log is tied to auth challenges, user lookup, and correlation with SSO login requests. EmailAgent currently has no durable delivery-log document model. Its contract still forbids raw-code logging and constrains any future delivery log to redacted metadata.
