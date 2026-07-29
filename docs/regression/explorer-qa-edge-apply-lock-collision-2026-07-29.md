# Explorer QA Edge Apply Lock Collision

## Status

Confirmed during the clean `ploinky-proxy` QA deployment on 2026-07-29.
The Ploinky correction is published as
`e78a3d27d4d2ae7ff1e195e70fd0c5c106027524`. Clean redeployment is required
before the headless QA acceptance suite can be accepted as final.

## Environment

| Field | Value |
| --- | --- |
| Origin | `https://explorer-qa.axiologic.dev` |
| Explorer revision | `1348b0d` |
| Ploinky revision | `00f0adfba3c4ad4825ae262a5b7b1ee9172dfd0d` |
| GitHub Actions run | `30484668139` |
| Deployment | Empty QA host, Box, workspace, volumes, DNS, and managed tunnel recreated from `ploinky-proxy` |
| Trigger | Overlapping no-wait route completions while the cold fleet advanced from 11/16 to 12/16 |

## Expected

When one route completion is already applying an edge generation, another
route completion should treat the apply-lock collision as transient. It should
retry within a finite budget, then either publish the same current generation
or report a durable error. A transient collision must not leave the managed
Cloudflare publication stopped.

## Actual

At 12/16 running agents, an overlapping publication reconcile reported:

```text
edge generation apply is already in progress
```

The router classified that lock collision as non-retryable. Publication entered
`error`, the managed connector stopped, and the current reconcile did not heal
itself.

A later, independent route completion happened to trigger another publication
attempt. That attempt eventually restored `ready/running`, and all 16 agents
reached running without manual intervention. This recovery does not remove the
defect: if the collision occurs on the last route completion, there may be no
later event to restart publication.

## Impact

A clean deployment can finish its service graph while leaving the public QA
origin unavailable. The outcome depends on whether another route activation
arrives after the collision, so a successful workflow or a later incidental
reconcile can hide the failure. Acceptance tests started during the stopped
interval would produce infrastructure failures, while accepting the recovered
deployment without a correction would leave the final-route case unprotected.

## Correction Boundary

The Ploinky publication reconciler should retry only the transient
already-in-progress apply-lock outcome. The retry must be bounded, must release
the contested lock before backoff, and must revalidate the active immutable
generation and connector identity on every attempt.

Replacement generations, selector or identity drift, durable publication
errors, and connector launch failures must continue to fail immediately. The
correction must not permit duplicate connector launches or rely on another
route completion to recover publication.

Regression coverage must prove that an apply-lock collision is retried and
settles, that the retry budget is finite, and that non-transient errors remain
non-retryable.

## Correction

The ready-state commit now bounded-retries only a pre-mutation
`EDGE_GENERATION_BUSY` result. The retry stays inside the coordinator's apply
call and preserves the captured expected generation, so reconciliation and
connector launch are not repeated.

Regression coverage reproduces one connector launch followed by a busy ready
commit and proves that the same activation reaches `ready/running` without a
later route completion. Retry exhaustion, immutable-generation drift, and
connector-identity drift retain the existing fail-closed cleanup path.

Focused coverage passes 54/54 tests. The complete Node unit suite passes 1,849
tests with 2 intentional skips and no failures.

## Verification Required

After the Ploinky correction is committed and pushed to `ploinky-proxy`:

1. Destroy the current QA generation using its owning runtime.
2. Deploy the corrected `ploinky-proxy` heads into an empty QA environment.
3. Observe all 16 tracked agents reach running without manual intervention.
4. Require one stable Ploinky-managed connector identity across a sustained
   window and repeated successful public edge probes.
5. Run both headless Explorer QA acceptance cases.
