---
id: DS01
title: Ploinky Agent Invariant
status: implemented
owner: onlyoffice-team
summary: Defines the pinned v5 OnlyOffice image, split Router targets, signed callbacks, and private storage boundary.
---

# DS01 - Ploinky Agent Invariant

## Service topology

`onlyOffice` runs from a pinned multi-architecture image digest and declares
access policy for two Router convention paths:

- authenticated control on TCP `7000`, mounted at `/base-agent-additional-server/onlyOffice/7000/control/`;
- narrowly public editor transport on TCP `8080`, mounted at
  `/base-agent-additional-server/onlyOffice/8080/`.

The path-selected ports remain inside the agent container. They never add an
outer box publication. DocumentServer binds `127.0.0.1:80`; document storage
and callbacks bind `127.0.0.1:9100`. The pinned build-time DocService bind
interposer is loaded only into DocService and rewrites its IPv6 wildcard bind
for the exact TCP `8000` support port to `[::1]:8000`. The configuration hook
requires the pinned nginx canonical file and its exact relative alias symlink
to resolve to the same file, then requires exactly one expected
`localhost:8000` upstream before replacing it once with `[::1]:8000`. The
pinned DocumentServer entrypoint materializes that configured alias as a
distinct `105:107`, `0644` regular file. Readiness requires both regular files
to have distinct identities, byte-identical content, and the exact target
directive, then verifies the `[::1]:8000` listener. PostgreSQL `5432`, RabbitMQ
`5672`/`25672`, EPMD `4369`, and Redis `6379` when enabled are configured for
loopback. The runtime launches the mounted
`/code/src/index.mjs` entry point, then invokes a root-level Ploinky readiness
wrapper that verifies addresses and
socket owners and fails closed on an unexpected wildcard or owner.

## Routing and origin

The control service performs authenticated Explorer/DPU authorization. The
editor service has an exact method/path allowlist for required assets, cache
content, and editor WebSockets. Every supplied Origin must equal the exact
serialized current editor origin; same-origin URLs with credentials, a path,
a trailing slash, or surrounding whitespace are rejected. WebSockets and
mutations require Origin. Before dialing DocumentServer, the editor service
requires the complete Router-installed request tuple: scalar internal
`Host: 127.0.0.1:8080`, scalar `x-forwarded-host` and
`x-forwarded-proto` equal to the committed active browser URL, and scalar
`x-forwarded-prefix: /base-agent-additional-server/onlyOffice/8080`. Raw HTTP
occurrences of `Host`, `Origin`, and every expected forwarding field are
validated before the normalized header view is trusted. Missing, duplicated,
case-duplicated, comma-joined, whitespace-padded, malformed, unexpected, or
caller-spoofed forwarding fields fail closed; bare `Forwarded`, bare
`X-Forwarded`, and every unexpected `x-forwarded-*` field are forbidden. A
public browser authority presented directly as `Host` is not accepted as a
substitute for the Router's internal transport authority. Browser cookies,
authorization, forwarding, proxy-authorization, Host-derived identity, Ploinky
identity headers, and the private `Ploinky-Agent-Assertion` are stripped before
forwarding. The proxy derives the exact
`/base-agent-additional-server/onlyOffice/8080` forwarding prefix only from the
committed active browser route and rejects malformed, alternate, nested, or
trailing-path variants. Caller-supplied forwarding headers never survive. The
canonical host, protocol, and prefix keep DocumentServer cache URLs on the
same allowlisted Router path.
Responses use a strict asset-header allowlist. Redirects, cookies, browser-auth
challenges, hop-by-hop fields, internal forwarding metadata, and unsanitized
WebSocket upgrade headers never cross the public editor boundary.

Every editor-session creation derives the current Router origin from trusted
request metadata, appends and fail-closed validates the exact editor convention
path, and persists that canonical active browser URL as immutable
session-bound authority. No URL is cached at process startup and no private
origin is exposed to a browser. A session update cannot replace that authority.

## Signed document lifecycle

Configuration and callback/outbox JWTs use the allowed algorithm and bounded
`iat`, `nbf`, and `exp`. The configurable lifetime must be an exact positive
integer no greater than 300 seconds. The editor configuration contains exactly
one signed top-level `token`, and DocumentServer inbox validation is required
to consume it from the body with `inBody` set to boolean `true`. The public
editor proxy still strips browser `Authorization`, cookies, and other
credentials. The token is body-bound and never placed in a URL. Callback
delivery remains the separately validated signed outbox path.
Callbacks require one own string `token`, authenticate its HS256 signature and
temporal bounds first, and then require every envelope field except `token` to
recursively equal the verified payload except for signed-only `iat`, optional
`nbf`, and `exp`. Object key order may differ, but types, nested keys and values,
and array order must match exactly. Extra, missing, mismatched, non-JSON,
temporal-envelope, and signed `token` fields fail closed. Only verified claims
continue to authorization, fetch, write, and acknowledgement. Callbacks also
require loopback plus the opaque session token and enforce JSON/content and body
limits. Session creation mints a distinct non-secret 128-bit
`documentKey`; the same key is persisted with that exact session and is used by
the signed editor config, callback validation, and force-save drain. An outbox
JWT from another session is rejected even when both sessions name the same
document and version.

Document fetches are redirect-free, timeout bounded, byte bounded, and limited
to the current process-local DocumentServer. For the exact active editor origin
stored with the authenticated callback session, the callback URL must begin
with the committed
`/base-agent-additional-server/onlyOffice/8080/cache/files/` route. The Agent
strips exactly that one prefix when mapping the confined non-empty cache suffix
to process-loopback DocumentServer; direct process-loopback `/cache/files/`
URLs remain valid. Missing, duplicate, lookalike, dot-segment, and encoded
separator/traversal forms fail before fetch or persistence. Callback
forwarding headers, environment, and signed fields never supply or alter this
authority. Missing, malformed, mutated, or conflicting stored authority fails
before fetch, persistence, or acknowledgement without a compatibility or
origin-translation fallback. A valid status `2` or `6` callback stores the
version before acknowledgement. Persisted session
metadata lets a restart reopen the last acknowledged version. Contract-v5
metadata has one location, `/root/.ploinky/state/onlyoffice-sessions-v5.json`, under the
persisted agent workdir. It is a guarded regular `0600` file written through a
unique exclusive temporary, file `fsync`, atomic rename, and directory `fsync`.
Delegation bearers are never persisted; a DPU session requires fresh
authenticated control material after recreate. Symlinks, weak modes, wrong
ownership, corrupt bytes, missing or duplicate session document keys, duplicate
records, missing or corrupt canonical active browser bindings, and pre-v5
schemas fail closed. The canonical browser URL and its binding-integrity value
survive reload and targeted recreate. There is no derived-key or authority
fallback.

## Lifecycle and failure

State/log/data mounts are box-owned and durable. DocumentServer Data and
`/var/lib/onlyoffice` have explicit managed mounts. PostgreSQL, RabbitMQ, and
Redis data remain image-owned because root-owned host bind mounts can prevent
their non-root services from starting under rootless Podman. A targeted restart
drains sessions and waits for save/close callback acknowledgement. The
real-browser release lane makes a second
distinct edit without an explicit save, proves the durable DPU blob is
unchanged, then requires drain to persist and reopen that edit. Invalid topology,
origin, JWT, fetch, callback, persistence, or drain state fails closed and
keeps a replacement selector inactive.

## Tests

`tests/` covers manifest shape, temporal JWTs, signed-body callbacks, bounds,
redirect rejection, origin/header sanitation, WebSocket paths, persistence,
wrapper configuration, and readiness. The release lane uses a real browser and
DocumentServer image through Router.
