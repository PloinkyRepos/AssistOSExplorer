# Explorer QA Cloudflare Host Probe Retry

## Status

Confirmed during the corrected clean `ploinky-proxy` QA deployment on
2026-07-29. Corrected in Ploinky
`2627d00a4d87ee367d7b7f70abf3d5040f67d369`; another clean redeployment and
strict acceptance run are required before the correction is accepted as
verified in QA.

## Environment

| Field | Value |
| --- | --- |
| Origin | `https://explorer-qa.axiologic.dev` |
| Explorer revision | `2e7519bafb539d82464b9eac018171115b40b42a` |
| Ploinky revision | `e578b28cb965b3bd52063b4e450c627d6af971a6` |
| GitHub Actions run | `30487304813` |
| Deployment | Empty QA workspace, Box, volumes, DNS, and managed tunnel recreated from `ploinky-proxy` |
| Trigger | Umami completed and activated its route while the cold fleet advanced to 12/16 |
| Failure time | `2026-07-29T20:20:21.747Z` |

## Expected

A transient Cloudflare hostname-probe failure during managed route
reconciliation should retry within a finite budget. The current activation
should either reach `ready/running` or terminate with a durable, actionable
error. Recovery must not depend on an unrelated later route activation.

## Actual

The managed publication reconcile reported the explicitly retryable error:

```text
CLOUDFLARE_HOST_PROBE_FAILED
```

Publication moved to `error`, the connector stopped, and the reconcile did not
retry internally for more than 100 seconds. The no-wait workers remained
healthy and continued their normal cold-start sequence.

A later route completion may incidentally trigger another publication attempt,
but that does not make this lifecycle safe. If the transient probe failure
occurs during the final route activation, no later event is guaranteed to
restore the public edge.

## Root Cause

The runtime schedules a retry after the probe exception, but it rebinds that
retry to a same-generation selector only when the selector's publication state
is exactly `error`.

In the overlapping apply path, the controller can fail to inactivate after its
reconciling activation has already committed. `onCommit` records that current
activation in `handledActivations`, while the retry remains pinned to the
superseded pre-reconcile activation. When the timer observes the activation
mismatch it calls `scan()`, which discards the still-current activation because
it is already recorded as handled. No `retryAttempt` occurs.

## Impact

The service graph can continue toward 16/16 while the public QA origin remains
unavailable. Workflow success and healthy worker state therefore do not prove
application readiness. Running acceptance during the stopped interval would
produce infrastructure failures; accepting a later incidental recovery would
leave the final-route case unprotected.

## Correction Boundary

The publication coordinator should bounded-retry only the classified transient
Cloudflare hostname-probe failure. Each attempt must preserve the immutable
generation and desired route set, and must not duplicate connector creation or
broaden the set of retryable Cloudflare failures.

Generation drift, desired-route drift, connector-identity drift, retry
exhaustion, and durable API or configuration errors must remain fail-closed.
The retry must complete within the same activation and cannot rely on another
agent route event.

Regression coverage must reproduce the final-route sequence, prove recovery
from a transient hostname-probe failure without another activation, prove
exactly-once connector lifecycle behavior, and prove finite exhaustion plus
fail-fast handling of non-retryable errors and identity drift.

## Implemented Correction

Ploinky `2627d00a4d87ee367d7b7f70abf3d5040f67d369` rebinds the scheduled retry
only to the exact same generation while the publication remains
`reconciling` or `error`. A `ready` publication and any generation drift remain
excluded. The existing workspace lease continues to serialize connector
launch.

The new regression reproduces two hostname-probe failures and proves recovery
without an independent route activation. Focused publication tests passed
74/74. The broad Ploinky Node suite passed 1,829 tests with 2 skips and no
failures.

## Verification Required

With the correction committed and pushed to `ploinky-proxy`:

1. Destroy the current QA generation using its owning runtime.
2. Deploy the corrected heads into an empty QA environment.
3. Observe all 16 agents reach running without manual intervention.
4. Require a stable Ploinky-managed connector identity across a sustained
   window and repeated successful public edge probes.
5. Run both strict headless Explorer QA acceptance cases and clean up their
   run-scoped data.
