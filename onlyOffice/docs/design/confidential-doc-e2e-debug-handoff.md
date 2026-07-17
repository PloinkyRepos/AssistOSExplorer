# Confidential `.doc` E2E Debug Handoff — Pre-v5 Retrospective

> Historical evidence only. This note records a routing failure from the
> retired pre-v5 runtime. Its old direct-port commands and publication mapping
> are intentionally removed and must not be reconstructed or used as operator
> instructions.

## What the historical run established

The old run proved that Explorer could create a `.doc` under
`/Confidential/My Space` through `dpuAgent`, that DPU stored an encrypted
`DPUENC1` blob, and that no plaintext workspace copy or filename appeared in
the encrypted blob. The browser then failed to create an OnlyOffice session.

The pre-v5 failure came from one graph-derived host publication being reused as
the target for two semantically different services. The authenticated control
request was rewritten to its control pathname but dialed the editor transport,
which correctly returned `404`. The control handler itself existed and rejected
unauthenticated direct container calls as expected.

## Runtime-v5 resolution

Runtime v5 removes that host-publication model completely. OnlyOffice declares
two distinct Router services using the approved `httpServices[].port` field:

| Service | Private target | Router-visible surface | Access |
| --- | ---: | --- | --- |
| `onlyoffice` | `7000/tcp` | `/services/onlyoffice/` | authenticated control/session API |
| `onlyoffice-editor` | `8080/tcp` | `/public-services/onlyoffice-editor/` | narrow editor asset and WebSocket allowlist |

Each explicit target receives one private inner mapping in the immutable route
generation. Neither target creates a physical-host publication. Browsers and
tests use the Router-visible paths only; there is no direct editor/control port
alternative or compatibility alias.

The outer box publication contract remains exactly loopback Router TCP plus the
fixed LiveKit UDP mux. OnlyOffice control, editor, storage, DocumentServer, and
support listeners remain private and must never appear in outer
`HostConfig.PortBindings`.

## Current verification authority

The normative contract is in:

- `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`;
- `AssistOSExplorer/docs/specs/DS04-onlyoffice-integration.md`; and
- the approved Ploinky Box edge-routing and publication design.

The implementation gate is the real Explorer smoke at
`AssistOSExplorer/tests/smoke/specs/50-onlyoffice-dpu.spec.mjs`. It reaches
OnlyOffice exclusively through Router service paths, proves encrypted DPU
storage, performs one explicit save, creates a second unsaved edit, invokes an
authenticated CSRF-bound targeted restart, and requires drain to persist and
reopen both edits.

Use the release command documented in `AssistOSExplorer/tests/smoke/README.md`
against a freshly built runtime-v5 box. A missing stack, account, image, or DPU
prerequisite is `BLOCKED`; it is not grounds to revive a direct host mapping.
