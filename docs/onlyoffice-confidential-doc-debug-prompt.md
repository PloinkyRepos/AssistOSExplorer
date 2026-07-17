# OnlyOffice Confidential `.doc` Debug Prompt — Retired Pre-v5 Evidence

> Historical evidence only. This prompt is retired and must not be used as a
> current debugging or deployment runbook.

## Recorded symptom

The pre-v5 run created an encrypted Confidential `.doc` object, constructed an
OnlyOffice session, and rendered the editor shell before reporting `Download
failed`. The storage fetch and document conversion had succeeded. The browser
failed later because DocumentServer had derived a cache URL from
non-canonical forwarding metadata and exposed a process-local origin.

The original prompt suspected invalid RTF content. Subsequent evidence refuted
that hypothesis: the converter produced the editor cache object. This history
does not justify changing the seed document or broadening the editor surface.

## Why the old procedure is removed

The pre-v5 instructions copied source into a Ploinky-managed shadow checkout,
recreated local state as part of a debug loop, extracted live document tokens,
and called a process-local storage listener directly. Those actions contradict
the runtime-v5 hard cut and the current security boundary:

- managed shadow checkouts are runtime output and must never be edited or used
  to inject local source changes;
- process-local DocumentServer and storage listeners have no direct operator or
  browser contract;
- document, callback, assertion, CSRF, participant, and relay credentials must
  never be extracted from traces or printed;
- runtime v5 does not inspect, import, clean up, or fall back to legacy state;
  destructive removal and credential revocation are explicit operator
  prerequisites before a fresh recreate; and
- inbound forwarding metadata is discarded. The editor proxy constructs its
  canonical forwarding values only from the validated active topology locator.

## Current authority and gate

Use these current sources instead of this retired prompt:

- `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`;
- `docs/specs/DS04-onlyoffice-integration.md`;
- `docs/specs/DS06-ploinky-runtime-invariants.md`;
- `onlyOffice/docs/design/onlyofficeagent-architecture.md`; and
- the approved Ploinky Box edge-routing and publication design.

The real release gate is
`tests/smoke/specs/50-onlyoffice-dpu.spec.mjs`, invoked only through the
Router-visible service paths using the documented command in
`tests/smoke/README.md` against a freshly built v5 box. It proves the pinned
editor transport, encrypted DPU storage, signed callback acknowledgement,
targeted drain of an outstanding edit, and reopen after replacement activation.

A missing stack, account, image, or DPU prerequisite is `BLOCKED`. It is not a
reason to restore direct listener access, shadow-checkout synchronization,
caller-controlled forwarding, or compatibility behavior.
