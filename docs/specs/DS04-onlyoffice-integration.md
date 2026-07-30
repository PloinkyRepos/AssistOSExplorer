---
id: DS04
title: OnlyOffice Integration
status: implemented
owner: achilleside-team
summary: Defines the v5 split control/editor services, signed document lifecycle, storage isolation, and Router boundary.
---

# DS04 - OnlyOffice Integration

## Purpose

Explorer delegates Office editing to the `onlyOffice` agent. Explorer owns file
selection and DPU authorization; the agent owns editor-session construction,
DocumentServer transport, callback validation, and persisted session metadata.

## Router routes

The manifest declares access policy for two convention paths:

| Route | Target | Access | Surface |
| --- | ---: | --- | --- |
| `onlyoffice` | 7000 | authenticated | Control/session API under `/base-agent-additional-server/onlyOffice/7000/control/` |
| `onlyoffice-editor` | 8080 | narrowly public | Editor assets, cache fetches, and editor WebSockets under `/base-agent-additional-server/onlyOffice/8080/` |

The control route keeps Explorer/DPU authorization. The public transport route
is not a general DocumentServer proxy: it uses exact path and method allowlists,
requires every supplied Origin to equal the exact serialized active origin,
rejects same-origin URLs with credentials, paths, trailing slashes, or
surrounding whitespace, requires Origin for WebSocket and state-changing
traffic, and removes credentials, forwarding headers, and Ploinky identity
headers before proxying.

DocumentServer itself listens process-locally on `127.0.0.1:80`. Its embedded
DocService support listener and nginx upstream are paired exactly on
`[::1]:8000`; configuration and activation readiness require the pinned canonical nginx
file plus its exact relative alias symlink before startup. After the pinned
entrypoint materializes the alias, readiness requires two distinct `105:107`,
`0644`, byte-identical regular files with the exact target directive. Either
phase rejects a missing, duplicate, unexpected, IPv4, or wildcard form. Storage
and callback handling listen on `127.0.0.1:9100`. None of these listeners has a
Router policy path or a box publication.

The full readiness script is activation-only and retains the configuration,
socket-owner, bind-address, and process checks. Recurring liveness is a separate
bounded transport check for the DocumentServer health endpoint plus the control,
editor, and storage listeners. Its probe body performs no service-ownership,
configuration, `ss`, or `/proc` scan, and failure retains Ploinky's normal
fail-closed route inactivation and restart behavior.

## Topology and sessions

Every editor-session operation derives the Router origin from trusted forwarding
metadata and appends the fixed OnlyOffice editor convention path. It never
caches a private startup URL. Browser configuration contains only the
Router-visible editor origin and opaque session URLs.

Configuration JWTs use the configured algorithm, `iat`, `nbf`, and bounded
`exp`, and bind the document/session payload. The configurable lifetime is an
exact positive integer capped at 300 seconds. The editor configuration exposes
exactly one signed top-level `token`; DocumentServer inbox validation must
consume that token from the body with `inBody` set to boolean `true`, while the
public editor proxy continues to strip browser `Authorization`, cookies, and
other credentials. DocumentServer request/outbox signing is enabled in-body
with the same bounded temporal rules. Callback handling remains the separately
validated outbox path: it verifies the one own string `token` before inspecting
duplicated claims, permits only `iat`, optional `nbf`, and `exp` to remain
signed-only, and then requires the envelope without `token` to be recursively
type- and value-identical to every non-temporal verified claim. Object key order
is immaterial; array order and all nested JSON structure are exact. Extra,
missing, mismatched, temporal-envelope, and signed `token` claims fail closed,
and only the verified payload is used after validation.

The session store mints a distinct non-secret 128-bit `document.key` for every
editor session and persists that exact key with the session. The signed editor
configuration, callback validation, and drain operation all use the persisted
key. It is never derived from a file path, version, or other document metadata;
missing, malformed, or duplicate keys and all pre-v5 state fail closed with no
fallback. Two sessions for the same document therefore remain isolated and a
fresh session deliberately remounts the editor with its new key.

An editor `onError` invalidates reuse only for the exact render generation that
raised it. The host preserves the caller handler and does not retry, request a
session, or remount automatically. An error from a superseded generation cannot
invalidate its replacement; the next explicit open of a failed no-version DPU
document obtains a fresh session/configuration before remounting.

Downloads and callbacks are loopback-only, content-type checked, size limited,
time limited, and redirect-free. Callback download URLs are rewritten only to
the process-local DocumentServer origin. Successful callback acknowledgement is
the persistence boundary: reopening must use the last acknowledged version.

## Lifecycle

The pinned multi-architecture image starts DocumentServer, the authenticated
control service, the editor proxy, and loopback storage. Readiness proves all
four semantics rather than accepting a single open socket. Durable OnlyOffice
Data, logs, and session metadata live under box-owned data mounts. PostgreSQL,
RabbitMQ, and Redis state remains image-owned because rootless host bind
ownership can prevent those services from starting. Before local support
services start, the wrapper resolves exactly one bundled PostgreSQL cluster and
restores the package ownership and modes only for its three guarded
configuration files, exact version/cluster log file, log directory,
runtime-socket directory, TLS private directory and key, and RabbitMQ service
log directory and four init-script log files. Symbolic links, hard-linked files,
ambiguous clusters, missing required paths, unexpected path shapes, or
post-preparation ownership and mode drift fail closed before service startup.

A targeted restart drains open sessions, requests save/close, waits for callback
acknowledgement, then exits. The real-browser release lane obtains its
authenticated CSRF-bound restart proof before creating a distinct unsaved edit,
proves the durable blob is still unchanged, and issues the targeted restart
without an intervening authentication request. The drain must persist and reopen
that outstanding edit. A failed drain keeps the replacement route inactive; it
does not silently discard document state.

## Security invariants

- A browser cannot reach process-local storage or DocumentServer directly.
- The editor proxy cannot forward cookies, authorization, proxy authorization,
  forwarding, caller-supplied identity headers, or the private
  `Ploinky-Agent-Assertion`.
- Command, conversion, example, welcome, info, internal, and health surfaces
  never reach DocumentServer through the public service.
- JWTs, delegation credentials, and secrets never appear in public URLs, logs,
  HTML, or diagnostics. An opaque per-session identifier is confined to the
  process-local document/callback URL and is never exposed as a public Router
  locator or diagnostic field.
- Invalid topology, JWT, body binding, Origin, size, timeout, or persistence
  state fails closed.

## Verification

Unit coverage is in `onlyOffice/tests`. The real release lane opens an Office
document through Explorer, proves asset and WebSocket transport through Router,
persists one edit through a signed callback, prepares the restart proof, then
proves targeted drain persists a second outstanding edit and reopens both after
restart.
