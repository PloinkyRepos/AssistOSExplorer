# OnlyOffice Confidential `.doc` Failure — Pre-v5 Retrospective

> Historical evidence only. This is not a deployment recipe or current
> forwarding contract. All pre-v5 shadow-checkout commands and direct runtime
> procedures have been removed deliberately.

## Historical symptom

A pre-v5 browser could render the OnlyOffice shell for an Explorer-created
Confidential document and then fail while fetching the converted editor cache
object. The old proxy let DocumentServer derive browser-facing cache locations
from non-canonical forwarding metadata, so it could emit a process-local origin
that the browser could not reach. Document conversion and encrypted DPU storage
were not the failing boundaries.

This evidence remains useful only for recognizing the symptom. Its original
remediation—preserving caller or outer-proxy forwarding values—is forbidden in
runtime v5.

## Runtime-v5 contract

The public editor transport resolves the active immutable
`onlyoffice-editor` topology locator and independently enforces the exact
serialized browser Origin. Before either an HTTP or WebSocket upstream
connection is created, it removes caller-supplied `Host`, forwarding,
authorization, cookie, Ploinky identity, and private agent-assertion headers.
It then constructs only the canonical `X-Forwarded-Host` and
`X-Forwarded-Proto` values from that validated active locator. No inbound
forwarding value is preserved or trusted.

OnlyOffice control, editor, DocumentServer, storage, and support listeners are
private inner-box services. They never create a physical-host publication and
have no direct-port compatibility path.

## Hard-cut operator prerequisite

Runtime contract v5 contains no legacy discovery, migration, import, cleanup,
or fallback reader. If an old host-managed DocumentServer, old plaintext state,
or obsolete publication credentials exist, the operator must revoke or remove
them explicitly before recreating the box. The OnlyOffice preinstall hook must
not perform that destructive work and activation must not infer success from an
old deployment.

Ploinky-managed shadow checkouts are runtime outputs, not source trees. Never
edit or synchronize implementation files into them. Build and test a fresh v5
box from the repository checkout instead.

## Current verification authority

The normative contracts are:

- `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`;
- `docs/specs/DS04-onlyoffice-integration.md`;
- `docs/specs/DS06-ploinky-runtime-invariants.md`; and
- the approved Ploinky Box edge-routing and publication design.

The release lane is
`tests/smoke/specs/50-onlyoffice-dpu.spec.mjs`, using the command documented in
`tests/smoke/README.md` against a freshly built runtime-v5 box. It must prove
Router-mediated editor transport, encrypted DPU persistence, signed callback
acknowledgement, targeted drain of an outstanding edit, and successful reopen.
A missing stack, account, pinned image, or DPU prerequisite is `BLOCKED`; it is
not permission to restore the retired behavior.
