# OnlyOfficeAgent v5 architecture

| Field | Value |
| --- | --- |
| Status | Implemented |
| Runtime owner | `AssistOSExplorer/onlyOffice` |
| Normative specifications | `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`, `docs/specs/DS04-onlyoffice-integration.md` |
| Runtime contract | Ploinky box v5 |

This note replaces the retired direct-port and agent-owned tunnel proposal. The
OnlyOffice agent is now a decorator around the pinned DocumentServer image. It
owns session construction, browser transport, process-local document storage,
callback validation, persistence, and targeted-restart draining.

## Listener and Router topology

| Plane | Listener | Router declaration | Admission |
| --- | --- | --- | --- |
| Control | TCP `7000` | `onlyoffice`, `/base-agent-additional-server/onlyOffice/7000/control/` → `/control/` | Authenticated Ploinky session; Explorer/DPU authorization remains effective |
| Editor transport | TCP `8080` | `onlyoffice-editor`, `/base-agent-additional-server/onlyOffice/8080/` → `/` | Narrow public method/path allowlist with exact Origin enforcement |
| DocumentServer | `127.0.0.1:80` | None | Process-local decorator traffic only |
| DocService support | `[::1]:8000` | None | Configure verifies the exact canonical-plus-symlink shape; readiness verifies the pinned entrypoint's distinct, byte-identical `105:107`/`0644` materialized copies |
| Storage and callbacks | `127.0.0.1:9100` | None | Process-loopback peer plus opaque active-session token and signed body |
| Bundled support | loopback `5432`, `5672`, `25672`, `4369`, and optional `6379` | None | Owner-aware readiness; wildcard bind blocks activation |

The two declared service ports are private inner targets. They do not create a
physical-host publication. DocumentServer and storage are neither Router
targets nor outer publications.

```text
authenticated browser / Explorer
             |
             v
Router public listener -- onlyoffice control --> decorator :7000
             |
             +-- onlyoffice-editor allowlist --> editor proxy :8080
                                                    |
                                                    v
                                          DocumentServer 127.0.0.1:80
                                                    |
                                                    +-- DocService [::1]:8000
                                                    |
                                                    v
                                       storage/callback 127.0.0.1:9100
                                                    |
                                      workspace persistence or delegated DPU
```

## Control and editor separation

The control service creates an editor session only after authenticated policy
admission. Each request resolves the currently applied immutable topology
generation and obtains the active Router-visible editor locator. The browser
receives that locator; it never receives a process-local origin.

The editor service is not a generic DocumentServer proxy. It allows only the
pinned editor asset, cache, font/theme, and co-editing WebSocket shapes. It
blocks command, conversion, example, welcome, info, internal, and health
surfaces. The proxy requires each supplied Origin to equal the exact serialized
active origin, rejecting credentials, paths, trailing slashes, and surrounding
whitespace. It requires Origin on WebSocket and mutation paths and strips
cookies, authorization, proxy authorization, forwarding, Ploinky identity
headers, and the private `Ploinky-Agent-Assertion` before dialing
DocumentServer. The return path exposes only pinned asset headers, rejects
redirects, and reconstructs WebSocket `101` handshakes from the exact required
upgrade fields so internal cookies, auth challenges, forwarding metadata, and
hop-by-hop headers cannot reach the browser.

## Signed document lifecycle

| Boundary | Control |
| --- | --- |
| Editor configuration | HS256 JWT with `iat`, `nbf`, body-bound `exp`, and an exact positive lifetime capped at 300 seconds |
| Document read | Process-loopback URL, opaque active-session token, timeout and byte bounds |
| Session key | Store-minted, non-secret 128-bit key persisted for one exact session; never derived from document metadata |
| Callback body | One own string `token`; authenticate the in-body HS256 outbox JWT first, then require recursive exact equivalence between envelope fields and verified non-temporal claims |
| Callback download | Redirect-free, bounded, approved office content type, exact process-local origin, and `/cache/files/` path only |
| Persistence acknowledgement | Status `2` or `6` bytes are stored before success is acknowledged |
| Reopen after restart | Uses the last persisted acknowledged session version |

JWTs and configured secrets are not placed in URLs, logs, HTML, or browser
diagnostics. The opaque session bearer exists only in the process-loopback
document/callback URL carried by the signed editor config and must be redacted
from logs and artifacts. `iat`, optional `nbf`, and `exp` are the only
signed-only callback fields. The unsigned duplicates may differ only in object
key order; exact recursive types, keys, values, and array order must otherwise
match, and only verified claims continue downstream. Two sessions for the same
document deliberately have different keys, so an outbox JWT from one cannot
authorize the other's opaque callback URL.

## Targeted restart drain

The runtime closes new control/editor admission, enumerates writable active
sessions, and sends a temporally bounded, body-bound force-save command to the
process-local DocumentServer command service. It waits for a newer persisted
callback acknowledgement before destroying editor sockets and stopping storage
or DocumentServer. The configured drain deadline is bounded by
`ONLYOFFICE_DRAIN_TIMEOUT_MS`; a timeout or invalid response fails closed and
keeps storage and DocumentServer alive for recovery.

The browser release lane obtains its authenticated CSRF-bound restart proof,
then types a second distinct edit after the ordinary save callback without
clicking save. It proves the DPU blob remains unchanged and issues the targeted
restart immediately, with no intervening authentication request; the drain must
persist and reopen that outstanding edit.

## Persistence and DPU delegation

Session metadata lives only at
`/root/.ploinky/state/onlyoffice-sessions-v5.json`, inside Ploinky's persisted
agent workdir. Writes use a unique exclusive `0600` temporary file, file and
directory `fsync`, and atomic rename. Loading rejects links, non-regular files,
weak permissions, wrong ownership, corrupt records, duplicate token hashes,
missing or duplicate per-session document keys, and every schema other than v5.
Delegation bearer tokens never enter the state bytes; DPU sessions require
fresh authenticated control material after a recreate. An uncommitted crash
temporary is ignored and no old schema or derived document key is imported or
reconstructed.

DocumentServer Data and `/var/lib/onlyoffice` are explicit managed mounts.
PostgreSQL, RabbitMQ, and Redis state remains image-owned so rootless Podman
does not present root-owned bind paths to their non-root services.

Workspace documents are path-confined to the mounted workspace and protected
secret paths are rejected. Confidential paths use the manifest-declared,
path-scoped DPU delegation set. The Router verifies the authenticated user,
current caller generation, target, tool, scope, and lease before the DPU call;
the OnlyOffice agent does not treat the delegation assertion as a user or admin
credential.

## Failure behavior

Invalid topology, inactive locator, Origin, route shape, JWT, body binding,
content type, redirect, size, timeout, persistence, or drain state fails closed.
There is no legacy direct-publish alias, automatic migration, alternate URL
reader, or tunnel fallback.

The repository manifest remains pinned to the previously published image until
the sealed amd64/arm64 OCI archive is published by the manual
expected-digest-before-publish workflow. Activation of the listener interposer
is therefore a release prerequisite; no placeholder digest is accepted.

## Verification

| Layer | Command or gate |
| --- | --- |
| Unit/integration | `cd AssistOSExplorer/onlyOffice && npm test` |
| Manifest and preinstall | `node --test tests/manifest-env.test.mjs tests/preinstall-defaults.test.mjs` |
| Drain and callback security | `node --test tests/drain.test.mjs tests/storage-routes.test.mjs tests/runtime-bootstrap.test.mjs` |
| Browser release lane | Open and explicitly save one edit, create a second unsaved edit, prove durable state is unchanged, then drain and reopen both through the Router-visible editor service and pinned DocumentServer image |

The generated HTML documentation and normative DS files must remain synchronized
with these implemented listener and lifecycle boundaries.
